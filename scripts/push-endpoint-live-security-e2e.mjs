import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const configuredBaseUrl = process.env.LUCKREAD_API_BASE_URL || 'https://api.luckread.com'
const origin = (process.env.LUCKREAD_BROWSER_ORIGIN || 'https://luckread.com').replace(/\/$/, '')
const runId = process.env.GITHUB_RUN_ID || 'local'
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1'
const sourceSha = process.env.GITHUB_SHA || 'unknown'
const evidenceDir = resolve('artifacts/push-endpoint-live-security-e2e')
const evidencePath = resolve(evidenceDir, 'push-endpoint-live-security-e2e-' + runId + '-' + runAttempt + '.json')
const users = [
  { label: 'primary', email: process.env.LUCKREAD_APP_AUTH_SMOKE_EMAIL || '', password: process.env.LUCKREAD_APP_AUTH_SMOKE_PASSWORD || '' },
  { label: 'foreign', email: process.env.LUCKREAD_CREATOR_E2E_APPLICANT_EMAIL || '', password: process.env.LUCKREAD_CREATOR_E2E_APPLICANT_PASSWORD || '' },
]
const result = {
  evidenceType: 'LUCKREAD_PUSH_ENDPOINT_LIVE_SECURITY_E2E',
  timestamp: new Date().toISOString(),
  baseUrl: null,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceSha,
  credentialValuesLogged: false,
  cookieValuesStored: false,
  sessionTokensStored: false,
  pushTokensStored: false,
  responseBodiesStored: false,
  notificationDeliveryTriggered: false,
  checks: [],
  status: 'PENDING',
}

function validateBaseUrl(value) {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' ||
      !(host === 'luckread.com' || host.endsWith('.luckread.com')) ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('LUCKREAD_API_BASE_URL must be an HTTPS LuckRead origin without credentials, path, query, or fragment')
  }
  return url.origin
}

const baseUrl = validateBaseUrl(configuredBaseUrl)
result.baseUrl = baseUrl
const randomKey = (label) => 'push-e2e-' + label + '-' + randomUUID().replaceAll('-', '')
const newInstallationId = () => randomUUID()
const newExpoToken = () => 'ExponentPushToken[' + randomUUID().replaceAll('-', '') + ']'

function check(name, pass, facts = {}) {
  result.checks.push({ name, pass, ...facts })
  console.log((pass ? 'PASS ' : 'FAIL ') + name)
}

function errorCode(json) {
  const value = json && typeof json === 'object' ? json.error && json.error.code : null
  return typeof value === 'string' && /^[A-Z0-9_-]{1,80}$/.test(value) ? value : null
}

class CookieJar {
  #values = new Map()
  update(headers) {
    for (const header of headers) {
      const pair = header.split(';', 1)[0]
      const index = pair.indexOf('=')
      if (index <= 0) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (!value || /max-age=0|expires=Thu, 01 Jan 1970/i.test(header)) this.#values.delete(name)
      else this.#values.set(name, value)
    }
  }
  header() {
    return Array.from(this.#values, ([name, value]) => name + '=' + value).join('; ')
  }
  names() {
    return Array.from(this.#values.keys()).sort()
  }
  hasSession() {
    return this.names().some((name) => /better-auth\.session_token/i.test(name))
  }
}

async function request(method, path, options = {}) {
  const cookie = options.jar ? options.jar.header() : ''
  const headers = {
    accept: 'application/json',
    ...(method === 'GET' ? {} : { origin }),
    ...(cookie ? { cookie } : {}),
    ...(options.headers || {}),
  }
  try {
    const response = await fetch(baseUrl + path, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: options.body }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean)
    if (options.jar) options.jar.update(setCookies)
    const raw = await response.text()
    let json = null
    try { json = raw ? JSON.parse(raw) : null } catch {}
    return {
      status: response.status,
      json,
      errorCode: errorCode(json),
      tokenLeaked: Boolean(options.sensitiveToken && raw.includes(options.sensitiveToken)),
      cacheControl: response.headers.get('cache-control'),
      setCookies,
    }
  } catch (error) {
    return {
      status: null, json: null, errorCode: null, tokenLeaked: false,
      cacheControl: null, setCookies: [],
      transportError: error instanceof Error ? error.name : typeof error,
    }
  }
}

async function login(user) {
  const jar = new CookieJar()
  const response = await request('POST', '/v1/auth/login', {
    jar,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: user.email, credential: user.password }),
  })
  const account = response.json && response.json.data ? response.json.data.user : null
  const pass = response.status === 200 &&
    typeof account?.id === 'string' &&
    typeof account.email === 'string' &&
    account.email.trim().toLowerCase() === user.email.trim().toLowerCase() &&
    account.emailVerified === true &&
    jar.hasSession()
  check(user.label + '_login_verified_session', pass, {
    status: response.status, emailVerified: account?.emailVerified === true,
    sessionCookiePresent: jar.hasSession(), cookieNames: jar.names(), errorCode: response.errorCode,
  })
  return pass ? { label: user.label, jar, userId: account.id } : null
}

const endpointPath = (installationId) => '/v1/push/endpoints/' + encodeURIComponent(installationId)

async function register(user, installationId, token, key, permissionStatus = 'granted', extraBody = {}) {
  const response = await request('PUT', endpointPath(installationId), {
    jar: user.jar,
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({
      platform: 'android',
      permissionStatus,
      expoPushToken: permissionStatus === 'granted' ? token : null,
      appVersion: '1.0.0-security-e2e',
      ...extraBody,
    }),
    sensitiveToken: token,
  })
  return {
    status: response.status, errorCode: response.errorCode,
    endpointId: response.json?.data?.endpointId || null,
    endpointStatus: response.json?.data?.status || null,
    tokenLeaked: response.tokenLeaked,
    cacheNoStore: typeof response.cacheControl === 'string' &&
      response.cacheControl.toLowerCase().includes('no-store'),
  }
}

async function remove(user, installationId, key) {
  const response = await request('DELETE', endpointPath(installationId), {
    jar: user.jar, headers: { 'Idempotency-Key': key },
  })
  return {
    status: response.status, errorCode: response.errorCode,
    cacheNoStore: typeof response.cacheControl === 'string' &&
      response.cacheControl.toLowerCase().includes('no-store'),
  }
}

async function finish() {
  const failed = result.checks.filter((item) => !item.pass)
  result.summary = { total: result.checks.length, passed: result.checks.length - failed.length, failed: failed.length }
  if (result.status === 'PENDING') result.status = failed.length === 0 ? 'PASS' : 'FAIL'
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  console.log('Sanitized push endpoint security evidence: ' + evidencePath)
  console.log('Summary: ' + result.summary.passed + '/' + result.summary.total + '; ' + result.status)
  if (result.status !== 'PASS') process.exitCode = 1
}

let primary = null
let foreign = null
const primaryOwnedInstallations = new Set()

try {
  const missing = [
    !users[0].email ? 'LUCKREAD_APP_AUTH_SMOKE_EMAIL' : null,
    !users[0].password ? 'LUCKREAD_APP_AUTH_SMOKE_PASSWORD' : null,
    !users[1].email ? 'LUCKREAD_CREATOR_E2E_APPLICANT_EMAIL' : null,
    !users[1].password ? 'LUCKREAD_CREATOR_E2E_APPLICANT_PASSWORD' : null,
  ].filter(Boolean)

  if (missing.length) {
    result.status = 'BLOCKED_MISSING_GITHUB_ACTIONS_SECRETS'
    check('two_verified_qa_accounts_configured', false, { missingSecretNames: missing })
  } else if (users[0].email.trim().toLowerCase() === users[1].email.trim().toLowerCase()) {
    result.status = 'BLOCKED_QA_ACCOUNTS_NOT_DISTINCT'
    check('two_distinct_qa_accounts', false)
  } else {
    check('two_distinct_qa_accounts', true)
    ;[primary, foreign] = await Promise.all(users.map(login))
    if (!primary || !foreign) {
      result.status = 'BLOCKED_QA_LOGIN_OR_VERIFICATION'
    } else if (primary.userId === foreign.userId) {
      result.status = 'BLOCKED_QA_ACCOUNTS_RESOLVE_TO_SAME_USER'
      check('two_distinct_authenticated_user_ids', false)
    } else {
      check('two_distinct_authenticated_user_ids', true)

      const sharedInstallation = newInstallationId()
      const primaryToken = newExpoToken()
      const foreignToken = newExpoToken()
      primaryOwnedInstallations.add(sharedInstallation)

      const first = await register(primary, sharedInstallation, primaryToken, randomKey('owner-register'))
      check('primary_can_register_own_endpoint_without_returning_token',
        first.status === 200 && typeof first.endpointId === 'string' &&
        first.endpointStatus === 'ACTIVE' && !first.tokenLeaked && first.cacheNoStore, {
          status: first.status, endpointActive: first.endpointStatus === 'ACTIVE',
          tokenReturned: first.tokenLeaked, cacheNoStore: first.cacheNoStore, errorCode: first.errorCode,
        })

      if (first.endpointId) {
        const foreignClaim = await register(foreign, sharedInstallation, foreignToken, randomKey('foreign-claim'))
        check('foreign_account_cannot_claim_existing_installation',
          foreignClaim.status === 409 && !foreignClaim.tokenLeaked, {
            status: foreignClaim.status, errorCode: foreignClaim.errorCode, tokenReturned: foreignClaim.tokenLeaked,
          })

        const afterForeignClaim = await register(primary, sharedInstallation, primaryToken, randomKey('owner-after-claim'))
        check('foreign_claim_attempt_preserves_original_owner_endpoint',
          afterForeignClaim.status === 200 && afterForeignClaim.endpointId === first.endpointId &&
          !afterForeignClaim.tokenLeaked, {
            status: afterForeignClaim.status,
            sameEndpointIdentity: afterForeignClaim.endpointId === first.endpointId,
            tokenReturned: afterForeignClaim.tokenLeaked,
          })

        const foreignDelete = await remove(foreign, sharedInstallation, randomKey('foreign-delete'))
        check('foreign_account_delete_is_non_disclosing_and_cannot_remove_owner_endpoint',
          foreignDelete.status === 204 && foreignDelete.cacheNoStore, {
            status: foreignDelete.status, cacheNoStore: foreignDelete.cacheNoStore,
          })

        const afterForeignDelete = await register(primary, sharedInstallation, primaryToken, randomKey('owner-after-foreign-delete'))
        check('foreign_delete_attempt_preserves_original_endpoint_identity',
          afterForeignDelete.status === 200 && afterForeignDelete.endpointId === first.endpointId &&
          !afterForeignDelete.tokenLeaked, {
            status: afterForeignDelete.status,
            sameEndpointIdentity: afterForeignDelete.endpointId === first.endpointId,
            tokenReturned: afterForeignDelete.tokenLeaked,
          })

        const ownerDelete = await remove(primary, sharedInstallation, randomKey('owner-delete'))
        check('owner_can_delete_own_endpoint', ownerDelete.status === 204 && ownerDelete.cacheNoStore, {
          status: ownerDelete.status, cacheNoStore: ownerDelete.cacheNoStore,
        })

        const afterOwnerDelete = await register(primary, sharedInstallation, primaryToken, randomKey('owner-recreate'))
        check('owner_delete_removes_endpoint_before_recreation',
          afterOwnerDelete.status === 200 && typeof afterOwnerDelete.endpointId === 'string' &&
          afterOwnerDelete.endpointId !== first.endpointId && !afterOwnerDelete.tokenLeaked, {
            status: afterOwnerDelete.status,
            endpointIdentityRecreated: Boolean(afterOwnerDelete.endpointId && afterOwnerDelete.endpointId !== first.endpointId),
            tokenReturned: afterOwnerDelete.tokenLeaked,
          })
      }

      const permissionInstallation = newInstallationId()
      const permissionToken = newExpoToken()
      primaryOwnedInstallations.add(permissionInstallation)
      const enabled = await register(primary, permissionInstallation, permissionToken, randomKey('permission-enable'))
      const denied = await register(primary, permissionInstallation, permissionToken, randomKey('permission-deny'), 'denied')
      check('denied_permission_disables_endpoint_and_clears_token',
        enabled.status === 200 && enabled.endpointStatus === 'ACTIVE' &&
        denied.status === 200 && denied.endpointStatus === 'DISABLED' && !denied.tokenLeaked, {
          enableStatus: enabled.status, deniedStatus: denied.status,
          endpointDisabled: denied.endpointStatus === 'DISABLED', tokenReturned: denied.tokenLeaked,
        })

      const anonymousInstallation = newInstallationId()
      const anonymousToken = newExpoToken()
      const anonymousPut = await request('PUT', endpointPath(anonymousInstallation), {
        headers: { 'content-type': 'application/json', 'Idempotency-Key': randomKey('anonymous-put') },
        body: JSON.stringify({
          platform: 'android', permissionStatus: 'granted',
          expoPushToken: anonymousToken, appVersion: '1.0.0-security-e2e',
        }),
        sensitiveToken: anonymousToken,
      })
      check('anonymous_registration_is_denied_before_endpoint_mutation',
        (anonymousPut.status === 401 || anonymousPut.status === 403) && !anonymousPut.tokenLeaked, {
          status: anonymousPut.status, errorCode: anonymousPut.errorCode, tokenReturned: anonymousPut.tokenLeaked,
        })

      const anonymousDelete = await request('DELETE', endpointPath(sharedInstallation), {
        headers: { 'Idempotency-Key': randomKey('anonymous-delete') },
      })
      check('anonymous_deletion_is_denied', anonymousDelete.status === 401 || anonymousDelete.status === 403, {
        status: anonymousDelete.status, errorCode: anonymousDelete.errorCode,
      })

      const missingIdempotency = await request('DELETE', endpointPath(newInstallationId()), {
        jar: primary.jar,
      })
      check('authenticated_delete_requires_idempotency_key',
        missingIdempotency.status === 428 && missingIdempotency.errorCode === 'PRECONDITION_REQUIRED', {
          status: missingIdempotency.status, errorCode: missingIdempotency.errorCode,
        })

      const forgedInstallation = newInstallationId()
      const forgedToken = newExpoToken()
      primaryOwnedInstallations.add(forgedInstallation)
      const forgedOwner = await register(primary, forgedInstallation, forgedToken,
        randomKey('forged-owner'), 'granted', { ownerUserId: foreign.userId })
      check('client_supplied_owner_identity_is_rejected',
        forgedOwner.status === 422 && forgedOwner.errorCode === 'VALIDATION_FAILED' &&
        !forgedOwner.tokenLeaked, {
          status: forgedOwner.status, errorCode: forgedOwner.errorCode, tokenReturned: forgedOwner.tokenLeaked,
        })
    }
  }
} catch (error) {
  result.status = 'FAIL_UNEXPECTED_E2E_ERROR'
  check('unexpected_e2e_error', false, { errorType: error instanceof Error ? error.name : typeof error })
} finally {
  if (primary) {
    for (const installationId of primaryOwnedInstallations) {
      const cleanup = await remove(primary, installationId, randomKey('cleanup'))
      check('cleanup_primary_test_endpoint', cleanup.status === 204, {
        status: cleanup.status, errorCode: cleanup.errorCode,
      })
    }
    const logout = await request('POST', '/v1/auth/logout', { jar: primary.jar })
    check('primary_logout_cleanup', logout.status === 204, { status: logout.status })
  }
  if (foreign) {
    const logout = await request('POST', '/v1/auth/logout', { jar: foreign.jar })
    check('foreign_logout_cleanup', logout.status === 204, { status: logout.status })
  }
  await finish()
}
