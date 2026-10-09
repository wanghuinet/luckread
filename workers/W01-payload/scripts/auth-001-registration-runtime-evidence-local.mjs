import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const baseUrl = process.env.AUTH001_BASE_URL || 'http://127.0.0.1:8787'
const browserOrigin = process.env.AUTH001_BROWSER_ORIGIN || 'https://mp.luckread.com'
const artifactDir = new URL('../../../artifacts/mapping-0/auth-001-runtime-local/', import.meta.url)
mkdirSync(artifactDir, { recursive: true })
const runId = process.env.GITHUB_RUN_ID || 'local'
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const policy = JSON.parse(readFileSync(new URL('../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json', import.meta.url), 'utf8'))
if (policy.policyVersion !== 'DEV-2026-09-28.1') throw new Error('Unexpected development PRIV-004 policy version')

const escapeSql = (value) => "'" + String(value).replaceAll("'", "''") + "'"
const renderSql = (sql, args) => { let index = 0; return sql.replaceAll('?', () => escapeSql(args[index++])) }
const d1Json = (command) => {
  const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'luckread', '--local', '--json', '--config', 'wrangler.jsonc', '--command', command], { encoding: 'utf8', cwd: process.cwd(), env: process.env, maxBuffer: 8 * 1024 * 1024 })
  return JSON.parse(output)
}
const d1Rows = (command) => {
  const value = d1Json(command)
  if (Array.isArray(value)) return value.flatMap((item) => Array.isArray(item) ? item : item && Array.isArray(item.results) ? item.results : item && Array.isArray(item.result) ? item.result : [])
  if (value && Array.isArray(value.results)) return value.results
  if (value && Array.isArray(value.result)) return value.result
  return []
}
const scalar = async (sql, ...args) => d1Rows(renderSql(sql, args))[0] ?? null
const all = (sql, ...args) => d1Rows(renderSql(sql, args))
const runSql = (sql, ...args) => { d1Json(renderSql(sql, args)) }

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonicalize(nested)]))
  return value
}
const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const responseJson = async (response) => {
  const text = await response.text()
  try { return JSON.parse(text) } catch { throw new Error('Expected JSON response, HTTP ' + response.status + ': ' + text.slice(0, 500)) }
}
const request = (path, idempotencyKey, body, cookie) => fetch(baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: browserOrigin, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
const getSetCookie = (response) => typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean)
const firstCookieHeader = (response) => getSetCookie(response).map((value) => value.split(';', 1)[0]).join('; ')

const profileForEmail = async (email, username) => scalar('SELECT COUNT(*) AS c, MIN(id) AS id, MIN(identity_id) AS identity_id, MIN(hash) AS hash, MIN(salt) AS salt, MIN(account_state) AS account_state, MIN(account_state_version) AS account_state_version FROM users WHERE email = ? AND username = ?', email, username)
const envelopeForKey = async (key) => scalar('SELECT id, state, payload_hash, response_digest, committed_response, consent_record_id FROM auth_registration_envelopes WHERE idempotency_key = ? AND scope = ? AND endpoint = ? ORDER BY created_at DESC LIMIT 1', key, 'ACCOUNT_REGISTRATION', 'authRegister')

const schema = { results: all('PRAGMA table_info(users)') }
if (!schema.results.some((column) => column.name === 'identity_id')) throw new Error('Better Auth profile projection column identity_id is missing')
for (const required of ['users', 'auth_registration_envelopes', 'consents']) { if (!all('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = ?', required).length) throw new Error('Required local D1 table missing: ' + required) }

const suffix = process.env.AUTH001_SUFFIX?.trim() || randomUUID().replaceAll('-', '').slice(0, 16)
if (!/^[a-zA-Z0-9_-]{1,32}$/.test(suffix)) throw new Error('Invalid AUTH001_SUFFIX')
const email = 'auth001-runtime-' + suffix + '@luckread.local'
const username = 'auth001rt' + suffix
const password = 'Evd-AUTH001-Batch-' + suffix + '-9x!'
const body = { identityType: 'email', identity: email, credential: password, username, consent: { purpose: 'ACCOUNT_REGISTRATION', policyVersion: policy.policyVersion } }
const keySuccess = 'auth001-local-success-' + suffix
const keyRollback = 'auth001-local-rollback-' + suffix
const keyConcurrentA = 'auth001-local-concurrent-a-' + suffix
const keyConcurrentB = 'auth001-local-concurrent-b-' + suffix
const keySameKey = 'auth001-local-same-key-' + suffix
const concurrentEmail = 'auth001-concurrent-' + suffix + '@luckread.local'
const concurrentUsername = 'auth001ct' + suffix
const rollbackEmail = 'auth001-rollback-' + suffix + '@luckread.local'
const rollbackUsername = 'auth001rb' + suffix
const sameKeyEmail = 'auth001-same-key-' + suffix + '@luckread.local'
const sameKeyUsername = 'auth001sk' + suffix
let triggerName = 'auth001_evidence_fail_' + suffix

const cleanup = async () => {
  if (triggerName) { runSql('DROP TRIGGER IF EXISTS ' + triggerName); triggerName = null }
  runSql('DELETE FROM consents WHERE resource_id IN (SELECT CAST(id AS TEXT) FROM users WHERE email IN (?, ?, ?, ?))', email, concurrentEmail, rollbackEmail, sameKeyEmail)
  runSql('DELETE FROM auth_registration_envelopes WHERE idempotency_key IN (?, ?, ?, ?, ?)', keySuccess, keyRollback, keyConcurrentA, keyConcurrentB, keySameKey)
  runSql('DELETE FROM users WHERE email IN (?, ?, ?, ?)', email, concurrentEmail, rollbackEmail, sameKeyEmail)
}

try {
  const health = await fetch(baseUrl + '/')
  if (health.status >= 500) throw new Error('Local W01 did not start cleanly: HTTP ' + health.status)

  const firstResponse = await request('/auth/register', keySuccess, body)
  const first = await responseJson(firstResponse)
  if (firstResponse.status !== 201) throw new Error('Registration failed: HTTP ' + firstResponse.status)
  if (!first.userId || first.accountState !== 'PENDING_VERIFICATION') throw new Error('Registration response is not the canonical Better Auth registration response')

  // A new account must remain unable to sign in until email verification.
  // This is expected security behavior, not a registration failure.
  const loginResponse = await request('/auth/login', null, { identity: email, credential: password })
  const login = await responseJson(loginResponse)
  const loginErrorCode = String(login?.error?.code || login?.code || '').toUpperCase()
  if (loginResponse.status !== 403 || loginErrorCode !== 'EMAIL_NOT_VERIFIED') {
    throw new Error('Unverified registration must be denied with EMAIL_NOT_VERIFIED; HTTP ' + loginResponse.status + ', code ' + (loginErrorCode || 'MISSING'))
  }
  if (getSetCookie(loginResponse).some((value) => /(?:^|;\\s*)(?:__Secure-)?better-auth\.session_token=/.test(value))) {
    throw new Error('Better Auth issued a session before email verification')
  }

  const replay = await responseJson(await request('/auth/register', keySuccess, body))
  if (JSON.stringify(replay) !== JSON.stringify(first)) throw new Error('Idempotent replay did not return the original Better Auth registration response')
  const reuse = await responseJson(await request('/auth/register', keySuccess, { ...body, credential: password + '-changed' }))
  if (reuse?.error?.code !== 'IDEMPOTENCY_KEY_REUSE_CONFLICT') throw new Error('Idempotency key reuse conflict was not canonical')

  // The workflow creates this conditional trigger before either Worker starts.
  const rollbackResponse = await request('/auth/register', keyRollback, { ...body, identity: rollbackEmail, username: rollbackUsername })
  if (rollbackResponse.status !== 503) throw new Error('Forced downstream rollback should fail closed with 503, got ' + rollbackResponse.status)
  const rollbackLogin = await request('/auth/login', null, { identity: rollbackEmail, credential: password })
  if (rollbackLogin.status !== 422 && rollbackLogin.status !== 401) throw new Error('W02 rollback did not remove the Better Auth identity')

  const concurrentBody = { ...body, identity: concurrentEmail, username: concurrentUsername, credential: password + '-concurrent' }
  const pair = await Promise.all([request('/auth/register', keyConcurrentA, concurrentBody), request('/auth/register', keyConcurrentB, concurrentBody)])
  const statuses = pair.map((response) => response.status).sort((a, b) => a - b)
  if (statuses[0] !== 201 || statuses[1] !== 422) throw new Error('Concurrent duplicate identity did not produce exactly one success and one Better Auth conflict: ' + statuses.join(','))
  const sameKeyBody = { ...body, identity: sameKeyEmail, username: sameKeyUsername, credential: password + '-same-key' }
  const sameKeyPair = await Promise.all([request('/auth/register', keySameKey, sameKeyBody), request('/auth/register', keySameKey, sameKeyBody)])
  const sameKeyPayloads = await Promise.all(sameKeyPair.map(responseJson))
  const sameKeyStatuses = sameKeyPair.map((response) => response.status).sort((a, b) => a - b)
  const sameKeyValid = sameKeyStatuses[0] === 201 && sameKeyStatuses[1] === 422
  const sameKeyReplay = sameKeyStatuses[0] === 201 && sameKeyStatuses[1] === 201 && JSON.stringify(sameKeyPayloads[0]) === JSON.stringify(sameKeyPayloads[1])
  if (!sameKeyValid && !sameKeyReplay) throw new Error('Concurrent same Idempotency-Key did not resolve to a single Better Auth identity: ' + sameKeyStatuses.join(','))
  // Run direct local D1 inspection only after all browser-style requests have
  // finished. Calling Wrangler's local D1 CLI during the HTTP sequence can
  // interfere with the short-lived local Worker runtime.
  const projection = await profileForEmail(email, username)
  if (Number(projection?.c || 0) !== 1 || String(projection.identity_id) !== String(first.userId)) throw new Error('W01 profile projection is not bound to the Better Auth user')
  if (projection.hash || projection.salt) throw new Error('Legacy Payload password hash/salt was persisted into the profile projection')
  if (Number(projection.account_state_version || 0) !== 1) throw new Error('W01 profile lifecycle projection version is not canonical')
  if (all('SELECT name FROM sqlite_master WHERE type = \'table\' AND name = ?', 'users_sessions').length) {
    const legacySession = await scalar('SELECT COUNT(*) AS c FROM users_sessions WHERE _parent_id = ?', projection.id)
    if (Number(legacySession?.c || 0) !== 0) throw new Error('Legacy Payload session row was created for Better Auth registration')
  }

  const envelope = await envelopeForKey(keySuccess)
  if (!envelope || envelope.state !== 'COMPLETED') throw new Error('Completed registration envelope missing')
  const committedResponse = JSON.parse(String(envelope.committed_response))
  if (committedResponse.userId !== first.userId || committedResponse.accountState !== first.accountState) throw new Error('committed_response is not the returned canonical response')
  const expectedResponseDigest = await sha256Hex(JSON.stringify(canonicalize({ schema: 'AUTH-001.response-digest.v1', operationId: 'authRegister', endpoint: '/auth/register', idempotencyKey: keySuccess, payloadHash: envelope.payload_hash, status: 201, accountState: 'PENDING_VERIFICATION' })))
  if (envelope.response_digest !== expectedResponseDigest) throw new Error('response_digest does not match the committed Better Auth registration response')

  const rollbackProjection = await profileForEmail(rollbackEmail, rollbackUsername)
  if (Number(rollbackProjection?.c || 0) !== 0) throw new Error('W01 rollback left a partial profile projection')

  const concurrentProjection = await profileForEmail(concurrentEmail, concurrentUsername)
  if (Number(concurrentProjection?.c || 0) !== 1) throw new Error('Concurrent duplicate identity produced more than one W01 profile projection')

  const sameKeyProjection = await profileForEmail(sameKeyEmail, sameKeyUsername)
  if (Number(sameKeyProjection?.c || 0) !== 1) throw new Error('Concurrent same Idempotency-Key produced more than one W01 profile projection')

  const result = {
    status: 'PASS',
    evidenceType: 'AUTH-001_BETTER_AUTH_REGISTRATION_W01_BOUNDARY_LOCAL_RUNTIME',
    runId, sourceSha, environment: 'CONTROLLED_LOCAL_D1_SHARED_W02_W01_OPENNEXT_WORKERS',
    assertions: { successfulRegistration: true, betterAuthIdentityCreated: true, unverifiedLoginDenied: true, noSessionIssuedBeforeVerification: true, w01ProfileProjectionBoundByIdentityId: true, payloadNativePasswordNotPersisted: true, payloadNativeSessionNotCreated: true, responseDigestMatchesCommitment: true, idempotentReplay: true, idempotencyReuseConflict: true, downstreamRollbackRemovesBetterAuthIdentity: true, concurrentDuplicateIdentitySingleWinner: true, concurrentSameKeySingleWinner: true },
    observed: { userId: String(first.userId), accountState: first.accountState, loginDeniedCode: loginErrorCode, concurrentStatuses: statuses, sameKeyStatuses },
  }
  writeFileSync(new URL('./runtime-result.json', artifactDir), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await cleanup()
}