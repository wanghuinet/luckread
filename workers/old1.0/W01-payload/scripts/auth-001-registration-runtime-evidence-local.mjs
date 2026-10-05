import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const baseUrl = process.env.AUTH001_BASE_URL || 'http://127.0.0.1:3100'
const runId = process.env.GITHUB_RUN_ID || 'local'
const artifactDir = new URL('../../../artifacts/mapping-0/auth-001-runtime-local/', import.meta.url)
mkdirSync(artifactDir, { recursive: true })
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const policy = JSON.parse(readFileSync(new URL('../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json', import.meta.url), 'utf8'))
if (policy.policyVersion !== 'DEV-2026-09-28.1') throw new Error('Unexpected development PRIV-004 policy version')
const escapeSql = (value) => "'" + String(value).replaceAll("'", "''") + "'"
const renderSql = (sql, args) => {
  let index = 0
  return sql.replaceAll('?', () => escapeSql(args[index++]))
}
const d1Json = (command) => {
  const output = execFileSync(
    'npx',
    ['--yes', 'wrangler@4.116.0', 'd1', 'execute', 'luckread', '--local', '--json', '--config', 'wrangler.jsonc', '--command', command],
    { encoding: 'utf8', cwd: process.cwd(), env: process.env, maxBuffer: 8 * 1024 * 1024 },
  )
  return JSON.parse(output)
}
const d1Rows = (command) => {
  const value = d1Json(command)
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
const request = async (idempotencyKey, body) => fetch(baseUrl + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey, connection: 'close' }, body: JSON.stringify(body) })

const countsForEmail = async (email, username) => {
  const user = await scalar('SELECT COUNT(*) AS c, MIN(id) AS id, MIN(email_verified) AS email_verified, MIN(account_state) AS account_state, MIN(account_state_version) AS account_state_version FROM "user" WHERE email = ? AND username = ?', email, username)
  const account = await scalar('SELECT COUNT(*) AS c, MIN(id) AS id, MIN(password) AS password, MIN(provider_id) AS provider_id FROM "account" WHERE user_id = CAST((SELECT MIN(id) FROM "user" WHERE email = ? AND username = ?) AS TEXT)', email, username)
  const session = await scalar('SELECT COUNT(*) AS c FROM "session" WHERE user_id = CAST((SELECT MIN(id) FROM "user" WHERE email = ? AND username = ?) AS TEXT)', email, username)
  const consent = await scalar('SELECT COUNT(*) AS c, MIN(id) AS id FROM consents WHERE resource_id = CAST((SELECT MIN(id) FROM "user" WHERE email = ? AND username = ?) AS TEXT)', email, username)
  const legacy = await scalar('SELECT COUNT(*) AS c FROM users WHERE email = ? AND username = ?', email, username)
  return {
    users: Number(user && user.c || 0),
    userId: user && user.id != null ? String(user.id) : null,
    emailVerified: user && user.email_verified != null ? Number(user.email_verified) : null,
    accountState: user && user.account_state || null,
    accountStateVersion: user && user.account_state_version != null ? Number(user.account_state_version) : null,
    accounts: Number(account && account.c || 0),
    accountId: account && account.id != null ? String(account.id) : null,
    accountPassword: account && typeof account.password === 'string' ? account.password : null,
    accountProviderId: account && typeof account.provider_id === 'string' ? account.provider_id : null,
    sessions: Number(session && session.c || 0),
    consents: Number(consent && consent.c || 0),
    consentId: consent && consent.id || null,
    legacyUsers: Number(legacy && legacy.c || 0),
  }
}
const envelopeForKey = async (idempotencyKey) => scalar('SELECT id, state, payload_hash, response_digest, committed_response, consent_record_id FROM auth_registration_envelopes WHERE idempotency_key = ? AND scope = ? AND endpoint = ? ORDER BY created_at DESC LIMIT 1', idempotencyKey, 'ACCOUNT_REGISTRATION', 'authRegister')

const tableRows = { results: all("SELECT name, type FROM sqlite_master WHERE type IN ('table','index') AND name IN ('users','user','account','session','auth_registration_envelopes','consents') ORDER BY type,name") }
const requiredObjects = new Set((tableRows.results || []).map((row) => String(row.type) + ':' + String(row.name)))
for (const required of ['table:users', 'table:user', 'table:account', 'table:session', 'table:auth_registration_envelopes', 'table:consents']) if (!requiredObjects.has(required)) throw new Error('Required local D1 object missing: ' + required)

const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
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
let triggerName = null

const cleanup = async () => {
  if (triggerName) { runSql('DROP TRIGGER IF EXISTS ' + triggerName); triggerName = null }
  runSql('DELETE FROM role_authorization_versions WHERE subject_id IN (SELECT CAST(id AS TEXT) FROM "user" WHERE email LIKE ?)', 'auth001-%-' + suffix + '@luckread.local')
  runSql('DELETE FROM role_assignments WHERE subject_id IN (SELECT CAST(id AS TEXT) FROM "user" WHERE email LIKE ?)', 'auth001-%-' + suffix + '@luckread.local')
  runSql('DELETE FROM consents WHERE resource_id IN (SELECT CAST(id AS TEXT) FROM "user" WHERE email LIKE ?)', 'auth001-%-' + suffix + '@luckread.local')
  runSql('DELETE FROM auth_registration_envelopes WHERE idempotency_key IN (?, ?, ?, ?, ?)', keySuccess, keyRollback, keyConcurrentA, keyConcurrentB, keySameKey)
  runSql('DELETE FROM "session" WHERE user_id IN (SELECT CAST(id AS TEXT) FROM "user" WHERE email LIKE ?)', 'auth001-%-' + suffix + '@luckread.local')
  runSql('DELETE FROM "account" WHERE user_id IN (SELECT CAST(id AS TEXT) FROM "user" WHERE email LIKE ?)', 'auth001-%-' + suffix + '@luckread.local')
  runSql('DELETE FROM "user" WHERE email LIKE ?', 'auth001-%-' + suffix + '@luckread.local')
}

try {
  const health = await fetch(baseUrl + '/')
  if (health.status >= 500) throw new Error('Local W01 did not start cleanly: HTTP ' + health.status)

  const firstResponse = await request(keySuccess, body)
  const first = await responseJson(firstResponse)
  if (firstResponse.status !== 201) throw new Error('Registration failed: HTTP ' + firstResponse.status)
  const successRows = await countsForEmail(email, username)
  if (successRows.users !== 1 || successRows.accounts !== 1 || successRows.consents !== 1) throw new Error('Successful registration did not create exactly one Better Auth User, one credential Account, and one Consent')
  if (!successRows.userId || successRows.accountState !== 'PENDING_VERIFICATION' || successRows.accountStateVersion !== 1) throw new Error('User lifecycle state/version is not canonical')
  if (successRows.emailVerified !== 0) throw new Error('Unexpected email verification state')
  if (!successRows.accountPassword || successRows.accountPassword === password) throw new Error('Better Auth credential password was not persisted as a non-plaintext value')
  if (!successRows.accountProviderId) throw new Error('Better Auth credential provider is missing')
  if (successRows.sessions !== 0) throw new Error('Registration unexpectedly auto-created a session')
  if (successRows.legacyUsers !== 0) throw new Error('W01 Payload Users table was unexpectedly written by Better Auth registration')
  const envelope = await envelopeForKey(keySuccess)
  if (!envelope || envelope.state !== 'COMPLETED') throw new Error('Completed registration envelope missing')
  const committedResponse = JSON.parse(String(envelope.committed_response))
  if (committedResponse.userId !== first.userId || committedResponse.accountState !== first.accountState) throw new Error('committed_response is not the returned canonical response')
  const expectedResponseDigest = await sha256Hex(JSON.stringify(canonicalize({ schema: 'AUTH-001.response-digest.v1', operationId: 'authRegister', endpoint: '/auth/register', idempotencyKey: keySuccess, payloadHash: envelope.payload_hash, status: 201, accountState: 'PENDING_VERIFICATION' })))
  if (envelope.response_digest !== expectedResponseDigest) throw new Error('response_digest does not match admitted pre-commit replay commitment')
  if (!/^[a-f0-9]{64}$/.test(String(envelope.response_digest))) throw new Error('response_digest is not canonical SHA-256 hex')

  const replayResponse = await request(keySuccess, body)
  const replay = await responseJson(replayResponse)
  if (replayResponse.status !== 201 || JSON.stringify(replay) !== JSON.stringify(first)) {
    const replayEnvelope = await envelopeForKey(keySuccess)
    throw new Error(
      'Idempotent replay did not return the original response: status=' +
        replayResponse.status +
        ' body=' +
        JSON.stringify(replay) +
        ' envelope=' +
        JSON.stringify(replayEnvelope),
    )
  }
  const reuseResponse = await request(keySuccess, { ...body, credential: password + '-changed' })
  const reuse = await responseJson(reuseResponse)
  if (reuseResponse.status !== 422 || !reuse.error || reuse.error.code !== 'IDEMPOTENCY_KEY_REUSE_CONFLICT') throw new Error('Idempotency key reuse conflict was not canonical')

  triggerName = 'auth001_evidence_fail_' + suffix
  runSql('CREATE TRIGGER ' + triggerName + " BEFORE INSERT ON auth_registration_envelopes BEGIN SELECT RAISE(ABORT, 'AUTH001_FORCED_RESERVATION_FAILURE'); END")
  const rollbackEmail = 'auth001-rollback-' + suffix + '@luckread.local'
  const rollbackUsername = 'auth001rb' + suffix
  const rollbackResponse = await request(keyRollback, { ...body, identity: rollbackEmail, username: rollbackUsername })
  const rollback = await responseJson(rollbackResponse)
  if (rollbackResponse.status !== 503) throw new Error('Forced rollback should fail closed with 503, got ' + rollbackResponse.status)
  const rollbackRows = await countsForEmail(rollbackEmail, rollbackUsername)
  if (rollbackRows.users !== 0 || rollbackRows.accounts !== 0 || rollbackRows.consents !== 0 || rollbackRows.legacyUsers !== 0) throw new Error('Failed reservation left a partial Better Auth User, Account, Consent, or Payload User record')
  runSql('DROP TRIGGER IF EXISTS ' + triggerName); triggerName = null

  const concurrentBody = { ...body, identity: concurrentEmail, username: concurrentUsername, credential: password + '-concurrent' }
  const pair = await Promise.all([request(keyConcurrentA, concurrentBody), request(keyConcurrentB, concurrentBody)])
  const statuses = pair.map((response) => response.status).sort((a, b) => a - b)
  if (statuses[0] !== 201 || statuses[1] !== 422) throw new Error('Concurrent duplicate identity did not produce exactly one success and one conflict: ' + statuses.join(','))
  const concurrentRows = await countsForEmail(concurrentEmail, concurrentUsername)
  if (concurrentRows.users !== 1 || concurrentRows.accounts !== 1 || concurrentRows.consents !== 1) throw new Error('Concurrent duplicate identity produced more than one authoritative registration record')

  const sameKeyEmail = 'auth001-same-key-' + suffix + '@luckread.local'
  const sameKeyUsername = 'auth001sk' + suffix
  const sameKeyBody = {
    ...body,
    identity: sameKeyEmail,
    username: sameKeyUsername,
    credential: password + '-same-key',
  }
  const sameKeyPair = await Promise.all([
    request(keySameKey, sameKeyBody),
    request(keySameKey, sameKeyBody),
  ])
  const sameKeyPayloads = await Promise.all(sameKeyPair.map(responseJson))
  const sameKeyStatuses = sameKeyPair.map((response) => response.status).sort((a, b) => a - b)

  const sameKeyReplayPath =
    sameKeyStatuses[0] === 201 &&
    sameKeyStatuses[1] === 201 &&
    JSON.stringify(sameKeyPayloads[0]) === JSON.stringify(sameKeyPayloads[1])

  const sameKeyInProgressPath =
    sameKeyStatuses[0] === 201 &&
    sameKeyStatuses[1] === 409 &&
    sameKeyPayloads.some(
      (value) => value && value.error && value.error.code === 'IDEMPOTENCY_IN_PROGRESS',
    )

  if (!sameKeyReplayPath && !sameKeyInProgressPath) {
    throw new Error(
      'Concurrent same Idempotency-Key did not satisfy canonical replay/in-progress semantics: ' +
        sameKeyStatuses.join(',') +
        ' payloads=' +
        JSON.stringify(sameKeyPayloads),
    )
  }

  const sameKeyRows = await countsForEmail(sameKeyEmail, sameKeyUsername)
  if (sameKeyRows.users !== 1 || sameKeyRows.accounts !== 1 || sameKeyRows.consents !== 1) {
    throw new Error('Concurrent same Idempotency-Key produced more than one authoritative registration record')
  }
  if (
    sameKeyReplayPath &&
    !sameKeyPayloads.some((value) => value && value.userId === sameKeyRows.userId)
  ) {
    throw new Error('Concurrent same-key replay did not return the canonical committed User')
  }

  const result = { status: 'PASS', evidenceType: 'AUTH-001_REGISTRATION_W02_BETTER_AUTH_LOCAL_RUNTIME', runId, sourceSha, environment: 'CONTROLLED_LOCAL_D1_W01_W02_OPENNEXT_WORKERS', assertions: { successfulRegistration: true, nativeBetterAuthUser: true, nativeCredentialAccount: true, exactlyOneConsent: true, accountStatePendingVerificationVersion1: true, credentialStoredNonPlaintext: true, autoSignInDisabled: true, payloadUsersTableUntouched: true, responseDigestMatchesAdmittedCommitment: true, replayReturnsOriginalResponse: true, idempotencyKeyReuseConflictCanonical: true, forcedReservationFailureFailClosed: true, concurrentDuplicateIdentitySingleWinner: true, downstreamLegacyMaterializerNotRequired: true }, observed: { userId: String(first.userId), accountState: first.accountState, accountPasswordLength: String(successRows.accountPassword).length, accountProviderId: successRows.accountProviderId, concurrentStatuses: pair.map((response) => response.status), sameKeyStatuses } }
  writeFileSync(new URL('./runtime-result.json', artifactDir), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await cleanup()
}