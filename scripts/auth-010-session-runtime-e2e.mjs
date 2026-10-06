import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BASE_URL = String(process.env.W01_BASE_URL || 'https://api.luckread.com').replace(/\/$/, '')
const DATABASE_NAME = String(process.env.DATABASE_NAME || 'luckread')
const WRANGLER_VERSION = process.env.WRANGLER_VERSION || '4.116.0'
const TEST_ID = `AUTH010-${process.env.GITHUB_RUN_ID || Date.now()}-${randomBytes(5).toString('hex')}`
const TESTED_COMMIT_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const ARTIFACT_DIR = 'artifacts/evidence/auth-010/remote-e2e'

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN
if (!ACCOUNT_ID || !API_TOKEN) throw new Error('Cloudflare credentials are required for controlled remote evidence')

mkdirSync(ARTIFACT_DIR, { recursive: true })

const sqlString = (value) => "'" + String(value).replace(/'/g, "''") + "'"

const flattenRows = (value) => {
  if (Array.isArray(value)) return value.flatMap((item) => {
    if (Array.isArray(item)) return item
    if (item && Array.isArray(item.results)) return item.results
    if (item && Array.isArray(item.result)) return item.result
    return []
  })
  if (value && Array.isArray(value.results)) return value.results
  if (value && Array.isArray(value.result)) return value.result
  return []
}

const d1Json = (command) => {
  const output = execFileSync(
    'npx',
    [
      '--yes',
      `wrangler@${WRANGLER_VERSION}`,
      'd1',
      'execute',
      DATABASE_NAME,
      '--remote',
      '--json',
      '--yes',
      '--config',
      'workers/W01-payload/wrangler.jsonc',
      '--command',
      command,
    ],
    { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 },
  )
  return JSON.parse(output)
}

const d1Rows = (command) => flattenRows(d1Json(command))

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const rawBody = await response.text()
    let data = null
    try { data = rawBody ? JSON.parse(rawBody) : null } catch { data = null }
    return {
      status: response.status,
      bodyBytes: Buffer.byteLength(rawBody),
      data,
      cacheControl: response.headers.get('cache-control') || '',
    }
  } finally {
    clearTimeout(timeout)
  }
}

const writeJson = (name, value) =>
  writeFileSync(`${ARTIFACT_DIR}/${name}`, `${JSON.stringify(value, null, 2)}\n`)

const failures = []
const createdUsers = []
const roleAssignments = []

function check(condition, message) {
  if (!condition) {
    failures.push(message)
    throw new Error(message)
  }
}

function expectStatus(response, expected, label) {
  check(response.status === expected, `${label}: expected HTTP ${expected}, got ${response.status}`)
}

function privacySafeSession(session) {
  if (!session || typeof session !== 'object') return false
  const serialized = JSON.stringify(session)
  for (const key of ['token', 'accessToken', 'refreshToken', 'password', 'userId', 'accountState', 'tokenVersion', 'revokedAt', 'deviceId']) {
    if (serialized.includes(key)) return false
  }
  return (
    typeof session.sessionId === 'string' &&
    typeof session.createdAt === 'string' &&
    typeof session.expiresAt === 'string' &&
    (session.lastSeenAt === null || typeof session.lastSeenAt === 'string')
  )
}

async function createUser(label) {
  const suffix = `${TEST_ID}-${label}-${randomBytes(4).toString('hex')}`
  const email = `auth010-${label}-${suffix}@example.com`
  const username = `auth010_${label}_${suffix.replaceAll('-', '').slice(-20)}`
  const password = `Evd-AUTH010-${randomBytes(24).toString('base64url')}-Z9!`
  const response = await request('/auth/register', {
    method: 'POST',
    headers: { 'Idempotency-Key': `${TEST_ID}-register-${label}` },
    body: {
      identityType: 'email',
      identity: email,
      credential: password,
      username,
      consent: {
        purpose: 'ACCOUNT_REGISTRATION',
        policyVersion: 'PROD-2026-09-28.1',
      },
    },
  })
  expectStatus(response, 201, `register ${label}`)
  const userId = String(response.data?.userId ?? '')
  check(userId.length > 0, `register ${label}: userId missing`)
  check(response.data?.accountState === 'PENDING_VERIFICATION', `register ${label}: unexpected account state`)
  createdUsers.push({ userId, email })
  return { userId, email, username, password }
}

function activateAndAuthorize(user, label) {
  const now = new Date().toISOString()
  const roleId = `${TEST_ID}-role-${label}-${randomBytes(5).toString('hex')}`

  d1Json(
    `UPDATE "user"
     SET account_state='ACTIVE',
         account_state_version=account_state_version+1,
         updated_at=${sqlString(now)}
     WHERE id=${sqlString(user.userId)}`,
  )

  d1Json(
    `INSERT INTO role_assignments
      (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at)
     VALUES (
       ${sqlString(roleId)},
       ${sqlString(user.userId)},
       'user',
       'global',
       NULL,
       'ACTIVE',
       ${sqlString(now)},
       NULL,
       ${sqlString(now)},
       ${sqlString(now)}
     )`,
  )

  const account = d1Rows(
    `SELECT account_state,account_state_version FROM "user" WHERE id=${sqlString(user.userId)} LIMIT 1`,
  )[0]
  const assignment = d1Rows(
    `SELECT id,subject_id,role_id,scope_type,status FROM role_assignments WHERE id=${sqlString(roleId)} LIMIT 1`,
  )[0]

  check(String(account?.account_state) === 'ACTIVE', `activate ${label}: account state not ACTIVE`)
  check(
    String(assignment?.subject_id) === user.userId &&
    String(assignment?.role_id) === 'user' &&
    String(assignment?.scope_type) === 'global' &&
    String(assignment?.status) === 'ACTIVE',
    `authorize ${label}: role assignment not established`,
  )
  roleAssignments.push(roleId)
}

async function login(user, deviceId) {
  const response = await request('/auth/login', {
    method: 'POST',
    body: {
      identity: user.email,
      credential: user.password,
      deviceId,
    },
  })
  expectStatus(response, 200, `login ${deviceId}`)
  check(typeof response.data?.accessToken === 'string', `login ${deviceId}: access token missing`)
  return { accessToken: response.data.accessToken }
}

function sessionIds(sessions) {
  return Array.isArray(sessions?.items)
    ? sessions.items.map((item) => String(item?.sessionId ?? '')).filter(Boolean)
    : []
}

let primary
let second
let other
let firstLogin
let secondLogin
let otherLogin

try {
  const policy = JSON.parse(
    readFileSync('artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json', 'utf8'),
  )
  check(String(policy.policyVersion ?? '') === 'PROD-2026-09-28.1', 'unexpected production policy version')

  const anonymous = await request('/auth/sessions')
  expectStatus(anonymous, 401, 'anonymous session list')

  primary = await createUser('primary')
  activateAndAuthorize(primary, 'primary')

  other = await createUser('other')
  activateAndAuthorize(other, 'other')

  firstLogin = await login(primary, 'primary-a')
  secondLogin = await login(primary, 'primary-b')
  otherLogin = await login(other, 'other-a')

  const list = await request('/auth/sessions?limit=100', { token: firstLogin.accessToken })
  expectStatus(list, 200, 'session list')
  check(list.cacheControl.toLowerCase().includes('no-store'), 'session list must be private/no-store')
  check(Array.isArray(list.data?.items), 'session list items missing')
  check(list.data.items.length <= 50, `session list exceeded 50-item bound: ${list.data.items.length}`)
  check(list.data.items.every(privacySafeSession), 'session list contains non-contract or security-sensitive fields')

  const ids = sessionIds(list.data)
  check(ids.length >= 2, 'session list must expose both owned sessions')
  check(new Set(ids).size === ids.length, 'session list contains duplicate session IDs')

  const primarySessionId = ids[0]
  const secondarySessionId = ids[1]

  const badCursor = await request('/auth/sessions?cursor=not-a-valid-cursor', { token: firstLogin.accessToken })
  expectStatus(badCursor, 400, 'invalid session cursor')

  const revoke = await request(`/auth/sessions/${secondarySessionId}`, {
    method: 'DELETE',
    token: firstLogin.accessToken,
    headers: { 'Idempotency-Key': `${TEST_ID}-revoke-secondary` },
  })
  expectStatus(revoke, 204, 'revoke secondary session')
  check(revoke.bodyBytes === 0, 'revoke returned a response body')
  check(revoke.cacheControl.toLowerCase().includes('no-store'), 'revoke must be private/no-store')

  const repeatedRevoke = await request(`/auth/sessions/${secondarySessionId}`, {
    method: 'DELETE',
    token: firstLogin.accessToken,
    headers: { 'Idempotency-Key': `${TEST_ID}-revoke-secondary` },
  })
  expectStatus(repeatedRevoke, 204, 'repeated revoke')
  check(repeatedRevoke.bodyBytes === 0, 'repeated revoke returned a response body')

  const afterRevoke = await request('/auth/sessions', { token: firstLogin.accessToken })
  expectStatus(afterRevoke, 200, 'session list after revoke')
  check(!sessionIds(afterRevoke.data).includes(secondarySessionId), 'revoked session remained visible')

  const crossAccount = await request(`/auth/sessions/${primarySessionId}`, {
    method: 'DELETE',
    token: otherLogin.accessToken,
    headers: { 'Idempotency-Key': `${TEST_ID}-cross-account` },
  })
  expectStatus(crossAccount, 403, 'cross-account revoke')

  writeJson('runtime-session-list.json', {
    featureId: 'AUTH-010',
    authenticationAuthority: 'Better Auth',
    operation: 'GET /auth/sessions',
    testedCommitSha: TESTED_COMMIT_SHA,
    assertions: {
      anonymousDenied: anonymous.status === 401,
      boundedAt50: list.data.items.length <= 50,
      ownedSessionListPresent: ids.length >= 2,
      privacySafeProjection: list.data.items.every(privacySafeSession),
      privateNoStore: list.cacheControl.toLowerCase().includes('no-store'),
      invalidCursorRejected: badCursor.status === 400,
      revokedSessionHidden: !sessionIds(afterRevoke.data).includes(secondarySessionId),
    },
  })

  writeJson('runtime-session-revoke.json', {
    featureId: 'AUTH-010',
    authenticationAuthority: 'Better Auth',
    operation: 'DELETE /auth/sessions/{sessionId}',
    testedCommitSha: TESTED_COMMIT_SHA,
    assertions: {
      ownerRevokeAccepted: revoke.status === 204 && revoke.bodyBytes === 0,
      repeatedRevokeIsIdempotent: repeatedRevoke.status === 204 && repeatedRevoke.bodyBytes === 0,
      crossAccountDenied: crossAccount.status === 403,
      privateNoStore: revoke.cacheControl.toLowerCase().includes('no-store'),
    },
    targetSessionId: secondarySessionId,
  })

  if (failures.length === 0) console.log('AUTH-010_REMOTE_E2E_RESULT=PASS')
} catch (error) {
  console.error(`AUTH-010_REMOTE_E2E_RESULT=FAIL: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  const cleanupErrors = []

  for (const roleId of roleAssignments) {
    try {
      d1Json(`DELETE FROM role_assignments WHERE id=${sqlString(roleId)}`)
    } catch (error) {
      cleanupErrors.push(`role ${roleId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const user of createdUsers) {
    try {
      d1Json(`DELETE FROM "session" WHERE user_id=${sqlString(user.userId)}`)
      d1Json(`DELETE FROM consents WHERE CAST(actor_subject_id AS TEXT)=${sqlString(user.userId)} OR CAST(owner_subject_id AS TEXT)=${sqlString(user.userId)}`)
      d1Json(`DELETE FROM auth_registration_envelopes WHERE idempotency_key=${sqlString(`${TEST_ID}-register-primary`)} OR idempotency_key=${sqlString(`${TEST_ID}-register-other`)}`)
      d1Json(`DELETE FROM "user" WHERE id=${sqlString(user.userId)}`)
    } catch (error) {
      cleanupErrors.push(`user ${user.userId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const remainingSynthetic = []
  for (const user of createdUsers) {
    try {
      const rows = d1Rows(`SELECT id,email FROM "user" WHERE id=${sqlString(user.userId)} LIMIT 1`)
      if (rows.length > 0) remainingSynthetic.push(String(user.userId))
    } catch (error) {
      cleanupErrors.push(`cleanup verify ${user.userId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const files = [
    'runtime-session-list.json',
    'runtime-session-revoke.json',
  ].filter((name) => {
    try { readFileSync(`${ARTIFACT_DIR}/${name}`); return true } catch { return false }
  })

  const manifest = {
    featureId: 'AUTH-010',
    authenticationAuthority: 'Better Auth',
    mode: 'CONTROLLED_REMOTE_HTTP_E2E',
    testedCommitSha: TESTED_COMMIT_SHA,
    worker: 'luckread-w01-payload',
    w02Worker: 'luckread-w02',
    databaseName: DATABASE_NAME,
    baseUrl: BASE_URL,
    testId: TEST_ID,
    executedAt: new Date().toISOString(),
    dependency: {
      wranglerVersion: WRANGLER_VERSION,
      nodeVersion: process.version,
    },
    assertions: {
      executionCompleted: failures.length === 0,
      syntheticCleanupCompleted: cleanupErrors.length === 0 && remainingSynthetic.length === 0,
      failures,
    },
    artifactHashes: Object.fromEntries(
      files.map((name) => [
        name,
        createHash('sha256').update(readFileSync(`${ARTIFACT_DIR}/${name}`)).digest('hex'),
      ]),
    ),
    secretsExposed: false,
  }

  writeJson('runtime-manifest.json', manifest)

  if (failures.length > 0 || cleanupErrors.length > 0 || remainingSynthetic.length > 0) {
    writeJson('runtime-failure.json', {
      featureId: 'AUTH-010',
      authenticationAuthority: 'Better Auth',
      testedCommitSha: TESTED_COMMIT_SHA,
      failures,
      cleanupErrors,
      remainingSynthetic,
    })
    process.exitCode = 1
  }
}
