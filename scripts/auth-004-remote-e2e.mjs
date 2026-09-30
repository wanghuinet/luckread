import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BASE_URL = String(process.env.W01_BASE_URL || 'https://api.luckread.cn').replace(/\/$/, '')
const DATABASE_NAME = String(process.env.DATABASE_NAME || 'luckread')
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN
const WRANGLER_VERSION = process.env.WRANGLER_VERSION || '4.116.0'
const TEST_ID = `AUTH004-${process.env.GITHUB_RUN_ID || Date.now()}-${randomBytes(5).toString('hex')}`
const TESTED_COMMIT_SHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const ARTIFACT_DIR = 'artifacts/evidence/auth-004/remote-e2e'

if (!ACCOUNT_ID || !API_TOKEN) throw new Error('Cloudflare credentials are required for controlled remote evidence')
mkdirSync(ARTIFACT_DIR, { recursive: true })

const sqlString = (v) => `'${String(v).replace(/'/g, "''")}'`
const rows = (value) => Array.isArray(value) ? value.flatMap((x) => Array.isArray(x) ? x : (x?.results ?? x?.result ?? [])) : (value?.results ?? value?.result ?? [])
const d1 = (command) => {
  const output = execFileSync('npx', ['--yes', `wrangler@${WRANGLER_VERSION}`, 'd1', 'execute', DATABASE_NAME, '--remote', '--json', '--config', 'workers/W01-payload/wrangler.jsonc', '--command', command], { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 })
  return JSON.parse(output)
}
const query = (command) => rows(d1(command))
const write = (name, value) => writeFileSync(`${ARTIFACT_DIR}/${name}`, `${JSON.stringify(value, null, 2)}\n`)

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { status: res.status, bodyBytes: Buffer.byteLength(text), data }
}
const expect = (actual, wanted, label) => { if (actual !== wanted) throw new Error(`${label}: expected ${wanted}, got ${actual}`) }
const secretFree = (value, secrets) => {
  const text = JSON.stringify(value ?? '')
  return secrets.every((secret) => typeof secret !== 'string' || !secret || !text.includes(secret))
}

const created = []
const roleAssignments = []
const errors = []
async function createUser(label) {
  const suffix = `${TEST_ID}-${label}-${randomBytes(4).toString('hex')}`
  const email = `auth004-${suffix}@example.com`
  const password = `Evd-AUTH004-${randomBytes(24).toString('base64url')}-Z9!`
  const username = `auth004_${label}_${suffix.replaceAll('-', '').slice(-18)}`
  const res = await request('/auth/register', {
    method: 'POST',
    headers: { 'Idempotency-Key': `${TEST_ID}-register-${label}` },
    body: {
      identityType: 'email',
      identity: email,
      credential: password,
      username,
      consent: { purpose: 'ACCOUNT_REGISTRATION', policyVersion: 'PROD-2026-09-28.1' },
    },
  })
  expect(res.status, 201, `create user ${label}`)
  const id = String(res.data?.userId ?? '')
  if (!id || res.data?.accountState !== 'PENDING_VERIFICATION') {
    throw new Error(`create user ${label}: canonical registration response invalid`)
  }
  created.push({ id, email })
  return { id, email, password }
}

async function preparePositiveAuthSubject(user, label) {
  const now = new Date().toISOString()
  const roleAssignmentId = `${TEST_ID}-${label}-${randomBytes(6).toString('hex')}`
  const before = query(`SELECT account_state,account_state_version FROM users WHERE CAST(id AS TEXT)=${sqlString(user.id)} LIMIT 1`)[0]
  const existingAssignments = query(`SELECT id FROM role_assignments WHERE CAST(subject_id AS TEXT)=${sqlString(user.id)}`)
  if (existingAssignments.length !== 0) throw new Error(`positive auth fixture ${label}: synthetic user already has role assignments`)
  d1(`UPDATE users SET account_state='ACTIVE', account_state_version=COALESCE(account_state_version, 0) + 1 WHERE CAST(id AS TEXT)=${sqlString(user.id)}`)
  d1(`INSERT INTO role_assignments
    (id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at)
    VALUES (${sqlString(roleAssignmentId)}, ${sqlString(user.id)}, 'user', 'global', NULL, 'ACTIVE', ${sqlString(now)}, NULL, ${sqlString(now)}, ${sqlString(now)})`)
  roleAssignments.push(roleAssignmentId)
  const after = query(`SELECT account_state,account_state_version FROM users WHERE CAST(id AS TEXT)=${sqlString(user.id)} LIMIT 1`)[0]
  const assignment = query(`SELECT id,subject_id,role_id,scope_type,status FROM role_assignments WHERE id=${sqlString(roleAssignmentId)} LIMIT 1`)[0]
  if (String(after?.account_state ?? '') !== 'ACTIVE' || String(assignment?.subject_id ?? '') !== user.id || String(assignment?.role_id ?? '') !== 'user' || String(assignment?.scope_type ?? '') !== 'global' || String(assignment?.status ?? '') !== 'ACTIVE') {
    throw new Error(`positive auth fixture ${label}: activation or role assignment failed`)
  }
  write(`remote-positive-auth-fixture-${label}.json`, {
    featureId: 'AUTH-004',
    mode: 'CONTROLLED_REMOTE_D1_POSITIVE_AUTH_FIXTURE',
    userId: user.id,
    precondition: {
      accountState: before?.account_state ?? null,
      accountStateVersion: Number(before?.account_state_version ?? 0),
      roleAssignmentCountBefore: existingAssignments.length,
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
    },
    secretsRecorded: false,
  })
}

async function login(user, deviceId) {
  const res = await request('/auth/login', { method: 'POST', body: { identity: user.email, credential: user.password, deviceId } })
  expect(res.status, 200, `login ${deviceId}`)
  if (!res.data?.accessToken || !res.data?.refreshToken) throw new Error(`login ${deviceId}: missing auth pair`)
  return { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken }
}
const sessionRows = (userId) => query(`SELECT id,expires_at FROM users_sessions WHERE CAST(_parent_id AS TEXT)=${sqlString(userId)} ORDER BY created_at DESC`)
const resetState = (userId) => query(`SELECT reset_password_token,reset_password_expiration FROM users WHERE CAST(id AS TEXT)=${sqlString(userId)} LIMIT 1`)[0] ?? null

let primary, secondary, firstLogin, secondLogin, changedLogin
let existingResetToken = null
let expiredResetToken = null
try {
  const dependency = JSON.parse(readFileSync('workers/W01-payload/package.json', 'utf8'))
  if (dependency.dependencies?.payload !== '3.90.2' || dependency.dependencies?.['@payloadcms/db-d1-sqlite'] !== '3.90.2') throw new Error('W01 dependency contract mismatch')

  primary = await createUser('primary')
  await preparePositiveAuthSubject(primary, 'primary')
  secondary = await createUser('secondary')
  await preparePositiveAuthSubject(secondary, 'secondary')

  firstLogin = await login(primary, 'auth004-primary-a')
  secondLogin = await login(primary, 'auth004-primary-b')
  expect((await request('/api/users/me', { token: firstLogin.accessToken })).status, 200, 'first session before change')
  expect((await request('/api/users/me', { token: secondLogin.accessToken })).status, 200, 'second session before change')

  const wrongAccount = await request('/auth/password/change', {
    method: 'POST',
    token: await login(secondary, 'auth004-secondary').then((x) => x.accessToken),
    headers: { 'Idempotency-Key': `${TEST_ID}-wrong-account` },
    body: { currentPassword: primary.password, newPassword: `Evd-AUTH004-Other-${randomBytes(24).toString('base64url')}-Z9!` },
  })
  expect(wrongAccount.status, 401, 'cross-account password change')

  const changedPassword = `Evd-AUTH004-Changed-${randomBytes(24).toString('base64url')}-Z9!`
  const change = await request('/auth/password/change', {
    method: 'POST',
    token: firstLogin.accessToken,
    headers: { 'Idempotency-Key': `${TEST_ID}-change` },
    body: { currentPassword: primary.password, newPassword: changedPassword },
  })
  expect(change.status, 204, 'password change')
  if (change.bodyBytes !== 0) throw new Error('password change returned a response body')

  const postChangeSessionResults = await Promise.all([
    request('/api/users/me', { token: firstLogin.accessToken }),
    request('/api/users/me', { token: secondLogin.accessToken }),
  ])
  // Payload-native password updates retain the authenticated request's current
  // session and revoke the other affected native sessions.
  expect(postChangeSessionResults[0].status, 200, 'current session after change')
  expect(postChangeSessionResults[1].status, 401, 'other pre-change session after change')

  const changedSessionRows = sessionRows(primary.id)
  if (changedSessionRows.length !== 1) throw new Error(`password change retained ${changedSessionRows.length} native sessions; expected exactly 1`) 

  primary.password = changedPassword
  changedLogin = await login(primary, 'auth004-primary-after-change')

  const existingResetRequest = await request('/auth/password/reset/request', {
    method: 'POST',
    body: { identifier: primary.email },
  })
  const missingResetRequest = await request('/auth/password/reset/request', {
    method: 'POST',
    body: { identifier: `missing-${TEST_ID}@example.com` },
  })
  expect(existingResetRequest.status, 202, 'existing-account reset request')
  expect(missingResetRequest.status, 202, 'missing-account reset request')
  if (existingResetRequest.bodyBytes !== 0 || missingResetRequest.bodyBytes !== 0) throw new Error('reset request returned a response body')

  const state = resetState(primary.id)
  existingResetToken = state?.reset_password_token
  if (typeof existingResetToken !== 'string' || existingResetToken.length < 1) throw new Error('remote Payload reset token was not persisted')
  if (!state?.reset_password_expiration) throw new Error('remote Payload reset expiration was not persisted')

  const resetPassword = `Evd-AUTH004-Reset-${randomBytes(24).toString('base64url')}-Z9!`
  const reset = await request('/auth/password/reset/confirm', {
    method: 'POST',
    body: { recoveryToken: existingResetToken, newPassword: resetPassword },
  })
  expect(reset.status, 204, 'password reset confirm')
  if (reset.bodyBytes !== 0) throw new Error('reset confirm returned a response body')

  expect((await request('/api/users/me', { token: changedLogin.accessToken })).status, 401, 'pre-reset session after reset')
  const postResetSessionRows = sessionRows(primary.id)
  // Payload-native resetPassword clears prior sessions and creates one fresh
  // native session for the reset operation itself. The route intentionally
  // discards Payload's returned JWT to preserve the 204 contract.
  if (postResetSessionRows.length !== 1) {
    throw new Error(`password reset left ${postResetSessionRows.length} native sessions; expected exactly 1 reset-created session`)
  }

  const replay = await request('/auth/password/reset/confirm', {
    method: 'POST',
    body: { recoveryToken: existingResetToken, newPassword: `Evd-AUTH004-Replay-${randomBytes(24).toString('base64url')}-Z9!` },
  })
  expect(replay.status, 422, 'reset token replay')

  primary.password = resetPassword
  const resetLogin = await login(primary, 'auth004-primary-after-reset')
  if ((await request('/api/users/me', { token: resetLogin.accessToken })).status !== 200) throw new Error('reset password login did not establish a valid session')

  const expiredRequest = await request('/auth/password/reset/request', { method: 'POST', body: { identifier: primary.email } })
  expect(expiredRequest.status, 202, 'expired-token reset request')
  const expiredState = resetState(primary.id)
  expiredResetToken = expiredState?.reset_password_token
  if (typeof expiredResetToken !== 'string' || !expiredResetToken) throw new Error('expired reset token was not persisted')
  d1(`UPDATE users SET reset_password_expiration=${sqlString(new Date(Date.now() - 60_000).toISOString())} WHERE CAST(id AS TEXT)=${sqlString(primary.id)}`)
  const expiredConfirm = await request('/auth/password/reset/confirm', {
    method: 'POST',
    body: { recoveryToken: expiredResetToken, newPassword: `Evd-AUTH004-Expired-${randomBytes(24).toString('base64url')}-Z9!` },
  })
  expect(expiredConfirm.status, 422, 'expired reset token')

  write('remote-e2e-result.json', {
    featureId: 'AUTH-004',
    mode: 'PAYLOAD_NATIVE_REMOTE_HTTP_E2E',
    testedCommitSha: TESTED_COMMIT_SHA,
    assertions: {
      crossAccountChangeDenied: wrongAccount.status === 401,
      passwordChangeAccepted: change.status === 204 && change.bodyBytes === 0,
      currentSessionRetainedAfterChange: postChangeSessionResults[0].status === 200,
      otherPreChangeSessionInvalidated: postChangeSessionResults[1].status === 401,
      exactlyOneNativeSessionRetainedAfterChange: changedSessionRows.length === 1,
      resetRequestEnumerationResistant: existingResetRequest.status === 202 && missingResetRequest.status === 202 && existingResetRequest.bodyBytes === 0 && missingResetRequest.bodyBytes === 0,
      passwordResetAccepted: reset.status === 204 && reset.bodyBytes === 0,
      preResetSessionInvalidated: (await request('/api/users/me', { token: changedLogin.accessToken })).status === 401,
      exactlyOneResetCreatedNativeSession: postResetSessionRows.length === 1,
      resetTokenReplayDenied: replay.status === 422,
      expiredResetTokenDenied: expiredConfirm.status === 422,
      secretsRecorded: false,
      resetTokenPersistedOnlyAsTransientHarnessValue: true,
    },
    deploymentScope: {
      worker: 'luckread-w01-payload',
      database: DATABASE_NAME,
      baseUrl: BASE_URL,
    },
  })
} finally {
  for (const roleAssignmentId of roleAssignments) {
    try {
      d1(`DELETE FROM role_assignments WHERE id=${sqlString(roleAssignmentId)}`)
    } catch (error) {
      errors.push(String(error))
    }
  }

  for (const user of [primary, secondary]) {
    if (!user?.id || !user?.email) continue
    try {
      d1(`DELETE FROM auth_registration_envelopes WHERE consent_record_id IN (
        SELECT id FROM consents
        WHERE actor_subject_id=${sqlString(user.id)}
           OR owner_subject_id=${sqlString(user.id)}
           OR resource_id=${sqlString(user.id)}
      )`)
      d1(`DELETE FROM consents
        WHERE actor_subject_id=${sqlString(user.id)}
           OR owner_subject_id=${sqlString(user.id)}
           OR resource_id=${sqlString(user.id)}`)
      d1(`DELETE FROM auth_session_state WHERE user_id=${sqlString(user.id)}`)
      d1(`DELETE FROM users_sessions WHERE CAST(_parent_id AS TEXT)=${sqlString(user.id)}`)
      const match = query(`SELECT id,email FROM users WHERE CAST(id AS TEXT)=${sqlString(user.id)} LIMIT 1`)[0]
      if (String(match?.email ?? '') === user.email) d1(`DELETE FROM users WHERE CAST(id AS TEXT)=${sqlString(user.id)}`)
    } catch (error) {
      errors.push(String(error))
    }
  }
  write('remote-e2e-cleanup.json', { cleanupErrors: errors, secretsRecorded: false, testedCommitSha: TESTED_COMMIT_SHA })
}

if (errors.length) process.exitCode = 1
