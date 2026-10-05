import { execFileSync, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const baseUrl = process.env.AUTH001_BASE_URL || 'http://127.0.0.1:8787'
const runId = process.env.GITHUB_RUN_ID || 'local'
const artifactDir = new URL('../../../artifacts/mapping-0/auth-001-runtime-local/', import.meta.url)
mkdirSync(artifactDir, { recursive: true })

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const scriptFile = fileURLToPath(import.meta.url)
const w01Dir = dirname(scriptFile).replace(/\\scripts$/, '')
const w02Dir = resolve(w01Dir, '../W02-identity')
const w02LogPath = resolve(artifactDir, 'w02-auth-preview.log')
let w02Process = null
let w01Process = null
let w02LogStream = null
const policy = JSON.parse(
  readFileSync(
    new URL('../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json', import.meta.url),
    'utf8',
  ),
)

if (policy.policyVersion !== 'DEV-2026-09-28.1') {
  throw new Error('Unexpected development PRIV-004 policy version')
}

const escapeSql = (value) => "'" + String(value).replaceAll("'", "''") + "'"
const renderSql = (sql, args) => {
  let index = 0
  return sql.replaceAll('?', () => escapeSql(args[index++]))
}

const d1Json = (configPath, command) => {
  const output = execFileSync(
    'npx',
    [
      '--yes',
      'wrangler@4.116.0',
      'd1',
      'execute',
      'luckread',
      '--local',
      '--json',
      '--config',
      configPath,
      '--command',
      command,
    ],
    {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  return JSON.parse(output)
}

const d1Rows = (configPath, command) => {
  const value = d1Json(configPath, command)
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

const scalar = (configPath, sql, ...args) => d1Rows(configPath, renderSql(sql, args))[0] ?? null
const all = (configPath, sql, ...args) => d1Rows(configPath, renderSql(sql, args))
const runSql = (configPath, sql, ...args) => {
  d1Json(configPath, renderSql(sql, args))
}

const W01_CONFIG = 'wrangler.jsonc'
const W02_CONFIG = '../W02-identity/wrangler.jsonc'

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    )
  }
  return value
}

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const responseJson = async (response) => {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Expected JSON response, HTTP ' + response.status + ': ' + text.slice(0, 500))
  }
}

const request = async (idempotencyKey, body) =>
  fetch(baseUrl + '/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      connection: 'close',
    },
    body: JSON.stringify(body),
  })

const countsForEmail = async (email, username) => {
  const user = scalar(
    W02_CONFIG,
    'SELECT COUNT(*) AS c, MIN(id) AS id, MIN(account_state) AS account_state, MIN(account_state_version) AS account_state_version FROM "user" WHERE email = ? AND username = ?',
    email,
    username,
  )

  const userId = user?.id != null ? String(user.id) : null
  const account = userId
    ? scalar(W02_CONFIG, 'SELECT COUNT(*) AS c, MIN(password) AS password FROM "account" WHERE user_id = ?', userId)
    : null
  const session = userId
    ? scalar(W02_CONFIG, 'SELECT COUNT(*) AS c FROM "session" WHERE user_id = ?', userId)
    : null
  const consent = userId
    ? scalar(W02_CONFIG, 'SELECT COUNT(*) AS c, MIN(id) AS id FROM consents WHERE CAST(resource_id AS TEXT) = ?', userId)
    : null
  const role = userId
    ? scalar(W02_CONFIG, "SELECT COUNT(*) AS c FROM role_assignments WHERE subject_id = ? AND status = 'ACTIVE'", userId)
    : null
  const w01User = scalar(
    W01_CONFIG,
    'SELECT COUNT(*) AS c FROM users WHERE email = ? AND username = ?',
    email,
    username,
  )

  return {
    users: Number(user?.c || 0),
    userId,
    accountRows: Number(account?.c || 0),
    accountPassword: account?.password ?? null,
    sessions: Number(session?.c || 0),
    consents: Number(consent?.c || 0),
    consentId: consent?.id ?? null,
    activeRoles: Number(role?.c || 0),
    w01Users: Number(w01User?.c || 0),
    accountState: user?.account_state ?? null,
    accountStateVersion: user?.account_state_version != null ? Number(user.account_state_version) : null,
  }
}


const waitForPort = async (url, timeoutMs = 30000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.status >= 100) return
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  throw new Error('Worker did not become reachable: ' + url)
}

const installAndPrepareW02 = () => {
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: w02Dir,
    stdio: 'inherit',
    env: process.env,
  })

  for (const migration of ['migrations/0001_role_assignments.sql', 'migrations/0005_better_auth_identity_core.sql']) {
    execFileSync(
      'npx',
      ['--yes', 'wrangler@4.116.0', 'd1', 'execute', 'luckread', '--local', '--config', 'wrangler.jsonc', '--file', migration],
      { cwd: w02Dir, stdio: 'inherit', env: process.env },
    )
  }

  const governanceSql = `CREATE TABLE auth_registration_envelopes (
    id text PRIMARY KEY NOT NULL,
    idempotency_key text NOT NULL,
    active_key text,
    scope text NOT NULL,
    endpoint text NOT NULL,
    payload_hash text NOT NULL,
    state text NOT NULL,
    response_digest text,
    committed_response text,
    expires_at text NOT NULL,
    consent_record_id text,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  CREATE UNIQUE INDEX auth_registration_envelopes_active_key_idx ON auth_registration_envelopes(active_key);
  CREATE INDEX auth_registration_envelopes_idempotency_key_idx ON auth_registration_envelopes(idempotency_key);
  CREATE INDEX auth_registration_envelopes_scope_endpoint_idx ON auth_registration_envelopes(scope, endpoint);
  CREATE INDEX auth_registration_envelopes_payload_hash_idx ON auth_registration_envelopes(payload_hash);
  CREATE INDEX auth_registration_envelopes_state_idx ON auth_registration_envelopes(state);
  CREATE INDEX auth_registration_envelopes_expires_at_idx ON auth_registration_envelopes(expires_at);
  CREATE INDEX auth_registration_envelopes_consent_record_id_idx ON auth_registration_envelopes(consent_record_id);
  CREATE TABLE consents (
    id text PRIMARY KEY NOT NULL,
    actor_subject_id text NOT NULL,
    owner_subject_id text NOT NULL,
    resource_id text NOT NULL,
    resource_type text NOT NULL,
    purpose text NOT NULL,
    state text NOT NULL,
    policy_version text NOT NULL,
    legal_basis text NOT NULL,
    withdrawn_at text,
    retention_class text NOT NULL,
    retention_until text NOT NULL,
    source_authority text NOT NULL,
    legal_hold_ref text,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  CREATE INDEX consents_actor_subject_id_idx ON consents(actor_subject_id);
  CREATE INDEX consents_owner_subject_id_idx ON consents(owner_subject_id);
  CREATE INDEX consents_resource_id_idx ON consents(resource_id);
  CREATE INDEX consents_resource_type_idx ON consents(resource_type);
  CREATE INDEX consents_purpose_idx ON consents(purpose);
  CREATE INDEX consents_state_idx ON consents(state);
  CREATE INDEX consents_policy_version_idx ON consents(policy_version);
  CREATE INDEX consents_legal_basis_idx ON consents(legal_basis);
  CREATE INDEX consents_withdrawn_at_idx ON consents(withdrawn_at);
  CREATE INDEX consents_retention_class_idx ON consents(retention_class);
  CREATE INDEX consents_retention_until_idx ON consents(retention_until);
  CREATE INDEX consents_source_authority_idx ON consents(source_authority);
  CREATE INDEX consents_legal_hold_ref_idx ON consents(legal_hold_ref);
`

  const sqlPath = resolve(artifactDir, 'auth001-governance-schema.sql')
  writeFileSync(sqlPath, governanceSql)
  execFileSync(
    'npx',
    ['--yes', 'wrangler@4.116.0', 'd1', 'execute', 'luckread', '--local', '--config', resolve(w02Dir, 'wrangler.jsonc'), '--file', sqlPath],
    { cwd: w01Dir, stdio: 'inherit', env: process.env },
  )
}

const startW02 = async () => {
  w02LogStream = createWriteStream(w02LogPath, { flags: 'a' })
  w02Process = spawn(
    'npx',
    ['--yes', 'wrangler@4.116.0', 'dev', '--local', '--port', '8788', '--config', 'wrangler.jsonc'],
    { cwd: w02Dir, env: process.env, stdio: ['ignore', w02LogStream, w02LogStream] },
  )
  await waitForPort('http://127.0.0.1:8788/')
}

const stopProcess = (processHandle) => {
  if (!processHandle || processHandle.killed) return
  try { processHandle.kill('SIGTERM') } catch {}
}

const restartW01 = async () => {
  const pidFile = resolve(w01Dir, 'auth-001-preview.pid')
  if (existsSync(pidFile)) {
    try {
      process.kill(Number(readFileSync(pidFile, 'utf8').trim()), 'SIGTERM')
    } catch {}
    try { unlinkSync(pidFile) } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }

  try { unlinkSync(resolve(w01Dir, 'auth-001-preview.log')) } catch {}

  w01Process = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--local',
      '--port',
      '8787',
      '--var',
      'PAYLOAD_SECRET:auth001-local-evidence-secret-20260928',
      '--var',
      'CLOUDFLARE_ENV:development',
    ],
    { cwd: w01Dir, env: process.env, stdio: ['ignore', 'ignore', 'ignore'] },
  )

  await waitForPort('http://127.0.0.1:8787/')

  const started = Date.now()
  while (Date.now() - started < 30000) {
    const log = existsSync(resolve(w01Dir, 'auth-001-preview.log'))
      ? readFileSync(resolve(w01Dir, 'auth-001-preview.log'), 'utf8')
      : ''
    if (log.includes('env.W02_AUTH (luckread-w02)') && log.includes('[connected]')) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }

  const log = existsSync(resolve(w01Dir, 'auth-001-preview.log'))
    ? readFileSync(resolve(w01Dir, 'auth-001-preview.log'), 'utf8')
    : ''
  throw new Error('W01 W02_AUTH local service binding did not become connected\n' + log)
}

const envelopeForKey = async (idempotencyKey) =>
  scalar(
    W02_CONFIG,
    'SELECT id, state, payload_hash, response_digest, committed_response, consent_record_id FROM auth_registration_envelopes WHERE idempotency_key = ? AND scope = ? AND endpoint = ? ORDER BY created_at DESC LIMIT 1',
    idempotencyKey,
    'ACCOUNT_REGISTRATION',
    'authRegister',
  )

const tableRows = {
  results: all(
    W02_CONFIG,
    "SELECT name, type FROM sqlite_master WHERE type IN ('table','index') AND name IN ('user','account','session','auth_registration_envelopes','consents','role_assignments') ORDER BY type,name",
  ),
}
const requiredObjects = new Set(
  (tableRows.results || []).map((row) => String(row.type) + ':' + String(row.name)),
)
for (const required of [
  'table:user',
  'table:account',
  'table:session',
  'table:auth_registration_envelopes',
  'table:consents',
  'table:role_assignments',
]) {
  if (!requiredObjects.has(required)) throw new Error('Required W02 local D1 object missing: ' + required)
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
const email = 'auth001-runtime-' + suffix + '@luckread.local'
const username = 'auth001rt' + suffix
const password = 'Evd-AUTH001-Batch-' + suffix + '-9x!'
const body = {
  identityType: 'email',
  identity: email,
  credential: password,
  username,
  consent: { purpose: 'ACCOUNT_REGISTRATION', policyVersion: policy.policyVersion },
}

const keySuccess = 'auth001-local-success-' + suffix
const keyRollback = 'auth001-local-recovery-' + suffix
const keyConcurrentA = 'auth001-local-concurrent-a-' + suffix
const keyConcurrentB = 'auth001-local-concurrent-b-' + suffix
const keySameKey = 'auth001-local-same-key-' + suffix
const concurrentEmail = 'auth001-concurrent-' + suffix + '@luckread.local'
const concurrentUsername = 'auth001ct' + suffix
const sameKeyEmail = 'auth001-same-key-' + suffix + '@luckread.local'
const sameKeyUsername = 'auth001sk' + suffix
let triggerName = null

const cleanup = async () => {
  if (triggerName) {
    runSql(W02_CONFIG, 'DROP TRIGGER IF EXISTS ' + triggerName)
    triggerName = null
  }

  runSql(
    W02_CONFIG,
    'DELETE FROM "session" WHERE user_id IN (SELECT id FROM "user" WHERE email IN (?, ?, ?) OR email LIKE ?)',
    email,
    concurrentEmail,
    sameKeyEmail,
    'auth001-rollback-' + suffix + '@luckread.local',
  )
  runSql(
    W02_CONFIG,
    'DELETE FROM role_assignments WHERE subject_id IN (SELECT id FROM "user" WHERE email IN (?, ?, ?) OR email LIKE ?)',
    email,
    concurrentEmail,
    sameKeyEmail,
    'auth001-rollback-' + suffix + '@luckread.local',
  )
  runSql(
    W02_CONFIG,
    'DELETE FROM consents WHERE CAST(resource_id AS TEXT) IN (SELECT CAST(id AS TEXT) FROM "user" WHERE email IN (?, ?, ?) OR email LIKE ?)',
    email,
    concurrentEmail,
    sameKeyEmail,
    'auth001-rollback-' + suffix + '@luckread.local',
  )
  runSql(
    W02_CONFIG,
    'DELETE FROM auth_registration_envelopes WHERE idempotency_key IN (?, ?, ?, ?, ?)',
    keySuccess,
    keyRollback,
    keyConcurrentA,
    keyConcurrentB,
    keySameKey,
  )
  runSql(
    W02_CONFIG,
    'DELETE FROM "account" WHERE user_id IN (SELECT id FROM "user" WHERE email IN (?, ?, ?, ?) OR email LIKE ?)',
    email,
    concurrentEmail,
    sameKeyEmail,
    'auth001-rollback-' + suffix + '@luckread.local',
    'auth001-rollback-' + suffix + '@luckread.local',
  )
  runSql(
    W02_CONFIG,
    'DELETE FROM "user" WHERE email IN (?, ?, ?, ?) OR email LIKE ?',
    email,
    concurrentEmail,
    sameKeyEmail,
    'auth001-rollback-' + suffix + '@luckread.local',
    'auth001-rollback-' + suffix + '@luckread.local',
  )
}

try {
  installAndPrepareW02()
  await startW02()
  await restartW01()
  const health = await fetch(baseUrl + '/')

  if (health.status >= 500) throw new Error('Local W01 did not start cleanly: HTTP ' + health.status)

  const firstResponse = await request(keySuccess, body)
  const first = await responseJson(firstResponse)
  if (firstResponse.status !== 201) throw new Error('Registration failed: HTTP ' + firstResponse.status)

  const successRows = await countsForEmail(email, username)
  if (successRows.users !== 1 || successRows.accountRows !== 1 || successRows.consents !== 1) {
    throw new Error('Successful registration did not create exactly one Better Auth User, Account and Consent')
  }
  if (successRows.w01Users !== 0) {
    throw new Error('W01 Payload users table was mutated by Better Auth registration')
  }
  if (!successRows.userId || successRows.accountState !== 'PENDING_VERIFICATION' || successRows.accountStateVersion !== 1) {
    throw new Error('Better Auth User lifecycle state/version is not canonical')
  }
  if (!successRows.accountPassword || successRows.accountPassword === password) {
    throw new Error('Better Auth password material is missing or plaintext')
  }
  if (successRows.sessions !== 0) {
    throw new Error('Registration unexpectedly created an active Better Auth session')
  }
  if (successRows.activeRoles < 1) {
    throw new Error('Base role materialization did not occur in W02')
  }

  const envelope = await envelopeForKey(keySuccess)
  if (!envelope || envelope.state !== 'COMPLETED') throw new Error('Completed registration envelope missing')

  const committedResponse = JSON.parse(String(envelope.committed_response))
  if (committedResponse.userId !== first.userId || committedResponse.accountState !== first.accountState) {
    throw new Error('committed_response is not the returned canonical response')
  }

  const expectedResponseDigest = await sha256Hex(
    JSON.stringify(
      canonicalize({
        schema: 'AUTH-001.response-digest.v1',
        operationId: 'authRegister',
        endpoint: '/auth/register',
        idempotencyKey: keySuccess,
        payloadHash: envelope.payload_hash,
        status: 201,
        accountState: 'PENDING_VERIFICATION',
      }),
    ),
  )

  if (envelope.response_digest !== expectedResponseDigest) {
    throw new Error('response_digest does not match admitted pre-commit replay commitment')
  }

  if (!/^[a-f0-9]{64}$/.test(String(envelope.response_digest))) {
    throw new Error('response_digest is not canonical SHA-256 hex')
  }

  const replayResponse = await request(keySuccess, body)
  const replay = await responseJson(replayResponse)
  if (replayResponse.status !== 201 || JSON.stringify(replay) !== JSON.stringify(first)) {
    throw new Error('Idempotent replay did not return the original response')
  }

  const reuseResponse = await request(keySuccess, { ...body, credential: password + '-changed' })
  const reuse = await responseJson(reuseResponse)
  if (reuseResponse.status !== 422 || reuse?.error?.code !== 'IDEMPOTENCY_KEY_REUSE_CONFLICT') {
    throw new Error('Idempotency key reuse conflict was not canonical')
  }

  triggerName = 'auth001_evidence_recovery_' + suffix
  runSql(
    W02_CONFIG,
    'CREATE TRIGGER ' +
      triggerName +
      " BEFORE UPDATE ON auth_registration_envelopes BEGIN SELECT RAISE(ABORT, 'AUTH001_FORCED_FINALIZE_FAILURE'); END",
  )

  const recoveryEmail = 'auth001-recovery-' + suffix + '@luckread.local'
  const recoveryUsername = 'auth001rc' + suffix
  const recoveryBody = {
    ...body,
    identity: recoveryEmail,
    username: recoveryUsername,
    credential: password + '-recovery',
  }

  const recoveryResponse = await request(keyRollback, recoveryBody)
  const recovery = await responseJson(recoveryResponse)
  if (recoveryResponse.status !== 503) {
    throw new Error('Forced finalize failure should fail closed with 503, got ' + recoveryResponse.status)
  }

  runSql(W02_CONFIG, 'DROP TRIGGER IF EXISTS ' + triggerName)
  triggerName = null

  const recoveryRowsBeforeRetry = await countsForEmail(recoveryEmail, recoveryUsername)
  const recoveryEnvelope = await envelopeForKey(keyRollback)
  if (
    recoveryRowsBeforeRetry.users !== 1 ||
    recoveryRowsBeforeRetry.accountRows !== 1 ||
    recoveryRowsBeforeRetry.consents !== 0 ||
    recoveryRowsBeforeRetry.w01Users !== 0 ||
    recoveryEnvelope?.state !== 'IN_PROGRESS'
  ) {
    throw new Error('Recoverable AUTH-001 failure state was not preserved')
  }

  const recoveredResponse = await request(keyRollback, recoveryBody)
  const recovered = await responseJson(recoveredResponse)
  if (recoveredResponse.status !== 201 || recovered.accountState !== 'PENDING_VERIFICATION') {
    throw new Error('AUTH-001 retry did not recover the Better Auth user')
  }

  const recoveryRowsAfterRetry = await countsForEmail(recoveryEmail, recoveryUsername)
  const recoveredEnvelope = await envelopeForKey(keyRollback)
  if (
    recoveryRowsAfterRetry.users !== 1 ||
    recoveryRowsAfterRetry.accountRows !== 1 ||
    recoveryRowsAfterRetry.consents !== 1 ||
    recoveredEnvelope?.state !== 'COMPLETED'
  ) {
    throw new Error('AUTH-001 retry did not converge the recoverable registration')
  }

  const concurrentBody = {
    ...body,
    identity: concurrentEmail,
    username: concurrentUsername,
    credential: password + '-concurrent',
  }

  const pair = await Promise.all([
    request(keyConcurrentA, concurrentBody),
    request(keyConcurrentB, concurrentBody),
  ])
  const statuses = pair.map((response) => response.status).sort((a, b) => a - b)
  if (statuses[0] !== 201 || statuses[1] !== 422) {
    throw new Error('Concurrent duplicate identity did not produce exactly one success and one conflict: ' + statuses.join(','))
  }

  const concurrentRows = await countsForEmail(concurrentEmail, concurrentUsername)
  if (
    concurrentRows.users !== 1 ||
    concurrentRows.accountRows !== 1 ||
    concurrentRows.consents !== 1 ||
    concurrentRows.w01Users !== 0
  ) {
    throw new Error('Concurrent duplicate identity did not converge to one W02 registration')
  }

  const failedConcurrentEnvelope = [
    await envelopeForKey(keyConcurrentA),
    await envelopeForKey(keyConcurrentB),
  ].find((value) => value?.state === 'FAILED')

  if (!failedConcurrentEnvelope) {
    throw new Error('Losing duplicate-identity registration was not marked FAILED')
  }

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
      (value) => value?.error?.code === 'IDEMPOTENCY_IN_PROGRESS',
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
  if (sameKeyRows.users !== 1 || sameKeyRows.accountRows !== 1 || sameKeyRows.consents !== 1) {
    throw new Error('Concurrent same Idempotency-Key produced more than one W02 registration')
  }

  if (
    sameKeyReplayPath &&
    !sameKeyPayloads.some((value) => value?.userId === sameKeyRows.userId)
  ) {
    throw new Error('Concurrent same-key replay did not return the canonical Better Auth User')
  }

  const result = {
    status: 'PASS',
    evidenceType: 'AUTH-001_BETTER_AUTH_LOCAL_RUNTIME',
    runId,
    sourceSha,
    environment: 'CONTROLLED_LOCAL_W01_W02_OPENNEXT_WRANGLER',
    assertions: {
      w02IdentityAuthority: true,
      w01PayloadUserUnchanged: true,
      betterAuthUserAccountPersisted: true,
      betterAuthSessionNotAutoCreated: true,
      accountStatePendingVerificationVersion1: true,
      passwordMaterialNotPlaintext: true,
      consentPersistedWithRegistrationEnvelope: true,
      baseRoleMaterialized: true,
      replayReturnsOriginalResponse: true,
      idempotencyKeyReuseConflictCanonical: true,
      recoverableFinalizeFailure: true,
      concurrentDuplicateIdentitySingleWinner: true,
      concurrentSameKeyReplayOrInProgress: true,
    },
    observed: {
      userId: String(first.userId),
      accountState: first.accountState,
      concurrentStatuses: pair.map((response) => response.status),
      sameKeyStatuses,
      w01UserRowsAfterSuccess: successRows.w01Users,
    },
  }

  writeFileSync(
    new URL('./runtime-result.json', artifactDir),
    JSON.stringify(result, null, 2) + '\n',
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  await cleanup()
  stopProcess(w01Process)
  stopProcess(w02Process)
  if (w02LogStream) w02LogStream.end()
}
