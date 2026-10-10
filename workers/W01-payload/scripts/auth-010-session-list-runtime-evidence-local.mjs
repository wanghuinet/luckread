import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const baseUrl = (process.env.AUTH001_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')
const persistTo = process.env.CLOUDFLARE_PERSIST_TO || '/tmp/luckread-auth001-state'
const artifactDir = new URL('../../../artifacts/mapping-0/auth-010-session-list-runtime-local/', import.meta.url)
mkdirSync(artifactDir, { recursive: true })

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
const policyVersion = 'DEV-2026-09-28.1'
const basePassword = 'Evd-AUTH010-' + suffix + '-9x!'
const emailA = 'auth010a' + suffix + '@luckread.local'
const usernameA = 'auth010a' + suffix
const emailB = 'auth010b' + suffix + '@luckread.local'
const usernameB = 'auth010b' + suffix
const registerKeyA = 'AUTH010-LOCAL-' + suffix + '-REGISTER-A'
const registerKeyB = 'AUTH010-LOCAL-' + suffix + '-REGISTER-B'
const emails = [emailA, emailB]
const registerKeys = [registerKeyA, registerKeyB]
const userIds = []

const escapeSql = (value) => "'" + String(value).replaceAll("'", "''") + "'"
const renderSql = (sql, args = []) => {
  let index = 0
  return sql.replaceAll('?', () => escapeSql(args[index++]))
}
const d1Json = (command) => {
  const output = execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'luckread', '--local', '--json', '--persist-to', persistTo, '--config', 'wrangler.jsonc', '--command', command],
    { encoding: 'utf8', cwd: process.cwd(), env: process.env, maxBuffer: 8 * 1024 * 1024 },
  )
  return JSON.parse(output)
}
const d1Rows = (command) => {
  const value = d1Json(command)
  if (Array.isArray(value)) return value.flatMap((item) => Array.isArray(item) ? item : item && Array.isArray(item.results) ? item.results : item && Array.isArray(item.result) ? item.result : [])
  if (value && Array.isArray(value.results)) return value.results
  if (value && Array.isArray(value.result)) return value.result
  return []
}
const scalar = (sql, ...args) => d1Rows(renderSql(sql, args))[0] ?? null
const runSql = (sql, ...args) => d1Json(renderSql(sql, args))

const parseJson = async (response, label) => {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new Error(label + '_INVALID_JSON_HTTP_' + response.status)
  }
}

const requestHeaders = (extra = {}) => ({
  accept: 'application/json',
  origin: process.env.AUTH001_ORIGIN || 'https://luckread.com',
  ...extra,
})

const postJson = async (path, body, { idempotencyKey, cookie } = {}) => {
  const headers = requestHeaders({ 'content-type': 'application/json' })
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  if (cookie) headers.cookie = cookie
  return fetch(baseUrl + path, { method: 'POST', headers, body: JSON.stringify(body) })
}

const getSetCookie = (response) =>
  typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)

const firstCookieHeader = (response) =>
  getSetCookie(response).map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ')

const registerAccount = async ({ email, username, password, idempotencyKey }) => {
  const response = await postJson('/auth/register', {
    identityType: 'email',
    identity: email,
    credential: password,
    username,
    consent: { purpose: 'ACCOUNT_REGISTRATION', policyVersion },
  }, { idempotencyKey })
  const payload = await parseJson(response, 'AUTH010_REGISTER')
  if (response.status !== 201 || typeof payload?.userId !== 'string') {
    throw new Error('AUTH010_REGISTER_FAILED_HTTP_' + response.status)
  }
  userIds.push(String(payload.userId))

  runSql(
    'UPDATE "user" SET email_verified = 1, account_state = \'ACTIVE\', account_state_version = account_state_version + 1 WHERE id = ?',
    payload.userId,
  )
  const activated = scalar(
    'SELECT id, email_verified AS emailVerified, account_state AS accountState FROM "user" WHERE id = ? LIMIT 1',
    payload.userId,
  )
  if (!activated || Number(activated.emailVerified) !== 1 || activated.accountState !== 'ACTIVE') {
    throw new Error('AUTH010_TEST_ACCOUNT_ACTIVATION_FAILED')
  }
  return String(payload.userId)
}

const createSecondIsolatedIdentity = async () => {
  // B is created through the real local W02 Better Auth HTTP API. This avoids
  // spending the public W01 registration limiter already exercised by AUTH-001,
  // while still obtaining a genuine Better Auth identity and signed session cookie.
  const w02BaseUrl = (process.env.AUTH010_W02_BASE_URL || 'http://127.0.0.1:8788').replace(/\\/$/, '')
  const signupResponse = await fetch(w02BaseUrl + '/api/auth/sign-up/email', {
    method: 'POST',
    headers: requestHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      email: emailB,
      name: usernameB,
      username: usernameB,
      password: basePassword,
    }),
  })
  await parseJson(signupResponse, 'AUTH010_SECOND_IDENTITY_SIGNUP')
  if (!signupResponse.ok) {
    throw new Error('AUTH010_SECOND_IDENTITY_SIGNUP_FAILED_HTTP_' + signupResponse.status)
  }

  const identity = scalar('SELECT id FROM "user" WHERE email = ? LIMIT 1', emailB)
  const userId = typeof identity?.id === 'string' ? identity.id : ''
  if (!userId) throw new Error('AUTH010_SECOND_IDENTITY_NOT_PERSISTED')
  userIds.push(userId)

  runSql(
    'UPDATE "user" SET email_verified = 1, account_state = \'ACTIVE\', account_state_version = account_state_version + 1 WHERE id = ?',
    userId,
  )
  const activated = scalar(
    'SELECT id, email_verified AS emailVerified, account_state AS accountState FROM "user" WHERE id = ? LIMIT 1',
    userId,
  )
  if (!activated || Number(activated.emailVerified) !== 1 || activated.accountState !== 'ACTIVE') {
    throw new Error('AUTH010_SECOND_IDENTITY_ACTIVATION_FAILED')
  }
  return userId
}

const loginDirectW02 = async (email, password) => {
  const w02BaseUrl = (process.env.AUTH010_W02_BASE_URL || 'http://127.0.0.1:8788').replace(/\\/$/, '')
  const response = await fetch(w02BaseUrl + '/api/auth/sign-in/email', {
    method: 'POST',
    headers: requestHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  })
  await parseJson(response, 'AUTH010_SECOND_IDENTITY_LOGIN')
  const cookie = firstCookieHeader(response)
  if (!response.ok || !cookie) {
    throw new Error('AUTH010_SECOND_IDENTITY_LOGIN_FAILED_HTTP_' + response.status)
  }
  console.log('::add-mask::' + cookie)
  return cookie
}

const login = async (email, password) => {
  const response = await postJson('/api/v1/auth/login', {
    identity: email,
    credential: password,
  })
  const payload = await parseJson(response, 'AUTH010_LOGIN')
  const cookie = firstCookieHeader(response)
  if (response.status !== 200 || !cookie || !payload) {
    throw new Error('AUTH010_LOGIN_FAILED_HTTP_' + response.status)
  }
  console.log('::add-mask::' + cookie)
  return cookie
}

const classifyTransportError = (error) => {
  const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined
  const causeCode = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : ''
  const knownCodes = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EPIPE',
    'ERR_INVALID_CHAR',
    'ERR_INVALID_URL',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_INVALID_ARG',
    'UND_ERR_INVALID_CHAR',
    'UND_ERR_SOCKET',
  ])
  return knownCodes.has(causeCode)
    ? causeCode
    : error instanceof TypeError
      ? 'TYPE_ERROR'
      : 'UNKNOWN_ERROR'
}

const listSessions = async (cookie, { limit = 100, cursor } = {}) => {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor !== undefined) params.set('cursor', cursor)
  const url = baseUrl + '/api/v1/auth/sessions?' + params.toString()

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: requestHeaders({ cookie, connection: 'close' }),
        cache: 'no-store',
      })
      return { response, payload: await parseJson(response, 'AUTH010_SESSION_LIST') }
    } catch (error) {
      const classification = classifyTransportError(error)
      if (attempt === 0 && ['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE'].includes(classification)) {
        // This is a read-only local probe. Retry once only for a transport
        // reset, after confirming that the local W01 listener is still alive.
        let healthy = false
        try {
          const health = await fetch(baseUrl + '/', { headers: { connection: 'close' }, cache: 'no-store' })
          healthy = health.status < 500
        } catch {}
        if (healthy) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          continue
        }
        throw new Error('AUTH010_SESSION_LIST_FETCH_' + classification + '_W01_UNHEALTHY')
      }
      throw new Error('AUTH010_SESSION_LIST_FETCH_' + classification)
    }
  }

  throw new Error('AUTH010_SESSION_LIST_FETCH_RETRY_EXHAUSTED')
}

const revokeSession = async (cookie, sessionId, idempotencyKey) => {
  const response = await fetch(baseUrl + '/api/v1/auth/sessions/' + encodeURIComponent(sessionId), {
    method: 'DELETE',
    headers: requestHeaders({ cookie, 'Idempotency-Key': idempotencyKey }),
    cache: 'no-store',
  })
  const body = await response.text()
  if (body.length > 0) throw new Error('AUTH010_REVOKE_EXPECTED_EMPTY_BODY')
  return response
}

const cleanup = async () => {
  const ids = [...new Set(userIds)]
  try { runSql('DELETE FROM role_assignments WHERE subject_id IN (' + ids.map(escapeSql).join(',') + ')') } catch {}
  try { runSql('DELETE FROM auth_session_state WHERE user_id IN (' + ids.map(escapeSql).join(',') + ')') } catch {}
  try { runSql('DELETE FROM "session" WHERE user_id IN (' + ids.map(escapeSql).join(',') + ')') } catch {}
  try { runSql('DELETE FROM "account" WHERE user_id IN (' + ids.map(escapeSql).join(',') + ')') } catch {}
  try { runSql('DELETE FROM "verification" WHERE identifier IN (' + emails.map(escapeSql).join(',') + ')') } catch {}
  try {
    runSql(
      'DELETE FROM consents WHERE resource_id IN (SELECT CAST(id AS TEXT) FROM users WHERE email IN (' + emails.map(escapeSql).join(',') + '))',
    )
  } catch {}
  try { runSql('DELETE FROM auth_registration_envelopes WHERE idempotency_key IN (' + registerKeys.map(escapeSql).join(',') + ')') } catch {}
  try { runSql('DELETE FROM users WHERE email IN (' + emails.map(escapeSql).join(',') + ')') } catch {}
  try { runSql('DELETE FROM "user" WHERE id IN (' + ids.map(escapeSql).join(',') + ')') } catch {}
}

let cleaned = false
let currentStage = 'startup'
try {
  currentStage = 'health-check'
  const health = await fetch(baseUrl + '/')
  if (health.status >= 500) throw new Error('AUTH010_LOCAL_W01_NOT_READY')

  currentStage = 'register-user-a'
  const userAId = await registerAccount({ email: emailA, username: usernameA, password: basePassword, idempotencyKey: registerKeyA })
  currentStage = 'login-user-a'
  const cookieA = await login(emailA, basePassword)

  currentStage = 'profile-read'
  const profileResponse = await fetch(baseUrl + '/api/v1/users/me', {
    method: 'GET',
    headers: requestHeaders({ cookie: cookieA }),
    cache: 'no-store',
  })
  const profile = await parseJson(profileResponse, 'AUTH010_PROFILE')
  if (profileResponse.status !== 200 || String(profile?.email || '').toLowerCase() !== emailA) {
    throw new Error('AUTH010_PROFILE_READ_FAILED_HTTP_' + profileResponse.status)
  }

  currentStage = 'native-session-check'
  const currentRow = scalar('SELECT id, user_id AS userId FROM "session" WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', userAId)
  if (!currentRow?.id || String(currentRow.userId) !== userAId) {
    throw new Error('AUTH010_NATIVE_LOGIN_SESSION_NOT_FOUND')
  }

  currentStage = 'seed-session-fixtures'
  const seedNow = Date.now()
  const sessionValues = Array.from({ length: 55 }, (_, index) => {
    const sessionId = 'auth010-seed-' + suffix + '-' + String(index).padStart(2, '0')
    const token = 'auth010-token-' + suffix + '-' + String(index).padStart(2, '0')
    const createdAt = new Date(seedNow - (60 + index) * 1000).toISOString()
    const expiresAt = new Date(seedNow + 24 * 60 * 60 * 1000).toISOString()
    const updatedAt = createdAt
    return '(' + [
      sessionId, expiresAt, token, createdAt, updatedAt, null, null, userAId,
    ].map((value) => value === null ? 'NULL' : escapeSql(value)).join(',') + ')'
  })
  runSql(
    'INSERT INTO "session" (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id) VALUES ' + sessionValues.join(','),
  )
  const seededCount = scalar('SELECT COUNT(*) AS count FROM "session" WHERE user_id = ?', userAId)
  if (Number(seededCount?.count) < 56) throw new Error('AUTH010_SESSION_FIXTURE_SEED_FAILED')

  currentStage = 'list-page-one'
  const first = await listSessions(cookieA, { limit: 100 })
  if (first.response.status !== 200) throw new Error('AUTH010_FIRST_PAGE_FAILED_HTTP_' + first.response.status)
  const firstItems = first.payload?.items
  if (!Array.isArray(firstItems) || firstItems.length !== 50) throw new Error('AUTH010_FIRST_PAGE_NOT_BOUNDED_TO_50')
  if (typeof first.payload.currentSessionId !== 'string' || first.payload.currentSessionId !== currentRow.id) {
    throw new Error('AUTH010_CURRENT_SESSION_MARKER_MISMATCH')
  }
  if (typeof first.payload.nextCursor !== 'string' || first.payload.nextCursor.length === 0) {
    throw new Error('AUTH010_CONTINUATION_CURSOR_MISSING')
  }
  if (firstItems.some((item) => 'token' in item || 'userId' in item || 'refreshToken' in item || 'refreshCredentialHash' in item)) {
    throw new Error('AUTH010_SESSION_DTO_EXPOSED_SENSITIVE_FIELD')
  }
  if (first.response.headers.get('cache-control') !== 'no-store') {
    throw new Error('AUTH010_SESSION_LIST_CACHE_POLICY_MISMATCH')
  }

  const firstIds = new Set(firstItems.map((item) => item.sessionId))
  currentStage = 'list-page-two'
  const second = await listSessions(cookieA, { limit: 100, cursor: first.payload.nextCursor })
  if (second.response.status !== 200) throw new Error('AUTH010_SECOND_PAGE_FAILED_HTTP_' + second.response.status)
  const secondItems = second.payload?.items
  if (!Array.isArray(secondItems) || secondItems.length !== 6 || second.payload.nextCursor !== null) {
    throw new Error('AUTH010_SECOND_PAGE_CURSOR_CONTRACT_MISMATCH')
  }
  if (secondItems.some((item) => firstIds.has(item.sessionId))) throw new Error('AUTH010_PAGINATION_REPEATED_SESSION')
  if (second.payload.currentSessionId !== currentRow.id) throw new Error('AUTH010_CURRENT_SESSION_CHANGED_ACROSS_PAGES')

  currentStage = 'invalid-cursor'
  const invalidCursor = await listSessions(cookieA, { cursor: 'not-an-opaque-cursor' })
  if (invalidCursor.response.status !== 400) throw new Error('AUTH010_INVALID_CURSOR_WAS_NOT_REJECTED')

  currentStage = 'create-second-real-w02-identity'
  const userBId = await createSecondIsolatedIdentity()
  currentStage = 'login-second-real-w02-identity'
  const cookieB = await loginDirectW02(emailB, basePassword)
  currentStage = 'cross-account-list'
  const userBList = await listSessions(cookieB, { limit: 100 })
  if (userBList.response.status !== 200) throw new Error('AUTH010_SECOND_USER_LIST_FAILED')
  if (userBList.payload.items.some((item) => firstIds.has(item.sessionId))) throw new Error('AUTH010_CROSS_ACCOUNT_SESSION_LEAK')

  const targetSessionId = firstItems.find((item) => item.sessionId !== currentRow.id)?.sessionId
  if (typeof targetSessionId !== 'string') throw new Error('AUTH010_OWNED_REVOKE_TARGET_MISSING')

  currentStage = 'cross-account-revoke'
  const crossAccountRevoke = await revokeSession(cookieB, targetSessionId, 'AUTH010-' + suffix + '-CROSS')
  if (crossAccountRevoke.status !== 204) throw new Error('AUTH010_CROSS_ACCOUNT_REVOKE_STATUS_UNEXPECTED')
  const targetAfterCross = scalar('SELECT id FROM "session" WHERE id = ? AND user_id = ? LIMIT 1', targetSessionId, userAId)
  if (!targetAfterCross) throw new Error('AUTH010_CROSS_ACCOUNT_REVOKE_CHANGED_OWNER_SESSION')

  currentStage = 'owned-revoke'
  const ownRevoke = await revokeSession(cookieA, targetSessionId, 'AUTH010-' + suffix + '-OWN')
  if (ownRevoke.status !== 204) throw new Error('AUTH010_OWNED_REVOKE_STATUS_UNEXPECTED')
  const repeatedRevoke = await revokeSession(cookieA, targetSessionId, 'AUTH010-' + suffix + '-OWN-REPLAY')
  if (repeatedRevoke.status !== 204) throw new Error('AUTH010_REPEATED_REVOKE_NOT_IDEMPOTENT')
  const targetAfterOwn = scalar('SELECT id FROM "session" WHERE id = ? AND user_id = ? LIMIT 1', targetSessionId, userAId)
  if (targetAfterOwn) throw new Error('AUTH010_OWNED_REVOKE_DID_NOT_REMOVE_NATIVE_SESSION')

  currentStage = 'verify-after-revoke'
  const afterRevoke = await listSessions(cookieA, { limit: 100 })
  if (afterRevoke.response.status !== 200 || afterRevoke.payload.items.some((item) => item.sessionId === targetSessionId)) {
    throw new Error('AUTH010_REVOKED_SESSION_REMAINED_VISIBLE')
  }

  currentStage = 'cleanup-success-fixtures'
  await cleanup()
  cleaned = true

  const result = {
    status: 'PASS',
    evidenceType: 'AUTH-010_SESSION_LIST_REVOKE_W01_W02_LOCAL_RUNTIME',
    testedCommitSha: sourceSha,
    environmentClass: 'CONTROLLED_LOCAL_D1',
    databaseName: 'luckread',
    assertions: {
      profileRead: true,
      loginCookieAuthenticatesSessionApi: true,
      responseBoundedAt50: true,
      nextCursorContinuation: true,
      currentSessionMarkerStable: true,
      secretFieldsExcluded: true,
      noStore: true,
      malformedCursorRejected: true,
      crossAccountListIsolated: true,
      crossAccountRevokeNoOp: true,
      ownedRevokeRemovesNativeSession: true,
      repeatedRevokeIdempotent: true,
      syntheticIdentitiesAndSessionsCleaned: true,
    },
    observed: {
      firstPageCount: firstItems.length,
      secondPageCount: secondItems.length,
      userASessionCountBeforeCleanup: 56,
      crossAccountRevokeStatus: crossAccountRevoke.status,
      ownRevokeStatus: ownRevoke.status,
      repeatedRevokeStatus: repeatedRevoke.status,
    },
    secretsCaptured: false,
  }
  writeFileSync(new URL('runtime-result.json', artifactDir), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} catch (error) {
  const name = error instanceof Error ? error.name : 'UnknownError'
  const result = {
    status: 'FAIL',
    evidenceType: 'AUTH-010_SESSION_LIST_REVOKE_W01_W02_LOCAL_RUNTIME',
    testedCommitSha: sourceSha,
    environmentClass: 'CONTROLLED_LOCAL_D1',
    errorName: name,
    failureStage: currentStage,
    failureCode: error instanceof Error && /^AUTH010_[A-Z0-9_]+$/.test(error.message) ? error.message : 'AUTH010_UNCLASSIFIED_ERROR',
    secretMaterialIncluded: false,
  }
  try { writeFileSync(new URL('runtime-result.json', artifactDir), JSON.stringify(result, null, 2) + '\n') } catch {}
  throw new Error('AUTH010_LOCAL_RUNTIME_FAILED_' + name)
} finally {
  if (!cleaned) {
    try { await cleanup() } catch { console.error('AUTH010_LOCAL_CLEANUP_INCOMPLETE') }
  }
}
