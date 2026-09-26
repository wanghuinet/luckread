import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'

const BASE_URL = String(process.env.W01_BASE_URL || 'https://luckread-w01-payload.wanghui-79b.workers.dev').replace(/\/$/, '')
const DATABASE_NAME = String(process.env.DATABASE_NAME || 'luckread')
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const TEST_RUN_ID = String(process.env.GITHUB_RUN_ID || Date.now())
const TESTED_COMMIT_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const WORKER_PATH = 'workers/W01-payload'
const WRANGLER_VERSION = process.env.WRANGLER_VERSION || '4.116.0'
const WRANGLER_CONFIG = 'workers/W01-payload/wrangler.jsonc'
const ARTIFACT_DIR = 'artifacts/evidence/auth-002/runtime'
const GATE1_DIR = 'artifacts/evidence/auth-002/gate1'

if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
  throw new Error('Cloudflare credentials are required for controlled remote evidence')
}

mkdirSync(ARTIFACT_DIR, { recursive: true })
mkdirSync(GATE1_DIR, { recursive: true })

const testId = `AUTH002-${TEST_RUN_ID}-${randomBytes(5).toString('hex')}`
const nowIso = () => new Date().toISOString()
const futureIso = (minutes = 120) => new Date(Date.now() + minutes * 60_000).toISOString()
const pastIso = () => new Date(Date.now() - 60_000).toISOString()
const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`

async function request(path, { method = 'GET', body, token, timeoutMs = 20_000 } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const rawBody = await response.text()
    let data = null
    try {
      data = rawBody ? JSON.parse(rawBody) : null
    } catch {
      data = rawBody || null
    }
    return {
      status: response.status,
      ok: response.ok,
      data,
      contentType: response.headers.get('content-type') || '',
      requestId: response.headers.get('x-request-id') || '',
      cfRay: response.headers.get('cf-ray') || '',
    }
  } finally {
    clearTimeout(timeout)
  }
}

function unwrapRows(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (Array.isArray(item)) return item
      if (item && Array.isArray(item.results)) return item.results
      if (item && Array.isArray(item.result)) return item.result
      return []
    })
  }
  if (value && Array.isArray(value.results)) return value.results
  if (value && Array.isArray(value.result)) return value.result
  return []
}

function d1Json(command) {
  const output = execFileSync(
    'npx',
    ['--yes', `wrangler@${WRANGLER_VERSION}`, 'd1', 'execute', DATABASE_NAME, '--remote', '--json', '--config', WRANGLER_CONFIG, '--command', command],
    {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  try {
    return JSON.parse(output)
  } catch {
    throw new Error('D1 evidence command did not return valid JSON')
  }
}

function d1Rows(command) {
  return unwrapRows(d1Json(command))
}

function writeJson(name, value) {
  writeFileSync(`${ARTIFACT_DIR}/${name}`, `${JSON.stringify(value, null, 2)}\n`)
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, got ${response.status}`)
  }
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error)
}

const dependency = JSON.parse(readFileSync(`${WORKER_PATH}/package.json`, 'utf8'))
const gitVersion = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim()

const negativeCases = []
const concurrencyCases = []
const context = {
  createdUsers: [],
  sessions: [],
  roleAssignments: [],
  cleanupErrors: [],
}

async function createUser(label) {
  const suffix = `${TEST_RUN_ID}-${randomBytes(4).toString('hex')}`
  const email = `auth002-${label}-${suffix}@example.com`
  const username = `auth002_${label}_${suffix}`
  const password = `A2-${randomBytes(24).toString('base64url')}-Z9!`
  const response = await request('/api/users', {
    method: 'POST',
    body: { email, username, password },
  })
  if (!response.ok) {
    let orphanRecovered = false
    try {
      const rows = d1Rows(
        `SELECT id,email FROM users WHERE email=${sqlString(email)} LIMIT 2`,
      )
      if (rows.length === 1 && String(rows[0]?.email ?? '') === email) {
        context.createdUsers.push({ userId: String(rows[0].id), email })
        orphanRecovered = true
      } else if (rows.length > 1) {
        context.cleanupErrors.push(`createUser(${label}) orphan lookup was ambiguous`)
      }
    } catch (error) {
      context.cleanupErrors.push(`createUser(${label}) orphan lookup failed: ${safeError(error)}`)
    }
    writeJson('runtime-create-user-diagnostic.json', {
      testId,
      operation: 'POST /api/users',
      label,
      status: response.status,
      contentType: response.contentType,
      requestId: response.requestId || null,
      cfRay: response.cfRay || null,
      message: response.data?.errors?.[0]?.message ?? response.data?.message ?? null,
      errorCount: Array.isArray(response.data?.errors) ? response.data.errors.length : null,
      orphanRecoveredForCleanup: orphanRecovered,
      testedCommitSha: TESTED_COMMIT_SHA,
    })
    throw new Error(`createUser(${label}) failed with HTTP ${response.status}`)
  }
  const userId = response.data?.doc?.id ?? response.data?.id
  if (userId === undefined || userId === null) throw new Error(`createUser(${label}) did not return a user id`)
  context.createdUsers.push({ userId: String(userId), email })
  return { userId: String(userId), email, password, username }
}

async function captureUserAuthState(user, label) {
  const rows = d1Rows(
    `SELECT id,email,
      CASE WHEN hash IS NOT NULL AND length(hash) > 0 THEN 1 ELSE 0 END AS hash_present,
      CASE WHEN salt IS NOT NULL AND length(salt) > 0 THEN 1 ELSE 0 END AS salt_present,
      COALESCE(login_attempts, 0) AS login_attempts,
      CASE WHEN lock_until IS NOT NULL THEN 1 ELSE 0 END AS lock_until_present
     FROM users WHERE CAST(id AS TEXT)=${sqlString(user.userId)} LIMIT 1`,
  )
  const row = rows[0]
  const artifact = {
    testId,
    operation: 'remote D1 user auth state pre-login',
    label,
    userId: user.userId,
    userExists: Boolean(row?.id),
    emailMatches: String(row?.email ?? '') === user.email,
    hashPresent: Number(row?.hash_present ?? 0) === 1,
    saltPresent: Number(row?.salt_present ?? 0) === 1,
    loginAttempts: Number(row?.login_attempts ?? 0),
    lockUntilPresent: Number(row?.lock_until_present ?? 0) === 1,
    secretValuesRedacted: true,
    testedCommitSha: TESTED_COMMIT_SHA,
  }
  writeJson(`runtime-user-auth-state-${label}.json`, artifact)
  return artifact
}

async function preparePositiveAuthSubject(user, label) {
  const now = nowIso()
  const roleAssignmentId = `auth002-${TEST_RUN_ID}-${label}-${randomBytes(6).toString('hex')}`

  const before = d1Rows(
    `SELECT id,email,account_state,account_state_version
     FROM users
     WHERE CAST(id AS TEXT)=${sqlString(user.userId)}
     LIMIT 1`,
  )[0]

  if (!before?.id || String(before.email ?? '') !== user.email) {
    throw new Error(`preparePositiveAuthSubject(${label}) user identity not found`)
  }

  d1Json(
    `UPDATE users
       SET account_state='ACTIVE',
           account_state_version=COALESCE(account_state_version, 0) + 1
     WHERE CAST(id AS TEXT)=${sqlString(user.userId)}`,
  )

  const assignments = d1Rows(
    `SELECT id,subject_id,role_id,scope_type,status
     FROM role_assignments
     WHERE CAST(subject_id AS TEXT)=${sqlString(user.userId)}`,
  )
  if (assignments.length !== 0) {
    throw new Error(`preparePositiveAuthSubject(${label}) synthetic user already has role assignments`)
  }

  d1Json(
    `INSERT INTO role_assignments
      (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at)
     VALUES (
       ${sqlString(roleAssignmentId)},
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
  context.roleAssignments.push(roleAssignmentId)

  const after = d1Rows(
    `SELECT id,email,account_state,account_state_version
     FROM users
     WHERE CAST(id AS TEXT)=${sqlString(user.userId)}
     LIMIT 1`,
  )[0]
  const assignment = d1Rows(
    `SELECT id,subject_id,role_id,scope_type,status,valid_from,valid_until
     FROM role_assignments
     WHERE id=${sqlString(roleAssignmentId)}
     LIMIT 1`,
  )[0]

  if (String(after?.account_state ?? '') !== 'ACTIVE') {
    throw new Error(`preparePositiveAuthSubject(${label}) account state was not activated`)
  }
  if (
    String(assignment?.subject_id ?? '') !== user.userId ||
    String(assignment?.role_id ?? '') !== 'user' ||
    String(assignment?.scope_type ?? '') !== 'global' ||
    String(assignment?.status ?? '') !== 'ACTIVE'
  ) {
    throw new Error(`preparePositiveAuthSubject(${label}) canonical role assignment was not established`)
  }

  writeJson(`runtime-auth-fixture-${label}.json`, {
    testId,
    operation: 'controlled positive-auth fixture',
    environmentClass: 'CONTROLLED_REMOTE_D1',
    userId: user.userId,
    email: user.email,
    precondition: {
      accountState: before.account_state ?? null,
      accountStateVersion: Number(before.account_state_version ?? 0),
      roleAssignmentCountBefore: assignments.length,
    },
    activated: {
      accountState: String(after.account_state),
      accountStateVersion: Number(after.account_state_version ?? 0),
    },
    roleAssignment: {
      id: String(assignment.id),
      subjectId: String(assignment.subject_id),
      roleId: String(assignment.role_id),
      scopeType: String(assignment.scope_type),
      status: String(assignment.status),
      validFrom: String(assignment.valid_from),
    },
    testedCommitSha: TESTED_COMMIT_SHA,
  })

  return { roleAssignmentId, accountState: String(after.account_state) }
}

async function login(user, deviceId) {
  const nativeResponse = await request('/api/users/login', {
    method: 'POST',
    body: { email: user.email, password: user.password },
  })
  writeJson('runtime-native-payload-login.json', {
    testId,
    operation: 'POST /api/users/login',
    status: nativeResponse.status,
    contentType: nativeResponse.contentType,
    requestId: nativeResponse.requestId,
    cfRay: nativeResponse.cfRay,
    successShape: Boolean(nativeResponse.data?.token && nativeResponse.data?.user?.id),
    errorCode: nativeResponse.data?.errors?.[0]?.name ?? nativeResponse.data?.error?.code ?? null,
    errorMessage: typeof nativeResponse.data?.errors?.[0]?.message === 'string'
      ? nativeResponse.data.errors[0].message.slice(0, 160)
      : typeof nativeResponse.data?.error?.message === 'string'
        ? nativeResponse.data.error.message.slice(0, 160)
        : null,
    secretsRedacted: true,
    testedCommitSha: TESTED_COMMIT_SHA,
  })
  if (nativeResponse.status !== 200) {
    throw new Error(`native Payload login failed: HTTP ${nativeResponse.status}`)
  }

  const response = await request('/auth/login', {
    method: 'POST',
    body: { identity: user.email, credential: user.password, deviceId },
  })
  assertStatus(response, 200, `login ${deviceId}`)
  if (!response.data?.accessToken || !response.data?.refreshToken) {
    throw new Error(`login ${deviceId} returned no auth pair`)
  }
  return {
    accessToken: response.data.accessToken,
    refreshToken: response.data.refreshToken,
    layer: response.data.layer,
    expiresIn: response.data.expiresIn,
  }
}
function loadSessionForUser(userId) {
  const rows = d1Rows(
    `SELECT id,_parent_id,created_at,expires_at FROM users_sessions WHERE CAST(_parent_id AS TEXT)=${sqlString(userId)} ORDER BY created_at DESC LIMIT 1`,
  )
  const row = rows[0]
  if (!row?.id) throw new Error(`native session row missing for user ${userId}`)
  const session = {
    sessionId: String(row.id),
    userId: String(row._parent_id),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  }
  context.sessions.push(session.sessionId)
  return session
}

function extensionForSession(sessionId) {
  const rows = d1Rows(
    `SELECT session_id,user_id,device_id,token_version,revoked_at,last_seen_at FROM auth_session_state WHERE session_id=${sqlString(sessionId)} LIMIT 1`,
  )
  return rows[0] ?? null
}

async function getMe(token) {
  return request('/api/users/me', { token })
}

function updateNativeExpiry(sessionId, expiresAt) {
  d1Json(
    `UPDATE users_sessions SET expires_at=${sqlString(expiresAt)} WHERE id=${sqlString(sessionId)}`,
  )
}

function revokeExtension(sessionId) {
  d1Json(
    `UPDATE auth_session_state SET revoked_at=${sqlString(nowIso())} WHERE session_id=${sqlString(sessionId)}`,
  )
}

function deleteExtension(sessionId) {
  d1Json(`DELETE FROM auth_session_state WHERE session_id=${sqlString(sessionId)}`)
}

function changeExtensionUser(sessionId, userId) {
  d1Json(
    `UPDATE auth_session_state SET user_id=${sqlString(userId)} WHERE session_id=${sqlString(sessionId)}`,
  )
}

function bumpTokenVersion(sessionId) {
  d1Json(
    `UPDATE auth_session_state SET token_version=token_version+1 WHERE session_id=${sqlString(sessionId)}`,
  )
}

async function cleanup() {
  for (const roleAssignmentId of context.roleAssignments) {
    try {
      d1Json(`DELETE FROM role_assignments WHERE id=${sqlString(roleAssignmentId)}`)
    } catch (error) {
      context.cleanupErrors.push(`cleanup role assignment ${roleAssignmentId}: ${safeError(error)}`)
    }
  }

  for (const user of context.createdUsers) {
    try {
      const rows = d1Rows(
        `SELECT id,email FROM users WHERE CAST(id AS TEXT)=${sqlString(user.userId)} LIMIT 1`,
      )
      if (rows[0]?.email !== user.email) {
        context.cleanupErrors.push(`cleanup identity mismatch for user ${user.userId}`)
        continue
      }
      d1Json(`DELETE FROM auth_session_state WHERE user_id=${sqlString(user.userId)}`)
      d1Json(
        `DELETE FROM users_sessions WHERE CAST(_parent_id AS TEXT)=${sqlString(user.userId)}`,
      )
      d1Json(`DELETE FROM users WHERE CAST(id AS TEXT)=${sqlString(user.userId)}`)
    } catch (error) {
      context.cleanupErrors.push(safeError(error))
    }
  }
}

let gate1 = { accepted: false }
let creationArtifact
let validationArtifact
let logoutArtifact
let extensionArtifact

try {
  if (dependency.dependencies?.payload !== '3.87.1' || dependency.dependencies?.['@payloadcms/db-d1-sqlite'] !== '3.87.1') {
    throw new Error('W01 dependency contract mismatch')
  }
  const lockText = readFileSync(`${WORKER_PATH}/pnpm-lock.yaml`, 'utf8')
  if (!lockText.includes('payload:')) throw new Error('W01 lockfile missing Payload resolution')
  if (!lockText.includes('@payloadcms/db-d1-sqlite')) throw new Error('W01 lockfile missing D1 adapter resolution')

  const catalog = d1Rows(
    `SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('table','index') ORDER BY type,name`,
  )
  const extensionSchema = d1Rows('PRAGMA table_info("auth_session_state")')
  const migrations = d1Rows(
    `SELECT id,name,batch FROM payload_migrations WHERE name IS NOT NULL ORDER BY id DESC LIMIT 20`,
  )
  const catalogNames = new Set(catalog.map((row) => String(row.name ?? '')))
  const requiredIndexes = [
    'auth_session_state_user_id_idx',
    'auth_session_state_device_id_idx',
    'auth_session_state_token_version_idx',
    'auth_session_state_revoked_at_idx',
  ]
  for (const name of ['users', 'users_sessions', 'auth_session_state', ...requiredIndexes]) {
    if (!catalogNames.has(name)) throw new Error(`Gate-1 missing remote object: ${name}`)
  }
  const expectedColumns = ['session_id', 'user_id', 'device_id', 'token_version', 'refresh_credential_hash', 'revoked_at', 'last_seen_at']
  for (const name of expectedColumns) {
    if (!extensionSchema.some((row) => String(row.name) === name)) {
      throw new Error(`Gate-1 missing auth_session_state column: ${name}`)
    }
  }
  gate1 = {
    accepted: true,
    environmentClass: 'CONTROLLED_REMOTE_D1',
    databaseName: DATABASE_NAME,
    testedCommitSha: TESTED_COMMIT_SHA,
    requiredTables: ['users', 'users_sessions', 'auth_session_state'],
    requiredIndexes,
    extensionColumns: extensionSchema.map((row) => String(row.name)),
    recentMigrations: migrations.map((row) => ({ id: row.id, name: row.name, batch: row.batch })),
  }
  writeFileSync(`${GATE1_DIR}/schema.json`, `${JSON.stringify(gate1, null, 2)}\n`)

  const primary = await createUser('primary')
  await captureUserAuthState(primary, 'primary')
  await preparePositiveAuthSubject(primary, 'primary')
  const primaryLogin = await login(primary, 'device-primary')
  const primaryMe = await getMe(primaryLogin.accessToken)
  assertStatus(primaryMe, 200, 'primary /api/users/me')
  if (String(primaryMe.data?.user?.id ?? primaryMe.data?.id) !== primary.userId) {
    throw new Error('primary user binding mismatch')
  }
  const primarySession = loadSessionForUser(primary.userId)
  const primaryExtension = extensionForSession(primarySession.sessionId)
  if (!primaryExtension) throw new Error('primary extension state missing')
  if (String(primaryExtension.user_id) !== primary.userId) throw new Error('primary extension user mismatch')
  if (String(primaryExtension.device_id) !== 'device-primary') throw new Error('primary extension device mismatch')

  creationArtifact = {
    testId,
    operation: 'POST /auth/login',
    nativeSidObserved: true,
    nativeSid: primarySession.sessionId,
    userBindingObserved: true,
    userId: primary.userId,
    createdAtObserved: true,
    createdAtSource: primarySession.createdAt,
    expiresAtObserved: true,
    expiresAtSource: primarySession.expiresAt,
    credentialRedacted: true,
    testedCommitSha: TESTED_COMMIT_SHA,
  }

  validationArtifact = {
    testId,
    nativeSidValidation: primaryMe.ok ? 'PASS' : 'FAIL',
    userBindingValidation: String(primaryMe.data?.user?.id ?? primaryMe.data?.id) === primary.userId ? 'PASS' : 'FAIL',
    expiryDecision: 'PENDING',
    authorizationDecision: primaryMe.ok ? 'ALLOW_VALID' : 'DENY',
    testedCommitSha: TESTED_COMMIT_SHA,
  }

  const refreshed = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: primaryLogin.refreshToken, deviceId: 'device-primary' },
  })
  assertStatus(refreshed, 200, 'primary refresh rotation')
  const rotatedRefreshToken = refreshed.data?.refreshToken
  if (!rotatedRefreshToken) throw new Error('refresh rotation did not return successor credential')

  const replay = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: primaryLogin.refreshToken, deviceId: 'device-primary' },
  })
  negativeCases.push({
    case: 'refresh predecessor replay',
    expected: '401_UNAUTHENTICATED',
    actual: replay.status,
    passed: replay.status === 401,
  })

  const wrongDevice = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: rotatedRefreshToken, deviceId: 'device-wrong' },
  })
  negativeCases.push({
    case: 'wrong device binding',
    expected: '401_UNAUTHENTICATED',
    actual: wrongDevice.status,
    passed: wrongDevice.status === 401,
  })

  revokeExtension(primarySession.sessionId)
  const revokedRefresh = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: rotatedRefreshToken, deviceId: 'device-primary' },
  })
  negativeCases.push({
    case: 'canonical revocation overrides stale native authorization',
    expected: '401_UNAUTHENTICATED',
    actual: revokedRefresh.status,
    passed: revokedRefresh.status === 401,
  })

  const logoutLogin = await login(primary, 'device-logout')
  const logoutMe = await getMe(logoutLogin.accessToken)
  assertStatus(logoutMe, 200, 'logout session validation')
  const logoutSession = loadSessionForUser(primary.userId)
  const logoutResponse = await request('/auth/logout', { method: 'POST', token: logoutLogin.accessToken })
  assertStatus(logoutResponse, 204, 'native logout')
  const postLogout = await getMe(logoutLogin.accessToken)
  const secondLogout = await request('/auth/logout', { method: 'POST', token: logoutLogin.accessToken })
  const logoutExtension = extensionForSession(logoutSession.sessionId)
  logoutArtifact = {
    testId,
    logoutInvocation: logoutResponse.status === 204 ? 'PASS' : 'FAIL',
    nativeSessionRemovalOrRevocation: postLogout.status === 401 ? 'REMOVED_OR_REVOKED' : 'STILL_AUTHORIZED',
    postLogoutValidation: postLogout.status === 401 ? 'DENY' : 'ALLOW',
    secondLogoutStatus: secondLogout.status,
    idempotentSecondLogout: secondLogout.status === 204 || secondLogout.status === 401,
    canonicalExtensionRevocationObserved: Boolean(logoutExtension?.revoked_at),
    testedCommitSha: TESTED_COMMIT_SHA,
  }
  negativeCases.push({
    case: 'post-logout native session',
    expected: '401_UNAUTHENTICATED',
    actual: postLogout.status,
    passed: postLogout.status === 401,
  })

  const expiryLogin = await login(primary, 'device-expiry')
  const expirySession = loadSessionForUser(primary.userId)
  updateNativeExpiry(expirySession.sessionId, pastIso())
  const expiredMe = await getMe(expiryLogin.accessToken)
  validationArtifact.expiryDecision = expiredMe.status === 401 ? 'DENY_EXPIRED' : 'ALLOW_EXPIRED'
  negativeCases.push({
    case: 'expired native session',
    expected: '401_UNAUTHENTICATED',
    actual: expiredMe.status,
    passed: expiredMe.status === 401,
  })

  const missingExtLogin = await login(primary, 'device-missing-extension')
  const missingExtSession = loadSessionForUser(primary.userId)
  deleteExtension(missingExtSession.sessionId)
  const missingExtension = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: missingExtLogin.refreshToken, deviceId: 'device-missing-extension' },
  })
  negativeCases.push({
    case: 'missing extension state',
    expected: '401_UNAUTHENTICATED',
    actual: missingExtension.status,
    passed: missingExtension.status === 401,
  })

  const otherUser = await createUser('other')
  await captureUserAuthState(otherUser, 'other')
  await preparePositiveAuthSubject(otherUser, 'other')
  const wrongBindingLogin = await login(primary, 'device-wrong-user')
  const wrongBindingSession = loadSessionForUser(primary.userId)
  changeExtensionUser(wrongBindingSession.sessionId, otherUser.userId)
  const wrongBinding = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: wrongBindingLogin.refreshToken, deviceId: 'device-wrong-user' },
  })
  negativeCases.push({
    case: 'wrong user binding',
    expected: '401_UNAUTHENTICATED',
    actual: wrongBinding.status,
    passed: wrongBinding.status === 401,
  })

  const tokenVersionLogin = await login(primary, 'device-token-version')
  const tokenVersionSession = loadSessionForUser(primary.userId)
  bumpTokenVersion(tokenVersionSession.sessionId)
  const tokenVersionAttempt = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: tokenVersionLogin.refreshToken, deviceId: 'device-token-version' },
  })
  negativeCases.push({
    case: 'stale tokenVersion invalidation',
    expected: '401_UNAUTHENTICATED',
    actual: tokenVersionAttempt.status,
    passed: tokenVersionAttempt.status === 401,
    disposition: tokenVersionAttempt.status === 401 ? 'VERIFIED' : 'CONTRACT_RUNTIME_GAP',
  })

  const tokenVersionAccessAttempt = await getMe(tokenVersionLogin.accessToken)
  negativeCases.push({
    case: 'stale access tokenVersion invalidation',
    expected: '401_UNAUTHENTICATED',
    actual: tokenVersionAccessAttempt.status,
    passed: tokenVersionAccessAttempt.status === 401,
    disposition: tokenVersionAccessAttempt.status === 401 ? 'VERIFIED' : 'CONTRACT_RUNTIME_GAP',
  })


  const concurrentLogin = await login(primary, 'device-concurrent-refresh')
  const refreshResponses = await Promise.all(
    Array.from({ length: 4 }, () =>
      request('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: concurrentLogin.refreshToken, deviceId: 'device-concurrent-refresh' },
      }),
    ),
  )
  const refreshSuccesses = refreshResponses.filter((item) => item.status === 200).length
  const refreshDenials = refreshResponses.filter((item) => item.status === 401).length
  concurrencyCases.push({
    operation: 'concurrent refresh using one predecessor',
    concurrencyLevel: 4,
    successfulSuccessors: refreshSuccesses,
    deniedFollowers: refreshDenials,
    passed: refreshSuccesses === 1 && refreshDenials === 3,
  })

  const concurrentLogoutLogin = await login(primary, 'device-concurrent-logout')
  const concurrentLogoutResponses = await Promise.all([
    request('/auth/logout', { method: 'POST', token: concurrentLogoutLogin.accessToken }),
    request('/auth/logout', { method: 'POST', token: concurrentLogoutLogin.accessToken }),
  ])
  const concurrentLogoutStatuses = concurrentLogoutResponses.map((item) => item.status)
  const concurrentLogoutSafe =
    concurrentLogoutStatuses.every((status) => status === 204 || status === 401) &&
    concurrentLogoutStatuses.filter((status) => status === 204).length <= 1
  concurrencyCases.push({
    operation: 'concurrent logout',
    concurrencyLevel: 2,
    statuses: concurrentLogoutStatuses,
    passed: concurrentLogoutSafe,
  })

  const concurrencyValidationLogin = await login(primary, 'device-concurrent-validation')
  const concurrentLogoutForValidation = await request('/auth/logout', {
    method: 'POST',
    token: concurrencyValidationLogin.accessToken,
  })
  const postRevocationValidation = await Promise.all([
    getMe(concurrencyValidationLogin.accessToken),
    getMe(concurrencyValidationLogin.accessToken),
  ])
  const concurrentValidationPassed =
    concurrentLogoutForValidation.status === 204 &&
    postRevocationValidation.every((item) => item.status === 401)
  concurrencyCases.push({
    operation: 'validation after revocation boundary',
    concurrencyLevel: 2,
    statuses: postRevocationValidation.map((item) => item.status),
    passed: concurrentValidationPassed,
  })

  const allNegativePass = negativeCases.every((item) => item.passed)
  const allConcurrencyPass = concurrencyCases.every((item) => item.passed)

  const wrongBindingCase = negativeCases.find((item) => item.case === 'wrong user binding')
  const missingExtensionCase = negativeCases.find((item) => item.case === 'missing extension state')

  extensionArtifact = {
    nativeSid: primarySession.sessionId,
    extensionLookupKey: String(primaryExtension.session_id),
    singleSessionIdentity: String(primaryExtension.session_id) === primarySession.sessionId,
    unsupportedDimensionsObserved: [
      'device_id',
      'token_version',
      'revoked_at',
      'last_seen_at',
    ].every((name) => gate1.extensionColumns.includes(name)),
    failClosedOnMismatch: Boolean(wrongBindingCase?.passed && missingExtensionCase?.passed),
    testedCommitSha: TESTED_COMMIT_SHA,
  }

  writeJson('runtime-session-creation.json', creationArtifact)
  writeJson('runtime-validation.json', validationArtifact)
  writeJson('runtime-logout.json', logoutArtifact)
  writeJson('extension-correlation.json', extensionArtifact)
  writeJson('runtime-negative-security.json', {
    testId,
    passed: allNegativePass,
    cases: negativeCases,
    testedCommitSha: TESTED_COMMIT_SHA,
  })
  writeJson('runtime-concurrency.json', {
    testId,
    concurrencyLevel: 4,
    operation: 'mixed session security concurrency suite',
    singleWinnerInvariant: concurrencyCases.find((item) => item.operation.startsWith('concurrent refresh'))?.passed === true,
    actualResult: allConcurrencyPass ? 'PASS' : 'FAIL',
    cases: concurrencyCases,
    testedCommitSha: TESTED_COMMIT_SHA,
  })

  writeJson('runtime-dependency.json', {
    repository: 'wanghuinet/luckread',
    testedCommitSha: TESTED_COMMIT_SHA,
    workerPath: WORKER_PATH,
    payloadVersion: dependency.dependencies?.payload,
    d1AdapterVersion: dependency.dependencies?.['@payloadcms/db-d1-sqlite'],
    nodeVersion: process.version,
    lockfileReference: `${WORKER_PATH}/pnpm-lock.yaml`,
    gitVersion,
  })

  console.log(
    JSON.stringify(
      {
        testId,
        testedCommitSha: TESTED_COMMIT_SHA,
        gate1Accepted: gate1.accepted,
        negativeCasesPassed: allNegativePass,
        concurrencyCasesPassed: allConcurrencyPass,
      },
      null,
      2,
    ),
  )

  if (!allNegativePass || !allConcurrencyPass || context.cleanupErrors.length > 0) {
    throw new Error('AUTH-002 runtime evidence discovered one or more unclosed runtime/security conditions')
  }
} catch (error) {
  console.error(`AUTH-002_RUNTIME_EVIDENCE_FAILED: ${safeError(error)}`)
} finally {
  await cleanup()

  const manifestCore = {
    testedCommitSha: TESTED_COMMIT_SHA,
    environmentClass: 'CONTROLLED_REMOTE_D1',
    databaseName: DATABASE_NAME,
    workflow: process.env.GITHUB_WORKFLOW || 'AUTH-002 Remote Runtime Evidence',
    runId: Number(process.env.GITHUB_RUN_ID || 0),
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
    executedAt: nowIso(),
    deploymentRunId: Number(process.env.DEPLOYMENT_RUN_ID || 0),
    deploymentHeadSha: process.env.DEPLOYMENT_HEAD_SHA || TESTED_COMMIT_SHA,
    baseUrl: BASE_URL,
    gate1,
    cleanup: {
      completed: context.cleanupErrors.length === 0,
      errors: context.cleanupErrors,
    },
  }

  if (!creationArtifact) {
    creationArtifact = {
      testId,
      operation: 'POST /auth/login',
      nativeSidObserved: false,
      userBindingObserved: false,
      createdAtObserved: false,
      expiresAtObserved: false,
      credentialRedacted: true,
      testedCommitSha: TESTED_COMMIT_SHA,
    }
  }
  if (!validationArtifact) {
    validationArtifact = {
      testId,
      nativeSidValidation: 'NOT_EXECUTED',
      userBindingValidation: 'NOT_EXECUTED',
      expiryDecision: 'NOT_EXECUTED',
      authorizationDecision: 'NOT_EXECUTED',
      testedCommitSha: TESTED_COMMIT_SHA,
    }
  }
  if (!logoutArtifact) {
    logoutArtifact = {
      testId,
      logoutInvocation: 'NOT_EXECUTED',
      nativeSessionRemovalOrRevocation: 'NOT_EXECUTED',
      postLogoutValidation: 'NOT_EXECUTED',
      idempotentSecondLogout: false,
      testedCommitSha: TESTED_COMMIT_SHA,
    }
  }
  if (!extensionArtifact) {
    extensionArtifact = {
      nativeSid: '',
      extensionLookupKey: '',
      singleSessionIdentity: false,
      unsupportedDimensionsObserved: false,
      failClosedOnMismatch: false,
      testedCommitSha: TESTED_COMMIT_SHA,
    }
  }

  writeJson('runtime-session-creation.json', creationArtifact)
  writeJson('runtime-validation.json', validationArtifact)
  writeJson('runtime-logout.json', logoutArtifact)
  writeJson('extension-correlation.json', extensionArtifact)

  const allFiles = [
    'runtime-native-payload-login.json',
    'runtime-dependency.json',
    'runtime-create-user-diagnostic.json',
    'runtime-session-creation.json',
    'runtime-validation.json',
    'runtime-logout.json',
    'extension-correlation.json',
    'runtime-negative-security.json',
    'runtime-concurrency.json',
  ]
  for (const label of ['primary', 'other']) {
    if (readJsonSafe(`runtime-user-auth-state-${label}.json`)) {
      allFiles.push(`runtime-user-auth-state-${label}.json`)
    }
  }

  if (!readJsonSafe('runtime-create-user-diagnostic.json')) {
    writeJson('runtime-create-user-diagnostic.json', {
      testId,
      operation: 'POST /api/users',
      status: null,
      contentType: '',
      requestId: null,
      cfRay: null,
      message: null,
      errorCount: null,
      disposition: 'NOT_TRIGGERED',
      testedCommitSha: TESTED_COMMIT_SHA,
    })
  }

  if (!readJsonSafe('runtime-negative-security.json')) {
    writeJson('runtime-negative-security.json', {
      testId,
      passed: false,
      cases: negativeCases,
      testedCommitSha: TESTED_COMMIT_SHA,
    })
  }
  if (!readJsonSafe('runtime-concurrency.json')) {
    writeJson('runtime-concurrency.json', {
      testId,
      concurrencyLevel: 0,
      operation: 'not executed',
      singleWinnerInvariant: false,
      actualResult: 'NOT_EXECUTED',
      cases: concurrencyCases,
      testedCommitSha: TESTED_COMMIT_SHA,
    })
  }

  manifestCore.artifactHashes = Object.fromEntries(
    [...allFiles].map((file) => [
      file,
      createHash('sha256').update(readFileSync(`${ARTIFACT_DIR}/${file}`)).digest('hex'),
    ]),
  )

  writeJson('runtime-manifest.json', manifestCore)
}

function readJsonSafe(name) {
  try {
    return JSON.parse(readFileSync(`${ARTIFACT_DIR}/${name}`, 'utf8'))
  } catch {
    return null
  }
}
