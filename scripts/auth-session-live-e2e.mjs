import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = (process.env.LUCKREAD_API_BASE_URL || 'https://luckread.com').replace(/\/$/, '')
const email = process.env.LUCKREAD_APP_AUTH_SMOKE_EMAIL || ''
const password = process.env.LUCKREAD_APP_AUTH_SMOKE_PASSWORD || ''
const runId = process.env.GITHUB_RUN_ID || 'local'
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1'
const sourceSha = process.env.GITHUB_SHA || 'unknown'
const evidenceDir = resolve('artifacts/api-auth-session-live-e2e')
const evidencePath = resolve(evidenceDir, `auth-session-live-e2e-${runId}-${runAttempt}.json`)

const result = {
  evidenceType: 'LUCKREAD_APP_AUTH_SESSION_LIVE_E2E',
  timestamp: new Date().toISOString(),
  baseUrl,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceSha,
  credentialsLogged: false,
  responseBodiesStored: false,
  sessionTokensStored: false,
  cookieValuesStored: false,
  checks: [],
  status: 'PENDING',
}

const hasCredentialField = (value) => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasCredentialField)
  return Object.entries(value).some(([key, nested]) =>
    /^(?:token|accessToken|refreshToken|sessionToken)$/i.test(key) || hasCredentialField(nested))
}

const safeErrorCode = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.code)) return value.code
  if (value.error && typeof value.error === 'object' &&
      typeof value.error.code === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.error.code)) {
    return value.error.code
  }
  return null
}

const check = (name, pass, facts = {}) => {
  result.checks.push({ name, pass, ...facts })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${facts.status === undefined ? '' : ' HTTP ' + facts.status}`)
  return pass
}

const request = async (name, method, path, { headers = {}, body } = {}) => {
  const started = Date.now()
  try {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { accept: 'application/json', ...headers },
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    let json = null
    let isJson = false
    const raw = await response.text()
    try {
      json = raw ? JSON.parse(raw) : null
      isJson = raw.length === 0 || json !== undefined
    } catch {}
    const cookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean)
    return {
      response,
      json,
      raw,
      cookies,
      facts: {
        name,
        method,
        path,
        status: response.status,
        durationMs: Date.now() - started,
        cfRay: response.headers.get('cf-ray'),
        cacheControl: response.headers.get('cache-control'),
        contentType: response.headers.get('content-type'),
        isJson,
        responseTopLevelKeys: json && typeof json === 'object' && !Array.isArray(json)
          ? Object.keys(json).sort()
          : [],
        errorCode: safeErrorCode(json),
        setCookieCount: cookies.length,
        setCookieNames: cookies.map((item) => item.split(';', 1)[0].split('=', 1)[0]).filter(Boolean),
        hasNativeSessionHeader: Boolean(response.headers.get('x-luckread-session-token')),
      },
    }
  } catch (error) {
    return {
      response: null,
      json: null,
      raw: '',
      cookies: [],
      facts: {
        name,
        method,
        path,
        status: null,
        durationMs: Date.now() - started,
        transportError: error instanceof Error ? error.name : typeof error,
      },
    }
  }
}

// Cookie values stay in process memory and are never copied to evidence or logs.
class CookieJar {
  #values = new Map()

  update(setCookieHeaders) {
    for (const header of setCookieHeaders) {
      const pair = header.split(';', 1)[0]
      const index = pair.indexOf('=')
      if (index <= 0) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(header)) this.#values.delete(name)
      else this.#values.set(name, value)
    }
  }

  header() {
    return [...this.#values].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  names() {
    return [...this.#values.keys()].sort()
  }
}

const finish = async () => {
  const failed = result.checks.filter((entry) => !entry.pass)
  result.summary = {
    total: result.checks.length,
    passed: result.checks.length - failed.length,
    failed: failed.length,
  }
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  console.log(`Sanitized evidence written: ${evidencePath}`)
  console.log(`Summary: ${result.summary.passed}/${result.summary.total} checks passed; status=${result.status}`)
  if (result.status !== 'PASS') process.exitCode = 1
}

if (!email || !password) {
  result.status = 'BLOCKED_MISSING_GITHUB_ACTIONS_SECRETS'
  result.requiredSetup = [
    'LUCKREAD_APP_AUTH_SMOKE_EMAIL: an existing registered, email-verified QA account',
    'LUCKREAD_APP_AUTH_SMOKE_PASSWORD: that QA account password',
  ]
  check('test_credentials_configured', false, { reason: 'required GitHub Actions secrets are absent' })
  await finish()
} else {
  const jar = new CookieJar()
  let sessionToken = ''
  let userId = ''
  let sessionId = ''
  let staleCookieHeader = ''

  try {
    const login = await request('login_success', 'POST', '/api/v1/auth/login', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: email, credential: password }),
    })
    result.checks.push({ name: 'login_success', pass: false, ...login.facts })
    const loginCheck = result.checks[result.checks.length - 1]
    loginCheck.pass = login.facts.status === 200 &&
      login.json?.data?.user && typeof login.json.data.user.id === 'string' &&
      typeof login.json.data.user.email === 'string' &&
      login.json.data.user.email.trim().toLowerCase() === email.trim().toLowerCase() &&
      login.json.data.user.emailVerified === true &&
      login.response?.headers.get('cache-control') === 'no-store'
    console.log(`${loginCheck.pass ? 'PASS' : 'FAIL'} login_success HTTP ${login.facts.status}`)

    if (!loginCheck.pass) {
      loginCheck.errorCode = login.facts.errorCode
      result.status = 'FAIL'
      await finish()
    } else {
      // Credentials and account identity are read only from memory for assertions.
      userId = login.json.data.user.id
      sessionToken = login.response.headers.get('x-luckread-session-token') || ''
      jar.update(login.cookies)
      staleCookieHeader = jar.header()
      loginCheck.userIdComparedInMemory = true
      loginCheck.cookieNames = jar.names()
      loginCheck.nativeSessionHeaderPresent = Boolean(sessionToken)
      loginCheck.jsonContainsCredential = Boolean(sessionToken) && (
        JSON.stringify(login.json).includes(sessionToken) || hasCredentialField(login.json)
      )

      check('login_returns_native_session_header', Boolean(sessionToken), {
        headerName: 'X-LuckRead-Session-Token',
        status: login.facts.status,
      })
      check('login_json_does_not_contain_session_credential', Boolean(sessionToken) &&
        !JSON.stringify(login.json).includes(sessionToken) && !hasCredentialField(login.json), { status: login.facts.status })
      check('login_sets_browser_cookie', Boolean(staleCookieHeader) && login.cookies.some(x => /better-auth\.session_token=|__Secure-better-auth\.session_token=|__Host-better-auth\.session_token=/.test(x)), {
        setCookieCount: login.cookies.length,
        cookieNames: jar.names(),
      })

      const cookieSession = await request('session_read_by_cookie', 'GET', '/api/v1/auth/session', {
        headers: { cookie: staleCookieHeader },
      })
      jar.update(cookieSession.cookies)
      const cookieSessionPass = cookieSession.facts.status === 200 &&
        cookieSession.json?.data?.user?.id === userId &&
        typeof cookieSession.json?.data?.session?.id === 'string' &&
        typeof cookieSession.json?.data?.session?.expiresAt === 'string'
      if (cookieSessionPass) sessionId = cookieSession.json.data.session.id
      check('session_read_by_cookie', cookieSessionPass, {
        status: cookieSession.facts.status,
        cfRay: cookieSession.facts.cfRay,
        cacheControl: cookieSession.facts.cacheControl,
      })

      const cookieUpdatedToken = cookieSession.response?.headers.get('x-luckread-session-token')
      if (cookieUpdatedToken) sessionToken = cookieUpdatedToken

      const bearerSession = await request('session_read_by_bearer', 'GET', '/api/v1/auth/session', {
        headers: { authorization: `Bearer ${sessionToken}` },
      })
      const bearerSessionPass = bearerSession.facts.status === 200 &&
        bearerSession.json?.data?.user?.id === userId &&
        bearerSession.json?.data?.session?.id === sessionId
      const updatedToken = bearerSession.response?.headers.get('x-luckread-session-token')
      if (updatedToken) sessionToken = updatedToken
      check('session_read_by_bearer', bearerSessionPass, {
        status: bearerSession.facts.status,
        cfRay: bearerSession.facts.cfRay,
        cacheControl: bearerSession.facts.cacheControl,
        sameSessionComparedInMemory: bearerSessionPass,
      })

      const profileCookie = await request('protected_profile_by_cookie', 'GET', '/api/v1/users/me', {
        headers: { cookie: jar.header() || staleCookieHeader },
      })
      check('protected_profile_by_cookie', profileCookie.facts.status === 200 &&
        typeof profileCookie.json?.email === 'string' && profileCookie.json.email.trim().toLowerCase() === email.trim().toLowerCase(), {
        status: profileCookie.facts.status,
        cfRay: profileCookie.facts.cfRay,
      })

      const profileBearer = await request('protected_profile_by_bearer', 'GET', '/api/v1/users/me', {
        headers: { authorization: `Bearer ${sessionToken}` },
      })
      check('protected_profile_by_bearer', profileBearer.facts.status === 200 &&
        typeof profileBearer.json?.email === 'string' && profileBearer.json.email.trim().toLowerCase() === email.trim().toLowerCase(), {
        status: profileBearer.facts.status,
        cfRay: profileBearer.facts.cfRay,
      })

      const revocationCookieHeader = jar.header() || staleCookieHeader
      const revokedBearerToken = sessionToken
      const logout = await request('logout_revokes_current_session', 'POST', '/api/v1/auth/logout', {
        headers: { cookie: revocationCookieHeader },
      })
      jar.update(logout.cookies)
      check('logout_revokes_current_session', logout.facts.status === 204 && logout.raw.length === 0 &&
        !logout.response?.headers.get('x-luckread-session-token'), {
        status: logout.facts.status,
        cfRay: logout.facts.cfRay,
        bodyEmpty: logout.raw.length === 0,
        clearsCookie: logout.cookies.some(x => /better-auth\.session_token=|__Secure-better-auth\.session_token=|__Host-better-auth\.session_token=/.test(x) && /max-age=0|expires=/i.test(x)),
      })

      check('logout_clears_browser_cookie', logout.cookies.some(x => /better-auth\.session_token=|__Secure-better-auth\\.session_token=|__Host-better-auth\\.session_token=/.test(x) && /max-age=0|expires=/i.test(x)), {
        status: logout.facts.status,
        setCookieCount: logout.cookies.length,
      })

      const staleCookieSession = await request('revoked_cookie_session_denied', 'GET', '/api/v1/auth/session', {
        headers: { cookie: revocationCookieHeader },
      })
      check('revoked_cookie_session_denied', staleCookieSession.facts.status === 401, {
        status: staleCookieSession.facts.status,
        cfRay: staleCookieSession.facts.cfRay,
        errorCode: staleCookieSession.facts.errorCode,
      })

      const staleBearerSession = await request('revoked_bearer_session_denied', 'GET', '/api/v1/auth/session', {
        headers: { authorization: `Bearer ${revokedBearerToken}` },
      })
      check('revoked_bearer_session_denied', staleBearerSession.facts.status === 401, {
        status: staleBearerSession.facts.status,
        cfRay: staleBearerSession.facts.cfRay,
        errorCode: staleBearerSession.facts.errorCode,
      })

      const failed = result.checks.filter((entry) => !entry.pass)
      result.status = failed.length === 0 ? 'PASS' : 'FAIL'
      result.accountEmailMatchedAndPasswordVerified = true
      result.sessionIdComparedInMemory = true
      result.sessionTokenStored = false
      result.cookieValuesStored = false
      await finish()
    }
  } catch (error) {
    result.status = 'FAIL'
    result.failureClass = error instanceof Error ? error.name : typeof error
    await finish()
  }
}
