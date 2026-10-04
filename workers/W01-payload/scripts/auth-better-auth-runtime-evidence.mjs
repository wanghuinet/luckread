import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const baseUrl = process.env.AUTH_BETTER_AUTH_BASE_URL ?? 'http://127.0.0.1:8787'
const sourceSha = process.env.AUTH_BETTER_AUTH_SOURCE_SHA ?? process.env.GITHUB_SHA ?? 'unknown'
const evidenceDir = resolve(process.cwd(), '../../artifacts/evidence/auth-better-auth')
mkdirSync(evidenceDir, { recursive: true })

const policy = JSON.parse(readFileSync(
  resolve(process.cwd(), '../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json'),
  'utf8',
))
const suffix = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8)
const email = 'better-auth-e2e-' + suffix + '@example.com'
const username = 'better-auth-e2e-' + suffix
const oldPassword = 'LrE2e-' + crypto.randomUUID().replaceAll('-', '') + '-A'
const newPassword = 'LrE2e-' + crypto.randomUUID().replaceAll('-', '') + '-B'

const json = async (response) => {
  const body = await response.text()
  if (!body) return null
  try { return JSON.parse(body) } catch { return { raw: body } }
}
const expect = (value, message) => { if (!value) throw new Error(message) }
const ok = (status) => status >= 200 && status < 300
const setCookies = (headers) => typeof headers.getSetCookie === 'function'
  ? headers.getSetCookie()
  : (headers.get('set-cookie') ? [headers.get('set-cookie')] : [])

const applyCookies = (jar, headers) => {
  for (const item of setCookies(headers)) {
    const first = item.split(';', 1)[0] ?? ''
    const index = first.indexOf('=')
    if (index < 1) continue
    const name = first.slice(0, index)
    const value = first.slice(index + 1)
    value ? jar.set(name, value) : jar.delete(name)
  }
}
const cookieHeader = (jar) => [...jar.entries()].map(([key, value]) => key + '=' + value).join('; ')

const request = async (path, options = {}, jar = new Map()) => {
  const headers = new Headers(options.headers ?? {})
  const cookie = cookieHeader(jar)
  if (cookie) headers.set('cookie', cookie)
  const response = await fetch(baseUrl + path, { ...options, headers, redirect: 'manual' })
  applyCookies(jar, response.headers)
  return { response, body: await json(response) }
}

const sql = (value) => "'" + String(value).replaceAll("'", "''") + "'"
const d1 = (command) => {
  const raw = execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'luckread', '--local', '--json', '--config', 'wrangler.jsonc', '--command', command],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const parsed = JSON.parse(raw)
  const rows = []
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value.results)) rows.push(...value.results)
    Object.values(value).forEach(walk)
  }
  walk(parsed)
  return rows
}

const main = async () => {
  const userColumns = d1('PRAGMA table_info(users);').map((row) => String(row.name))
  const accountColumns = d1('PRAGMA table_info(auth_accounts);').map((row) => String(row.name))
  const sessionColumns = d1('PRAGMA table_info(auth_sessions);').map((row) => String(row.name))
  const verificationColumns = d1('PRAGMA table_info(auth_verifications);').map((row) => String(row.name))

  for (const field of ['id', 'email', 'username', 'email_verified']) expect(userColumns.includes(field), 'users.' + field + ' missing')
  expect(!userColumns.includes('password'), 'plaintext users.password must not exist')
  for (const field of ['id', 'user_id', 'account_id', 'provider_id', 'password']) expect(accountColumns.includes(field), 'auth_accounts.' + field + ' missing')
  for (const field of ['id', 'user_id', 'token', 'expires_at']) expect(sessionColumns.includes(field), 'auth_sessions.' + field + ' missing')
  for (const field of ['id', 'identifier', 'value', 'expires_at']) expect(verificationColumns.includes(field), 'auth_verifications.' + field + ' missing')

  const register = await request('/api/v1/auth/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'Idempotency-Key': 'better-auth-runtime-register-' + suffix,
    },
    body: JSON.stringify({
      identityType: 'email',
      identity: email,
      credential: oldPassword,
      username,
      consent: { purpose: 'ACCOUNT_REGISTRATION', policyVersion: policy.policyVersion },
    }),
  })
  expect(register.response.status === 201, 'registration failed: ' + register.response.status)
  const userId = String(register.body?.userId ?? '')
  expect(userId.length > 0, 'registration userId missing')
  expect(register.body?.accountState === 'PENDING_VERIFICATION', 'registration state mismatch')

  const userRow = d1('SELECT id,email,username,account_state,account_state_version,hash,salt FROM users WHERE id=' + sql(userId) + ' LIMIT 1;')[0]
  expect(userRow, 'registered user not persisted')
  expect(userRow.hash == null && userRow.salt == null, 'legacy users hash/salt mutated')

  const account = d1('SELECT provider_id,password FROM auth_accounts WHERE user_id=' + sql(userId) + ' LIMIT 1;')[0]
  expect(account && account.provider_id === 'credential' && typeof account.password === 'string' && account.password.length > 0, 'Better Auth credential persistence missing')

  const jar1 = new Map()
  const login1 = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identity: email, credential: oldPassword }),
  }, jar1)
  expect(ok(login1.response.status) && jar1.size > 0, 'login/session creation failed: ' + login1.response.status)

  const session = await request('/api/auth/get-session', { headers: { accept: 'application/json' } }, jar1)
  expect(ok(session.response.status) && String(session.body?.user?.id ?? '') === userId, 'Better Auth get-session failed')

  const me = await request('/api/v1/users/me', { headers: { accept: 'application/json' } }, jar1)
  expect(me.response.status === 200 && String(me.body?.id ?? '') === userId, 'Payload user facade failed')

  const list1 = await request('/api/v1/auth/sessions', { headers: { accept: 'application/json' } }, jar1)
  expect(list1.response.status === 200 && Array.isArray(list1.body?.items), 'session list failed')
  const currentSessionId = String(list1.body?.currentSessionId ?? '')
  expect(currentSessionId.length > 0, 'current session id missing')

  const refresh = await request('/api/v1/auth/refresh', { method: 'POST', headers: { accept: 'application/json' } }, jar1)
  expect(ok(refresh.response.status), 'compatibility refresh failed: ' + refresh.response.status)

  const jar2 = new Map()
  const login2 = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identity: email, credential: oldPassword }),
  }, jar2)
  expect(ok(login2.response.status), 'second login failed: ' + login2.response.status)

  const list2 = await request('/api/v1/auth/sessions', { headers: { accept: 'application/json' } }, jar1)
  const second = list2.body?.items?.find((item) => String(item.sessionId) !== currentSessionId)
  expect(list2.response.status === 200 && second, 'second session not discoverable')

  const revoke = await request('/api/v1/auth/sessions/' + encodeURIComponent(second.sessionId), {
    method: 'DELETE',
    headers: { 'Idempotency-Key': 'better-auth-runtime-revoke-' + suffix },
  }, jar1)
  expect(revoke.response.status === 204, 'session revoke failed: ' + revoke.response.status)

  const revoked = await request('/api/auth/get-session', { headers: { accept: 'application/json' } }, jar2)
  expect(revoked.body === null, 'revoked session remained active')

  const change = await request('/api/v1/auth/password/change', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'Idempotency-Key': 'better-auth-runtime-password-' + suffix },
    body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
  }, jar1)
  expect(ok(change.response.status), 'password change failed: ' + change.response.status)

  const oldLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identity: email, credential: oldPassword }),
  })
  expect(oldLogin.response.status === 401, 'old password accepted after change')

  const jar3 = new Map()
  const newLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identity: email, credential: newPassword }),
  }, jar3)
  expect(ok(newLogin.response.status), 'new password login failed: ' + newLogin.response.status)

  const knownReset = await request('/api/v1/auth/password/reset/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identifier: email }),
  })
  const unknownReset = await request('/api/v1/auth/password/reset/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ identifier: 'missing-' + suffix + '@example.com' }),
  })
  expect(ok(knownReset.response.status) && knownReset.response.status === unknownReset.response.status, 'password reset leaks account existence by status')

  const logout = await request('/api/v1/auth/logout', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Idempotency-Key': 'better-auth-runtime-logout-' + suffix,
    },
  }, jar3)
  expect(ok(logout.response.status), 'logout failed: ' + logout.response.status)
  const postLogout = await request('/api/auth/get-session', { headers: { accept: 'application/json' } }, jar3)
  expect(postLogout.body === null, 'logout did not revoke session')

  const result = {
    result: 'PASS',
    evidenceType: 'AUTH_BETTER_AUTH_CORE_LOCAL_RUNTIME',
    sourceSha,
    betterAuthVersion: '1.7.7',
    payloadVersion: '3.90.2',
    userId,
    assertions: {
      schemaVerified: true,
      registrationViaBetterAuth: true,
      betterAuthCredentialPersisted: true,
      legacyHashSaltUntouched: true,
      sessionCreatedAndRead: true,
      payloadUserFacadeAuthenticated: true,
      compatibilityRefreshRoute: true,
      secondSessionAndRevocation: true,
      passwordChangeAndReplacement: true,
      passwordResetEnumerationResistance: true,
      logoutRevocation: true,
    },
    observed: {
      accountState: String(userRow.account_state),
      accountStateVersion: Number(userRow.account_state_version),
      authSessionCount: Number(d1('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=' + sql(userId) + ';')[0]?.count ?? 0),
    },
  }
  writeFileSync(resolve(evidenceDir, 'runtime-result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  const failure = { result: 'FAIL', evidenceType: 'AUTH_BETTER_AUTH_CORE_LOCAL_RUNTIME', sourceSha, error: error instanceof Error ? error.message : String(error) }
  writeFileSync(resolve(evidenceDir, 'runtime-result.json'), JSON.stringify(failure, null, 2) + '\n')
  console.error(JSON.stringify(failure, null, 2))
  process.exit(1)
})
