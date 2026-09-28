import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'

const runId = process.env.GITHUB_RUN_ID ?? String(Date.now())
const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '1'
const makeNumericId = () => {
  const bytes = randomBytes(7)
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return String(1000000000000n + (value % 8000000000000n))
}

const basicUserId = makeNumericId()
let operatorUserId = makeNumericId()
while (operatorUserId === basicUserId) operatorUserId = makeNumericId()

const esc = (value) => String(value).replace(/'/g, "''")
const now = new Date().toISOString()
const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString()

const makeToken = () => 'v1.' + randomBytes(32).toString('base64url')
const basicRefresh = makeToken()
const operatorRefresh = makeToken()

const fixture = {
  basicUserId,
  operatorUserId,
  basicEmail: 'auth013-e2e-basic-' + runId + '-' + attempt + '@luckread.test',
  operatorEmail: 'auth013-e2e-operator-' + runId + '-' + attempt + '@luckread.test',
  basicUsername: 'auth013-e2e-basic-' + runId + '-' + attempt,
  operatorUsername: 'auth013-e2e-operator-' + runId + '-' + attempt,
  basicSessionId: 'auth013-basic-' + randomUUID(),
  operatorSessionId: 'auth013-operator-' + randomUUID(),
  basicRoleId: randomUUID(),
  operatorRoleId: randomUUID(),
  basicDeviceId: 'auth013-basic-device-' + runId + '-' + attempt,
  operatorDeviceId: 'auth013-operator-device-' + runId + '-' + attempt,
  basicRefreshToken: basicRefresh,
  operatorRefreshToken: operatorRefresh,
  basicRefreshHash: createHash('sha256').update(basicRefresh).digest('hex'),
  operatorRefreshHash: createHash('sha256').update(operatorRefresh).digest('hex'),
  now,
  expires,
}

for (const [key, value] of Object.entries(fixture)) {
  const envName = 'AUTH013_' + key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase()).toUpperCase()
  appendFileSync(process.env.GITHUB_ENV, envName + '=' + value + '\n')
  if (key.toLowerCase().includes('token')) console.log('::add-mask::' + value)
}

const sql = `INSERT INTO users
  (id, username, display_name, locale, timezone, email, account_state, account_state_version, created_at, updated_at)
VALUES
  (${fixture.basicUserId}, '${esc(fixture.basicUsername)}', 'AUTH013 E2E Basic', 'en-US', 'UTC', '${esc(fixture.basicEmail)}', 'ACTIVE', 1, '${fixture.now}', '${fixture.now}'),
  (${fixture.operatorUserId}, '${esc(fixture.operatorUsername)}', 'AUTH013 E2E Operator', 'en-US', 'UTC', '${esc(fixture.operatorEmail)}', 'ACTIVE', 1, '${fixture.now}', '${fixture.now}');

INSERT INTO users_sessions (_order, _parent_id, id, created_at, expires_at)
VALUES
  (1, ${fixture.basicUserId}, '${esc(fixture.basicSessionId)}', '${fixture.now}', '${fixture.expires}'),
  (1, ${fixture.operatorUserId}, '${esc(fixture.operatorSessionId)}', '${fixture.now}', '${fixture.expires}');

INSERT INTO role_assignments
  (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at)
VALUES
  ('${esc(fixture.basicRoleId)}', '${fixture.basicUserId}', 'user', 'global', NULL, 'ACTIVE', '${fixture.now}', NULL, '${fixture.now}', '${fixture.now}'),
  ('${esc(fixture.operatorRoleId)}', '${fixture.operatorUserId}', 'operator', 'global', NULL, 'ACTIVE', '${fixture.now}', NULL, '${fixture.now}', '${fixture.now}');

INSERT INTO auth_session_state
  (session_id, user_id, device_id, token_version, refresh_credential_hash, revoked_at, last_seen_at)
VALUES
  ('${esc(fixture.basicSessionId)}', '${fixture.basicUserId}', '${esc(fixture.basicDeviceId)}', 1, '${fixture.basicRefreshHash}', NULL, '${fixture.now}'),
  ('${esc(fixture.operatorSessionId)}', '${fixture.operatorUserId}', '${esc(fixture.operatorDeviceId)}', 1, '${fixture.operatorRefreshHash}', NULL, '${fixture.now}');
`

writeFileSync('/tmp/auth013-seed.sql', sql)
console.log(JSON.stringify({
  basicUserId: fixture.basicUserId,
  operatorUserId: fixture.operatorUserId,
  databaseMutationClass: 'controlled_synthetic_fixture_only',
  secretMaterialPersisted: 'sha256_refresh_hash_only',
}, null, 2))
