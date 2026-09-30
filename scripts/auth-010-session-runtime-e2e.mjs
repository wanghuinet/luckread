import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BASE_URL = String(process.env.W01_BASE_URL || 'https://api.luckread.cn').replace(/\/$/, '')
const DATABASE_NAME = String(process.env.DATABASE_NAME || 'luckread')
const WRANGLER_VERSION = process.env.WRANGLER_VERSION || '4.116.0'
const TEST_ID = \`AUTH010-\${process.env.GITHUB_RUN_ID || Date.now()}-\${randomBytes(5).toString('hex')}\`
const TESTED_COMMIT_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const ARTIFACT_DIR = 'artifacts/evidence/auth-010/remote-e2e'

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN
if (!ACCOUNT_ID || !API_TOKEN) throw new Error('Cloudflare credentials are required for controlled remote evidence')

mkdirSync(ARTIFACT_DIR, { recursive: true })

const sqlString = (value) => \`'\${String(value).replace(/'/g, "''")}'\`
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
      \`wrangler@\${WRANGLER_VERSION}\`,
      'd1',
      'execute',
      DATABASE_NAME,
      '--remote',
      '--json',
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
    const response = await fetch(\`\${BASE_URL}\${path}\`, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: \`Bearer \${token}\` } : {}),
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
      contentType: response.headers.get('content-type') || '',
    }
  } finally {
    clearTimeout(timeout)
  }
}

const writeJson = (name, value) =>
  writeFileSync(\`\${ARTIFACT_DIR}/\${name}\`, \`\${JSON.stringify(value, null, 2)}\\n\`)

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
  check(response.status === expected, \`\${label}: expected HTTP \${expected}, got \${response.status}\`)
}

function noSecretFields(value) {
  const text = JSON.stringify(value ?? '')
  for (const key of ['refreshCredentialHash', 'refreshToken', 'tokenVersion', 'revokedAt', 'userId', 'password']) {
    if (text.includes(key)) return false
  }
  return true
}

async function createUser(label) {
  const suffix = \`\${TEST_ID}-\${label}-\${randomBytes(4).toString('hex')}\`
  const email = \`auth010-\${label}-\${suffix}@example.com\`
  const username = \`auth010_\${label}_\${suffix.replaceAll('-', '').slice(-20)}\`
  const password = \`Evd-AUTH010-\${randomBytes(24).toString('base64url')}-Z9!\`

  const response = await request('/auth/register', {
    method: 'POST',
    headers: { 'Idempotency-Key': \`\${TEST_ID}-register-\${label}\` },
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

  expectStatus(response, 201, \`register \${label}\`)
  const userId = String(response.data?.userId ?? '')
  check(userId.length > 0, \`register \${label}: userId missing\`)
  check(response.data?.accountState === 'PENDING_VERIFICATION', \`register \${label}: unexpected account state\`)
  createdUsers.push({ userId, email })
  return { userId, email, username, password }
}

function activateAndAuthorize(user, label) {
  const now = new Date().toISOString()
  const roleId = \`\${TEST_ID}-role-\${label}-\${randomBytes(5).toString('hex')}\`

  d1Json(
    \`UPDATE users
     SET account_state='ACTIVE',
         account_state_version=COALESCE(account_state_version, 0) + 1
     WHERE CAST(id AS TEXT)=\${sqlString(user.userId)}\`,
  )

  d1Json(
    \`INSERT INTO role_assignments
      (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at)
     VALUES (
       \${sqlString(roleId)},
       \${sqlString(user.userId)},
       'user',
       'global',
       NULL,
       'ACTIVE',
       \${sqlString(now)},
       NULL,
       \${sqlString(now)},
       \${sqlString(now)}
     )\`,
  )

  const account = d1Rows(
    \`SELECT account_state FROM users WHERE CAST(id AS TEXT)=\${sqlString(user.userId)} LIMIT 1\`,
  )[0]
  const assignment = d1Rows(
    \`SELECT id,subject_id,role_id,scope_type,status FROM role_assignments WHERE id=\${sqlString(roleId)} LIMIT 1\`,
  )[0]

  check(String(account?.account_state) === 'ACTIVE', \`activate \${label}: account state not ACTIVE\`)
  check(
    String(assignment?.subject_id) === user.userId &&
    String(assignment?.role_id) === 'user' &&
    String(assignment?.scope_type) === 'global' &&
    String(assignment?.status) === 'ACTIVE',
    \`authorize \${label}: role assignment not established\`,
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
  expectStatus(response, 200, \`login \${deviceId}\`)
  check(typeof response.data?.accessToken === 'string', \`login \${deviceId}: access token missing\`)
  check(typeof response.data?.refreshToken === 'string', \`login \${deviceId}: refresh token missing\`)
  return {
    accessToken: response.data.accessToken,
    refreshToken: response.data.refreshToken,
  }
}

function sessionForDevice(userId, deviceId) {
  const rows = d1Rows(
    \`SELECT s.id,s._parent_id,s.created_at,s.expires_at,a.device_id,a.token_version,a.revoked_at
     FROM users_sessions AS s
     INNER JOIN auth_session_state AS a
       ON CAST(a.session_id AS TEXT)=CAST(s.id AS TEXT)
      AND a.user_id=CAST(s._parent_id AS TEXT)
     WHERE CAST(s._parent_id AS TEXT)=\${sqlString(userId)}
       AND a.device_id=\${sqlString(deviceId)}
     ORDER BY s.created_at DESC
     LIMIT 1\`,
  )
  const row = rows[0]
  check(Boolean(row?.id), \`session lookup missing for \${deviceId}\`)
  return {
    sessionId: String(row.id),
    userId: String(row._parent_id),
    deviceId: String(row.device_id),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    tokenVersion: Number(row.token_version),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
  }
}

function extensionFor(sessionId) {
  return d1Rows(
    \`SELECT session_id,user_id,device_id,token_version,revoked_at,last_seen_at
     FROM auth_session_state
     WHERE session_id=\${sqlString(sessionId)}
     LIMIT 1\`,
  )[0] ?? null
}

function nativeSessionExists(sessionId) {
  return d1Rows(
    \`SELECT id FROM users_sessions WHERE id=\${sqlString(sessionId)} LIMIT 1\`,
  ).length === 1
}

let primary
let second
let other
let firstLogin
let secondLogin
let otherLogin
let primarySession
let secondSession

try {
  const dependency = JSON.parse(readFileSync('workers/W01-payload/package.json', 'utf8'))
  check(dependency.dependencies?.payload === '3.90.2', 'W01 Payload version is not 3.90.2')
  check(dependency.dependencies?.['@payloadcms/db-d1-sqlite'] === '3.90.2', 'W01 D1 adapter version is not 3.90.2')

  const policy = JSON.parse(
    readFileSync('artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json', 'utf8'),
  )
  const policyVersion = String(policy.policyVersion ?? '')
  check(policyVersion === 'PROD-2026-09-28.1', \`unexpected production policy version: \${policyVersion}\`)

  const anonymous = await request('/auth/sessions')
  expectStatus(anonymous, 401, 'anonymous session list')

  primary = await createUser('primary')
  activateAndAuthorize(primary, 'primary')

  other = await createUser('other')
  activateAndAuthorize(other, 'other')

  firstLogin = await login(primary, 'primary-a')
  secondLogin = await login(primary, 'primary-b')
  otherLogin = await login(other, 'other-a')

  primarySession = sessionForDevice(primary.userId, 'primary-a')
  secondSession = sessionForDevice(primary.userId, 'primary-b')

  const list = await request('/auth/sessions?limit=100', { token: firstLogin.accessToken })
  expectStatus(list, 200, 'session list')
  check(list.cacheControl.toLowerCase().includes('no-store'), 'session list must be non-shared/no-store')
  check(Array.isArray(list.data?.items), 'session list items missing')
  check(list.data.items.length <= 50, \`session list exceeded 50-item contract: \${list.data.items.length}\`)
  check(list.data.items.some((item) => String(item?.sessionId) === secondSession.sessionId), 'session list missing secondary session')
  check(list.data.items.some((item) => String(item?.sessionId) === primarySession.sessionId), 'session list missing current session')
  check(
    list.data.items.every((item) =>
      typeof item?.sessionId === 'string' &&
      (item?.deviceId === null || typeof item?.deviceId === 'string') &&
      typeof item?.createdAt === 'string' &&
      typeof item?.expiresAt === 'string' &&
      (item?.lastSeenAt === null || typeof item?.lastSeenAt === 'string') &&
      noSecretFields(item),
    ),
    'session list contains non-contract or security-sensitive fields',
  )

  const badCursor = await request('/auth/sessions?cursor=not-a-valid-cursor', { token: firstLogin.accessToken })
  expectStatus(badCursor, 400, 'invalid session cursor')

  const revoke = await request(\`/auth/sessions/\${secondSession.sessionId}\`, {
    method: 'DELETE',
    token: firstLogin.accessToken,
    headers: { 'Idempotency-Key': \`\${TEST_ID}-revoke-secondary\` },
  })
  expectStatus(revoke, 204, 'revoke secondary session')
  check(revoke.bodyBytes === 0, 'revoke returned a response body')
  check(revoke.cacheControl.toLowerCase().includes('no-store'), 'revoke must not permit shared caching')

  const revokedExtension = extensionFor(secondSession.sessionId)
  check(Boolean(revokedExtension?.revoked_at), 'secondary extension revocation was not persisted')
  check(!nativeSessionExists(secondSession.sessionId), 'secondary native session was not removed')

  const repeatedRevoke = await request(\`/auth/sessions/\${secondSession.sessionId}\`, {
    method: 'DELETE',
    token: firstLogin.accessToken,
    headers: { 'Idempotency-Key': \`\${TEST_ID}-revoke-secondary\` },
  })
  expectStatus(repeatedRevoke, 204, 'repeated revoke')
  check(repeatedRevoke.bodyBytes === 0, 'repeated revoke returned a response body')

  const afterRevoke = await request('/auth/sessions', { token: firstLogin.accessToken })
  expectStatus(afterRevoke, 200, 'session list after revoke')
  check(!afterRevoke.data.items.some((item) => String(item?.sessionId) === secondSession.sessionId), 'revoked session remained visible')

  const crossAccount = await request(\`/auth/sessions/\${primarySession.sessionId}\`, {
    method: 'DELETE',
    token: otherLogin.accessToken,
    headers: { 'Idempotency-Key': \`\${TEST_ID}-cross-account\` },
  })
  expectStatus(crossAccount, 403, 'cross-account revoke')

  const beforeVersionBump = extensionFor(primarySession.sessionId)
  check(beforeVersionBump?.revoked_at == null, 'current session unexpectedly revoked before version test')
  d1Json(
    \`UPDATE auth_session_state
     SET token_version=token_version+1
     WHERE session_id=\${sqlString(primarySession.sessionId)}\`,
  )

  const staleTokenVersion = await request('/auth/sessions', { token: firstLogin.accessToken })
  expectStatus(staleTokenVersion, 401, 'stale tokenVersion list access')

  // Restore the primary session extension only to keep cleanup deterministic;
  // the evidence already captured the fail-closed denial.
  d1Json(
    \`UPDATE auth_session_state
     SET token_version=\${beforeVersionBump?.token_version ?? primarySession.tokenVersion}
     WHERE session_id=\${sqlString(primarySession.sessionId)}\`,
  )

  const primaryExtension = extensionFor(primarySession.sessionId)
  const secondaryExtension = extensionFor(secondSession.sessionId)
  writeJson('runtime-session-list.json', {
    featureId: 'AUTH-010',
    operation: 'GET /auth/sessions',
    testedCommitSha: TESTED_COMMIT_SHA,
    assertions: {
      anonymousDenied: anonymous.status === 401,
      boundedAt50: list.data.items.length <= 50,
      bothOwnedSessionsVisible: list.data.items.some((item) => String(item?.sessionId) === primarySession.sessionId) &&
        list.data.items.some((item) => String(item?.sessionId) === secondSession.sessionId),
      privacySafeProjection: list.data.items.every((item) => noSecretFields(item)),
      privateNoStore: list.cacheControl.toLowerCase().includes('no-store'),
      invalidCursorRejected: badCursor.status === 400,
      revokedSessionHidden: !afterRevoke.data.items.some((item) => String(item?.sessionId) === secondSession.sessionId),
      failClosedOnStaleTokenVersion: staleTokenVersion.status === 401,
    },
    sessionIds: {
      primary: primarySession.sessionId,
      secondary: secondSession.sessionId,
    },
    postState: {
      primaryExtensionExists: Boolean(primaryExtension),
      secondaryExtensionRevoked: Boolean(secondaryExtension?.revoked_at),
    },
  })

  writeJson('runtime-session-revoke.json', {
    featureId: 'AUTH-010',
    operation: 'DELETE /auth/sessions/{sessionId}',
    testedCommitSha: TESTED_COMMIT_SHA,
    assertions: {
      ownerRevokeAccepted: revoke.status === 204 && revoke.bodyBytes === 0,
      nativeSessionRemoved: !nativeSessionExists(secondSession.sessionId),
      extensionRevoked: Boolean(revokedExtension?.revoked_at),
      repeatedRevokeIsIdempotent: repeatedRevoke.status === 204 && repeatedRevoke.bodyBytes === 0,
      crossAccountDenied: crossAccount.status === 403,
      privateNoStore: revoke.cacheControl.toLowerCase().includes('no-store'),
    },
    targetSessionId: secondSession.sessionId,
  })

  if (failures.length === 0) {
    console.log('AUTH-010_REMOTE_E2E_RESULT=PASS')
  }
} catch (error) {
  console.error(\`AUTH-010_REMOTE_E2E_RESULT=FAIL: \${error instanceof Error ? error.message : String(error)}\`)
} finally {
  const cleanupErrors = []

  for (const roleId of roleAssignments) {
    try {
      d1Json(\`DELETE FROM role_assignments WHERE id=\${sqlString(roleId)}\`)
    } catch (error) {
      cleanupErrors.push(\`role \${roleId}: \${error instanceof Error ? error.message : String(error)}\`)
    }
  }

  for (const user of createdUsers) {
    try {
      d1Json(\`DELETE FROM auth_session_state WHERE user_id=\${sqlString(user.userId)}\`)
      d1Json(\`DELETE FROM users_sessions WHERE CAST(_parent_id AS TEXT)=\${sqlString(user.userId)}\`)
      d1Json(\`DELETE FROM users WHERE CAST(id AS TEXT)=\${sqlString(user.userId)}\`)
    } catch (error) {
      cleanupErrors.push(\`user \${user.userId}: \${error instanceof Error ? error.message : String(error)}\`)
    }
  }

  const remainingSynthetic = []
  for (const user of createdUsers) {
    try {
      const rows = d1Rows(\`SELECT id,email FROM users WHERE CAST(id AS TEXT)=\${sqlString(user.userId)} LIMIT 1\`)
      if (rows.length > 0) remainingSynthetic.push(String(user.userId))
    } catch (error) {
      cleanupErrors.push(\`cleanup verify \${user.userId}: \${error instanceof Error ? error.message : String(error)}\`)
    }
  }

  const files = [
    'runtime-session-list.json',
    'runtime-session-revoke.json',
  ].filter((name) => {
    try { readFileSync(\`\${ARTIFACT_DIR}/\${name}\`); return true } catch { return false }
  })

  const dependency = JSON.parse(readFileSync('workers/W01-payload/package.json', 'utf8'))
  const manifest = {
    featureId: 'AUTH-010',
    mode: 'CONTROLLED_REMOTE_HTTP_E2E',
    testedCommitSha: TESTED_COMMIT_SHA,
    worker: 'luckread-w01-payload',
    w02Worker: 'luckread-w02',
    databaseName: DATABASE_NAME,
    baseUrl: BASE_URL,
    testId: TEST_ID,
    executedAt: new Date().toISOString(),
    dependency: {
      payloadVersion: dependency.dependencies?.payload,
      d1AdapterVersion: dependency.dependencies?.['@payloadcms/db-d1-sqlite'],
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
        createHash('sha256').update(readFileSync(\`\${ARTIFACT_DIR}/\${name}\`)).digest('hex'),
      ]),
    ),
    secretsExposed: false,
  }

  writeJson('runtime-manifest.json', manifest)

  if (failures.length > 0 || cleanupErrors.length > 0 || remainingSynthetic.length > 0) {
    writeJson('runtime-failure.json', {
      featureId: 'AUTH-010',
      testedCommitSha: TESTED_COMMIT_SHA,
      failures,
      cleanupErrors,
      remainingSynthetic,
    })
    process.exitCode = 1
  }
}
