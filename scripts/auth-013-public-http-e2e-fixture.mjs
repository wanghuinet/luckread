import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'

const runId = process.env.GITHUB_RUN_ID ?? String(Date.now())
const attempt = process.env.GITHUB_RUN_ATTEMPT ?? '1'
const fixtureNonce = randomUUID()

const esc = (value) => String(value).replace(/'/g, "''")
const now = new Date().toISOString()
const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString()

const makeToken = () => 'v1.' + randomBytes(32).toString('base64url')
const basicRefresh = makeToken()
const operatorRefresh = makeToken()

const fixture = {
  basicEmail: 'auth013-e2e-basic-' + fixtureNonce + '@luckread.test',
  operatorEmail: 'auth013-e2e-operator-' + fixtureNonce + '@luckread.test',
  basicUsername: 'auth013-e2e-basic-' + fixtureNonce,
  operatorUsername: 'auth013-e2e-operator-' + fixtureNonce,
  targetEmail: 'auth013-e2e-target-' + fixtureNonce + '@luckread.test',
  targetUsername: 'auth013-e2e-target-' + fixtureNonce,
  basicUserId: 'auth013-user-' + randomUUID(),
  operatorUserId: 'auth013-user-' + randomUUID(),
  targetUserId: 'auth013-user-' + randomUUID(),
  basicSessionId: 'auth013-basic-' + randomUUID(),
  operatorSessionId: 'auth013-operator-' + randomUUID(),
  basicSessionToken: 'auth013-session-token-' + randomBytes(32).toString('base64url'),
  operatorSessionToken: 'auth013-session-token-' + randomBytes(32).toString('base64url'),
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

const sql = `INSERT INTO "user"
  (id, name, email, email_verified, image, username, bio, locale, timezone, account_state, account_state_version, created_at, updated_at)
VALUES
  ('${esc(fixture.basicUserId)}', 'AUTH013 E2E Basic', '${esc(fixture.basicEmail)}', 1, NULL, '${esc(fixture.basicUsername)}', NULL, 'en-US', 'UTC', 'ACTIVE', 1, '${fixture.now}', '${fixture.now}'),
  ('${esc(fixture.operatorUserId)}', 'AUTH013 E2E Operator', '${esc(fixture.operatorEmail)}', 1, NULL, '${esc(fixture.operatorUsername)}', NULL, 'en-US', 'UTC', 'ACTIVE', 1, '${fixture.now}', '${fixture.now}'),
  ('${esc(fixture.targetUserId)}', 'AUTH013 E2E Target', '${esc(fixture.targetEmail)}', 1, NULL, '${esc(fixture.targetUsername)}', NULL, 'en-US', 'UTC', 'ACTIVE', 1, '${fixture.now}', '${fixture.now}');

INSERT INTO "session"
  (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id)
VALUES
  ('${esc(fixture.basicSessionId)}', '${fixture.expires}', '${esc(fixture.basicSessionToken)}', '${fixture.now}', '${fixture.now}', NULL, 'AUTH013', '${esc(fixture.basicUserId)}'),
  ('${esc(fixture.operatorSessionId)}', '${fixture.expires}', '${esc(fixture.operatorSessionToken)}', '${fixture.now}', '${fixture.now}', NULL, 'AUTH013', '${esc(fixture.operatorUserId)}');

INSERT INTO role_assignments
  (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at)
VALUES
  ('${esc(fixture.basicRoleId)}', '${esc(fixture.basicUserId)}', 'user', 'global', NULL, 'ACTIVE', '${fixture.now}', NULL, '${fixture.now}', '${fixture.now}'),
  ('${esc(fixture.operatorRoleId)}', '${esc(fixture.operatorUserId)}', 'operator', 'global', NULL, 'ACTIVE', '${fixture.now}', NULL, '${fixture.now}', '${fixture.now}');

INSERT INTO auth_session_state
  (session_id, user_id, device_id, token_version, refresh_credential_hash, revoked_at, last_seen_at)
VALUES
  ('${esc(fixture.basicSessionId)}', '${esc(fixture.basicUserId)}', '${esc(fixture.basicDeviceId)}', 1, '${fixture.basicRefreshHash}', NULL, '${fixture.now}'),
  ('${esc(fixture.operatorSessionId)}', '${esc(fixture.operatorUserId)}', '${esc(fixture.operatorDeviceId)}', 1, '${fixture.operatorRefreshHash}', NULL, '${fixture.now}');
`

writeFileSync('/tmp/auth013-seed.sql', sql)
console.log(JSON.stringify({
  userIdAllocation: 'better_auth_fixture_defined',
  databaseMutationClass: 'controlled_synthetic_fixture_only',
  secretMaterialPersisted: 'sha256_refresh_hash_only',
}, null, 2))
