import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const baseUrl = (process.env.AUTH010_REMOTE_BASE_URL || '').replace(/\/$/, '')
const expectedSourceSha = process.env.AUTH010_EXPECTED_SOURCE_SHA || ''
const runConfirmation = process.env.AUTH010_REMOTE_E2E_CONFIRM || ''
const evidenceDir = resolve('artifacts/mapping-0/auth-010-session-runtime-remote')
const evidencePath = resolve(evidenceDir, 'result.json')
const runId = randomUUID()
const startedAt = new Date().toISOString()
const checks = {}
const cleanupResults = []
const cookies = { a1: null, a2: null, b1: null }
const sessionIds = { a1: null, a2: null, b1: null }
let failureCode = null
let sourceSha = null
let probeSha256 = null

function assertCheck(name, condition, code) {
  checks[name] = condition === true
  if (!condition) throw new Error(code)
}

function safeCode(error) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
  return /^[A-Z0-9_:-]{1,120}$/.test(message) ? message : 'UNEXPECTED_RUNTIME_ERROR'
}

function requestHeaders(extra = {}) {
  return {
    accept: 'application/json',
    origin: 'https://luckread.com',
    ...extra,
  }
}

function cookieHeader(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean)
  return setCookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ')
}

async function parseJson(response, stage) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    throw new Error(stage + '_INVALID_JSON_HTTP_' + response.status)
  }
}

async function login(email, password, label) {
  const response = await fetch(baseUrl + '/api/v1/auth/login', {
    method: 'POST',
    headers: requestHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ identity: email, credential: password }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  await response.arrayBuffer()
  const cookie = cookieHeader(response)
  if (response.status !== 200 || !cookie) {
    throw new Error(label + '_LOGIN_FAILED_HTTP_' + response.status)
  }
  return cookie
}

async function listSessions(cookie, label, cursor) {
  const params = new URLSearchParams({ limit: '100' })
  if (cursor !== undefined) params.set('cursor', cursor)
  const response = await fetch(baseUrl + '/api/v1/auth/sessions?' + params.toString(), {
    method: 'GET',
    headers: requestHeaders(cookie ? { cookie } : {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  const payload = await parseJson(response, label)
  return { response, payload }
}

async function revokeSession(cookie, sessionId, idempotencyKey, label) {
  const response = await fetch(baseUrl + '/api/v1/auth/sessions/' + encodeURIComponent(sessionId), {
    method: 'DELETE',
    headers: requestHeaders({ cookie, 'Idempotency-Key': idempotencyKey }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  const body = await response.text()
  if (body.length !== 0) throw new Error(label + '_EXPECTED_EMPTY_BODY')
  return response
}

function assertSessionList(result, label, expectedCurrentId) {
  assertCheck(label + 'Http200', result.response.status === 200, label + '_HTTP_' + result.response.status)
  assertCheck(label + 'BoundedAt50', Array.isArray(result.payload?.items) && result.payload.items.length <= 50, label + '_NOT_BOUNDED')
  assertCheck(label + 'CurrentSessionStable', typeof result.payload?.currentSessionId === 'string' &&
    result.payload.currentSessionId === expectedCurrentId, label + '_CURRENT_SESSION_MISMATCH')
  assertCheck(label + 'NoStore', result.response.headers.get('cache-control')?.toLowerCase().includes('no-store') === true, label + '_CACHE_POLICY_MISMATCH')
  assertCheck(label + 'PrivateDto', result.payload.items.every((item) =>
    item && typeof item.sessionId === 'string' && typeof item.createdAt === 'string' &&
    typeof item.expiresAt === 'string' &&
    !('token' in item) && !('userId' in item) && !('refreshToken' in item) &&
    !('refreshCredentialHash' in item) && !('sessionToken' in item)
  ), label + '_PRIVATE_DTO_MISMATCH')
}

async function discoverCurrentSession(cookie, label) {
  if (!cookie) return null
  try {
    const result = await listSessions(cookie, label)
    if (result.response.status === 200 && typeof result.payload?.currentSessionId === 'string') {
      return result.payload.currentSessionId
    }
  } catch {}
  return null
}

async function cleanupOne(label, cookie, sessionId, fallbackCookie = null) {
  if (!cookie && !fallbackCookie) return
  let id = sessionId
  let authCookie = cookie
  if (!id && fallbackCookie) {
    id = await discoverCurrentSession(fallbackCookie, 'AUTH010_CLEANUP_DISCOVER_' + label)
  }
  if (!id && authCookie) {
    id = await discoverCurrentSession(authCookie, 'AUTH010_CLEANUP_DISCOVER_' + label)
  }
  if (!authCookie) authCookie = fallbackCookie
  if (!id || !authCookie) {
    cleanupResults.push({ label, status: 'NOT_DISCOVERED' })
    return
  }
  try {
    const response = await revokeSession(authCookie, id, 'AUTH010-REMOTE-CLEANUP-' + runId + '-' + label, 'AUTH010_CLEANUP_' + label)
    cleanupResults.push({ label, status: response.status })
  } catch {
    cleanupResults.push({ label, status: 'ERROR' })
  }
}

async function runAssertions() {
  assertCheck('ExplicitRunConfirmation', runConfirmation === 'RUN_AUTH010_REMOTE_E2E', 'CONFIRMATION_REQUIRED')
  assertCheck('FixedProductionTarget', baseUrl === 'https://luckread.com', 'TARGET_NOT_ALLOWLISTED')
  assertCheck('ExpectedSourceShaFormat', /^[0-9a-f]{40}$/.test(expectedSourceSha), 'EXPECTED_SHA_INVALID')
  sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  assertCheck('CheckedOutExactSourceSha', sourceSha === expectedSourceSha, 'CHECKED_OUT_SHA_MISMATCH')

  const emailA = process.env.AUTH010_REMOTE_TEST_USER_A_EMAIL || ''
  const passwordA = process.env.AUTH010_REMOTE_TEST_USER_A_PASSWORD || ''
  const emailB = process.env.AUTH010_REMOTE_TEST_USER_B_EMAIL || ''
  const passwordB = process.env.AUTH010_REMOTE_TEST_USER_B_PASSWORD || ''
  assertCheck('DedicatedCredentialsPresent', Boolean(emailA && passwordA && emailB && passwordB), 'TEST_ACCOUNT_SECRETS_MISSING')
  assertCheck('DistinctTestAccounts', emailA.toLowerCase() !== emailB.toLowerCase(), 'TEST_ACCOUNTS_MUST_BE_DISTINCT')

  const probeSource = readFileSync(new URL(import.meta.url))
  probeSha256 = createHash('sha256').update(probeSource).digest('hex')

  const unauthenticated = await listSessions(null, 'AUTH010_UNAUTHENTICATED_LIST')
  assertCheck('UnauthenticatedDenied401', unauthenticated.response.status === 401, 'UNAUTHENTICATED_LIST_HTTP_' + unauthenticated.response.status)

  cookies.a1 = await login(emailA, passwordA, 'AUTH010_ACCOUNT_A_SESSION_1')
  cookies.a2 = await login(emailA, passwordA, 'AUTH010_ACCOUNT_A_SESSION_2')
  cookies.b1 = await login(emailB, passwordB, 'AUTH010_ACCOUNT_B_SESSION_1')

  const a1 = await listSessions(cookies.a1, 'AUTH010_A1_LIST')
  const a2 = await listSessions(cookies.a2, 'AUTH010_A2_LIST')
  const b1 = await listSessions(cookies.b1, 'AUTH010_B1_LIST')
  assertCheck('A1ListStatus200', a1.response.status === 200, 'A1_LIST_HTTP_' + a1.response.status)
  assertCheck('A2ListStatus200', a2.response.status === 200, 'A2_LIST_HTTP_' + a2.response.status)
  assertCheck('B1ListStatus200', b1.response.status === 200, 'B1_LIST_HTTP_' + b1.response.status)

  sessionIds.a1 = a1.payload?.currentSessionId ?? null
  sessionIds.a2 = a2.payload?.currentSessionId ?? null
  sessionIds.b1 = b1.payload?.currentSessionId ?? null
  assertSessionList(a1, 'A1', sessionIds.a1)
  assertSessionList(a2, 'A2', sessionIds.a2)
  assertSessionList(b1, 'B1', sessionIds.b1)
  assertCheck('SeparateLoginSessions', Boolean(sessionIds.a1 && sessionIds.a2 && sessionIds.a1 !== sessionIds.a2), 'A_LOGIN_SESSIONS_NOT_DISTINCT')
  assertCheck('AccountSessionIsolation', Boolean(sessionIds.b1 && sessionIds.b1 !== sessionIds.a1 && sessionIds.b1 !== sessionIds.a2) &&
    !a1.payload.items.some((item) => item.sessionId === sessionIds.b1) &&
    !b1.payload.items.some((item) => item.sessionId === sessionIds.a1 || item.sessionId === sessionIds.a2),
    'CROSS_ACCOUNT_SESSION_LEAK')

  const invalidCursor = await listSessions(cookies.a1, 'AUTH010_INVALID_CURSOR', 'not-an-opaque-cursor')
  assertCheck('MalformedCursorRejected400', invalidCursor.response.status === 400, 'INVALID_CURSOR_HTTP_' + invalidCursor.response.status)

  const beforeCrossRevoke = await listSessions(cookies.a1, 'AUTH010_BEFORE_CROSS_REVOKE')
  assertCheck('TargetVisibleToOwnerBeforeRevoke',
    beforeCrossRevoke.response.status === 200 &&
    beforeCrossRevoke.payload.items.some((item) => item.sessionId === sessionIds.a2),
    'OWNED_TARGET_NOT_VISIBLE')

  const crossAccountRevoke = await revokeSession(
    cookies.b1,
    sessionIds.a2,
    'AUTH010-REMOTE-CROSS-' + runId,
    'AUTH010_CROSS_ACCOUNT_REVOKE',
  )
  assertCheck('CrossAccountRevokeIsNoOp204', crossAccountRevoke.status === 204, 'CROSS_ACCOUNT_REVOKE_HTTP_' + crossAccountRevoke.status)
  const afterCrossRevoke = await listSessions(cookies.a1, 'AUTH010_AFTER_CROSS_REVOKE')
  assertCheck('CrossAccountRevokeDidNotChangeOwnerSession',
    afterCrossRevoke.response.status === 200 &&
    afterCrossRevoke.payload.items.some((item) => item.sessionId === sessionIds.a2),
    'CROSS_ACCOUNT_REVOKE_CHANGED_OWNER_SESSION')

  const ownKey = 'AUTH010-REMOTE-OWN-' + runId
  const ownerRevoke = await revokeSession(cookies.a1, sessionIds.a2, ownKey, 'AUTH010_OWNED_REVOKE')
  assertCheck('OwnedRevokeReturns204', ownerRevoke.status === 204, 'OWNED_REVOKE_HTTP_' + ownerRevoke.status)
  const repeatRevoke = await revokeSession(cookies.a1, sessionIds.a2, ownKey, 'AUTH010_REPEAT_REVOKE')
  assertCheck('RepeatRevokeIdempotent204', repeatRevoke.status === 204, 'REPEAT_REVOKE_HTTP_' + repeatRevoke.status)
  const afterOwnRevoke = await listSessions(cookies.a1, 'AUTH010_AFTER_OWN_REVOKE')
  assertCheck('RevokedSessionNoLongerVisible',
    afterOwnRevoke.response.status === 200 &&
    !afterOwnRevoke.payload.items.some((item) => item.sessionId === sessionIds.a2),
    'REVOKED_SESSION_STILL_VISIBLE')
  assertCheck('OwnerSessionRemainsCurrent',
    afterOwnRevoke.payload.currentSessionId === sessionIds.a1,
    'OWNER_SESSION_CHANGED_AFTER_REVOKE')
}

async function main() {
  try {
    await runAssertions()
  } catch (error) {
    failureCode = safeCode(error)
  } finally {
    // Cleanup is limited to session IDs created by this run. No user creation,
    // direct D1 writes, production business data, or unrelated sessions are touched.
    await cleanupOne('A2', cookies.a1, sessionIds.a2, cookies.a2)
    await cleanupOne('A1', cookies.a1, sessionIds.a1)
    await cleanupOne('B1', cookies.b1, sessionIds.b1)
  }

  const cleanupOk = cleanupResults.every((item) => item.status === 204)
  checks.SessionCleanup = cleanupResults.length > 0 && cleanupOk
  if (!cleanupOk && !failureCode) failureCode = 'SESSION_CLEANUP_FAILED'

  mkdirSync(evidenceDir, { recursive: true })
  const evidence = {
    evidenceType: 'AUTH-010_SESSION_LIST_REVOKE_W01_W02_REMOTE_RUNTIME',
    result: failureCode ? 'FAIL' : 'PASS',
    failureCode,
    sourceSha,
    expectedSourceSha,
    deploymentRunId: process.env.AUTH010_DEPLOYMENT_RUN_ID || null,
    deploymentArtifactId: process.env.AUTH010_DEPLOYMENT_ARTIFACT_ID || null,
    baseUrl,
    environmentClass: 'REMOTE_DEPLOYED_HTTP',
    startedAt,
    finishedAt: new Date().toISOString(),
    probeSha256,
    assertions: checks,
    cleanup: cleanupResults,
    secretMaterialRecorded: false,
    directD1Writes: false,
    syntheticAccountsCreated: false,
    runId,
  }
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + String.fromCharCode(10))
  console.log(JSON.stringify({
    result: evidence.result,
    failureCode: evidence.failureCode,
    sourceSha: evidence.sourceSha,
    deploymentRunId: evidence.deploymentRunId,
    deploymentArtifactId: evidence.deploymentArtifactId,
    evidencePath,
    assertions: evidence.assertions,
    cleanup: evidence.cleanup,
    secretMaterialRecorded: false,
  }, null, 2))
  if (evidence.result !== 'PASS') process.exitCode = 1
}

await main()
