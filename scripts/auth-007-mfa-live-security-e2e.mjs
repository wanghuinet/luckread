import { createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = (process.env.LUCKREAD_API_BASE_URL || 'https://api.luckread.com').replace(/\/$/, '')
const browserOrigin = (process.env.LUCKREAD_BROWSER_ORIGIN || 'https://luckread.com').replace(/\/$/, '')
const email = process.env.LUCKREAD_AUTH007_MFA_E2E_EMAIL || ''
const password = process.env.LUCKREAD_AUTH007_MFA_E2E_PASSWORD || ''
const runId = process.env.GITHUB_RUN_ID || 'local'
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1'
const sourceSha = process.env.LUCKREAD_SOURCE_SHA || process.env.GITHUB_SHA || 'unknown'
const evidenceDir = resolve('artifacts/mapping-0/auth-007-mfa-live-security-e2e')
const evidencePath = resolve(evidenceDir, `auth-007-mfa-live-security-e2e-${runId}-${runAttempt}.json`)

const result = {
  evidenceType: 'AUTH-007_MFA_LIVE_SECURITY_E2E',
  timestamp: new Date().toISOString(),
  baseUrl,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceSha,
  credentialsLogged: false,
  responseBodiesStored: false,
  passwordsStored: false,
  totpSecretsStored: false,
  recoveryCodesStored: false,
  cookiesStored: false,
  sessionTokensStored: false,
  checks: [],
  status: 'PENDING',
  cleanupStatus: 'not_needed',
}

const safeCode = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null
const errorCode = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.code === 'string') return safeCode(value.code)
  if (value.error && typeof value.error === 'object' && typeof value.error.code === 'string') {
    return safeCode(value.error.code)
  }
  return null
}

const check = (name, pass, facts = {}) => {
  result.checks.push({ name, pass, ...facts })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${Number.isInteger(facts.status) ? ' HTTP ' + facts.status : ''}`)
  return pass
}

const cookieJar = new Map()
const cookieHeader = () => [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; ')
const cookieNames = () => [...cookieJar.keys()].sort()
const clearCookies = () => cookieJar.clear()
const updateCookies = (headers) => {
  const source = headers
  const list = typeof source.getSetCookie === 'function'
    ? source.getSetCookie()
    : [source.get('set-cookie')].filter(Boolean)
  for (const value of list) {
    const first = value.split(';', 1)[0]
    const separator = first.indexOf('=')
    if (separator <= 0) continue
    const name = first.slice(0, separator).trim()
    const content = first.slice(separator + 1).trim()
    if (!content || /(?:^|;)\s*max-age=0(?:;|$)/i.test(value) || /expires=Thu, 01 Jan 1970/i.test(value)) {
      cookieJar.delete(name)
    } else {
      cookieJar.set(name, content)
    }
  }
}

const request = async (name, method, path, { body, headers = {}, useCookies = true } = {}) => {
  const started = Date.now()
  try {
    const outgoingHeaders = new Headers({
      accept: 'application/json',
      ...(method.toUpperCase() === 'GET' ? {} : { origin: browserOrigin }),
      ...headers,
    })
    if (useCookies && cookieHeader()) outgoingHeaders.set('cookie', cookieHeader())
    const response = await fetch(baseUrl + path, {
      method,
      headers: outgoingHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (useCookies) updateCookies(response.headers)
    let payload = null
    let bodyIsEmpty = false
    try {
      const text = await response.text()
      bodyIsEmpty = text.length === 0
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }
    return {
      response,
      payload,
      facts: {
        name,
        method,
        path,
        status: response.status,
        durationMs: Date.now() - started,
        cfRay: response.headers.get('cf-ray'),
        cacheControl: response.headers.get('cache-control'),
        contentType: response.headers.get('content-type'),
        errorCode: errorCode(payload),
        cookieNames: cookieNames(),
        bodyIsEmpty,
      },
    }
  } catch (error) {
    return {
      response: null,
      payload: null,
      facts: { name, method, path, status: null, durationMs: Date.now() - started,
        transportError: error instanceof Error ? error.name : typeof error },
    }
  }
}

const decodeBase32 = (value) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const normalized = String(value || '').replace(/=+$/g, '').toUpperCase()
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new Error('INVALID_TOTP_SECRET_FORMAT')
  let bits = 0
  let accumulator = 0
  const bytes = []
  for (const character of normalized) {
    const digit = alphabet.indexOf(character)
    if (digit < 0) throw new Error('INVALID_TOTP_SECRET_FORMAT')
    accumulator = (accumulator << 5) | digit
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((accumulator >> bits) & 0xff)
    }
  }
  return Buffer.from(bytes)
}

const codeForStep = (secret, step, digits = 6, algorithm = 'sha1') => {
  const key = decodeBase32(secret)
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac(algorithm.toLowerCase(), key).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(binary % (10 ** digits)).padStart(digits, '0')
}

const parseTotpUri = (value) => {
  const uri = new URL(value)
  if (uri.protocol !== 'otpauth:' || uri.hostname.toLowerCase() !== 'totp') throw new Error('INVALID_TOTP_URI')
  const secret = uri.searchParams.get('secret') || ''
  const digits = Number(uri.searchParams.get('digits') || '6')
  const period = Number(uri.searchParams.get('period') || '30')
  const algorithm = (uri.searchParams.get('algorithm') || 'SHA1').toLowerCase()
  if (!Number.isInteger(digits) || digits !== 6 || !Number.isInteger(period) || period !== 30 ||
      !['sha1'].includes(algorithm)) throw new Error('UNSUPPORTED_TOTP_PARAMETERS')
  decodeBase32(secret)
  return { secret, digits, period, algorithm }
}

const currentStep = (period) => Math.floor(Date.now() / (period * 1000))
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

const totpStatus = (payload) => payload && typeof payload === 'object' &&
  payload.data && typeof payload.data === 'object' ? payload.data : null

const statusProjectionIsSafe = (data) => !!data &&
  Object.keys(data).sort().join(',') === 'enabled,enrolledAt,verified' &&
  typeof data.enabled === 'boolean' &&
  typeof data.verified === 'boolean' &&
  (data.enrolledAt === null || typeof data.enrolledAt === 'string')

const finish = async () => {
  const failed = result.checks.filter((entry) => !entry.pass)
  result.summary = {
    total: result.checks.length,
    passed: result.checks.length - failed.length,
    failed: failed.length,
  }
  const priorStatus = result.status\n  result.status = failed.length === 0 ? 'PASS' : (priorStatus !== 'PENDING' ? priorStatus : 'FAIL')
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 })
  await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  console.log(`Sanitized evidence written: ${evidencePath}`)
  console.log(`Summary: ${result.summary.passed}/${result.summary.total} checks passed; status=${result.status}; cleanup=${result.cleanupStatus}`)
  if (result.status !== 'PASS' || result.cleanupStatus === 'manual_review_required') process.exitCode = 1
}

const run = async () => {
  if (!/^[a-f0-9]{40}$/i.test(sourceSha)) {
    result.status = 'BLOCKED_INVALID_SOURCE_SHA'
    check('immutable_source_sha_configured', false)
    return
  }
  if (!email || !password) {
    result.status = 'BLOCKED_MISSING_DEDICATED_MFA_E2E_SECRETS'
    result.requiredSetup = [
      'LUCKREAD_AUTH007_MFA_E2E_EMAIL: a dedicated, active, email-verified QA account',
      'LUCKREAD_AUTH007_MFA_E2E_PASSWORD: that QA account password',
    ]
    check('dedicated_mfa_qa_credentials_configured', false)
    return
  }

  let totp = null
  let enrollmentStarted = false
  let factorEnabled = false
  let normalDisableSucceeded = false
  let confirmedStep = null
  let userId = ''
  const baseKey = `mfa-e2e-${runId}-${runAttempt}`

  try {
    const noChallenge = await request('unauthenticated_challenge_requires_cookie', 'POST',
      '/v1/auth/mfa/challenge/verify', {
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `${baseKey}-no-challenge`,
        },
        body: { code: '123456', method: 'totp' },
        useCookies: false,
      })
    check('unauthenticated_challenge_requires_signed_cookie', noChallenge.facts.status === 401 &&
      noChallenge.facts.errorCode === 'MFA_CHALLENGE_REQUIRED', noChallenge.facts)

    const login = await request('dedicated_qa_login', 'POST', '/v1/auth/login', {
      headers: { 'content-type': 'application/json' },
      body: { identity: email, credential: password },
    })
    const loginUser = login.payload?.data?.user
    const loginPass = login.facts.status === 200 && loginUser &&
      typeof loginUser.id === 'string' && typeof loginUser.email === 'string' &&
      loginUser.email.trim().toLowerCase() === email.trim().toLowerCase() &&
      loginUser.emailVerified === true &&
      login.response?.headers.get('cache-control') === 'no-store' &&
      login.response?.headers.has('x-luckread-session-token') &&
      cookieNames().some((name) => /session_token/i.test(name))
    check('dedicated_qa_login_establishes_verified_session', Boolean(loginPass), {
      status: login.facts.status,
      cacheControl: login.facts.cacheControl,
      nativeSessionHeaderPresent: Boolean(login.response?.headers.has('x-luckread-session-token')),
      cookieNames: cookieNames(),
    })
    if (!loginPass) {
      result.status = 'BLOCKED_QA_ACCOUNT_LOGIN_OR_VERIFICATION'
      return
    }
    userId = loginUser.id

    const initialStatus = await request('mfa_preflight_status', 'GET', '/v1/auth/mfa')
    const initialData = totpStatus(initialStatus.payload)
    const initialPass = initialStatus.facts.status === 200 &&
      initialStatus.facts.cacheControl === 'no-store' &&
      statusProjectionIsSafe(initialData) &&
      initialData.enabled === false && initialData.verified === false && initialData.enrolledAt === null
    check('qa_account_starts_with_mfa_disabled_and_safe_projection', initialPass, {
      status: initialStatus.facts.status,
      cacheControl: initialStatus.facts.cacheControl,
      projectionSafe: statusProjectionIsSafe(initialData),
      alreadyEnabled: initialData?.enabled === true,
    })
    if (!initialPass) {
      result.status = initialStatus.facts.status === 200 ? 'BLOCKED_QA_ACCOUNT_NOT_CLEAN' : 'BLOCKED_MFA_STATUS_ENDPOINT'
      return
    }

    const enroll = await request('mfa_enrollment_start', 'POST', '/v1/auth/mfa/enrollment', {
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': `${baseKey}-enroll`,
      },
      body: { currentPassword: password },
    })
    const enrollData = enroll.payload?.data
    const validEnrollmentData = enroll.facts.status === 200 &&
      enroll.facts.cacheControl === 'no-store' &&
      enrollData && typeof enrollData.totpUri === 'string' &&
      Array.isArray(enrollData.recoveryCodes) && enrollData.recoveryCodes.length >= 1 &&
      enrollData.recoveryCodes.length <= 32 &&
      enrollData.recoveryCodes.every((value) => typeof value === 'string' && value.length >= 1 && value.length <= 128)
    check('mfa_enrollment_returns_one_time_material_no_store', Boolean(validEnrollmentData), {
      status: enroll.facts.status,
      cacheControl: enroll.facts.cacheControl,
      oneTimeRecoveryCodeCount: Array.isArray(enrollData?.recoveryCodes) ? enrollData.recoveryCodes.length : 0,
      oneTimeTotpUriPresent: typeof enrollData?.totpUri === 'string',
      materialLogged: false,
    })
    if (!validEnrollmentData) {
      result.status = 'MFA_ENROLLMENT_START_FAILED'
      return
    }
    enrollmentStarted = true
    totp = parseTotpUri(enrollData.totpUri)

    let confirmation = null
    let confirmationResponse = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const step = currentStep(totp.period)
      const code = codeForStep(totp.secret, step, totp.digits, totp.algorithm)
      confirmation = await request('mfa_enrollment_confirmation', 'POST', '/v1/auth/mfa/enrollment/confirm', {
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `${baseKey}-confirm-${attempt}`,
        },
        body: { code },
      })
      confirmationResponse = confirmation
      if (confirmation.facts.status === 200 && totpStatus(confirmation.payload)?.enabled === true &&
          totpStatus(confirmation.payload)?.verified === true) {
        confirmedStep = step
        factorEnabled = true
        break
      }
      if (confirmation.facts.status !== 401) break
      await sleep(1_000)
    }
    check('mfa_enrollment_confirm_requires_valid_totp_and_reads_back_enabled_factor',
      Boolean(confirmationResponse && confirmationResponse.facts.status === 200 && factorEnabled), {
        status: confirmationResponse?.facts.status ?? null,
        cacheControl: confirmationResponse?.facts.cacheControl ?? null,
        factorStateConfirmed: factorEnabled,
      })
    if (!factorEnabled || !totp || confirmedStep === null) {
      result.status = 'MFA_ENROLLMENT_CONFIRM_FAILED'
      if (enrollmentStarted) result.cleanupStatus = 'manual_review_required'
      return
    }

    const verifiedStatus = await request('mfa_enabled_status_readback', 'GET', '/v1/auth/mfa')
    const verifiedData = totpStatus(verifiedStatus.payload)
    check('mfa_enabled_status_readback_is_authoritative_and_redacted',
      verifiedStatus.facts.status === 200 &&
      verifiedStatus.facts.cacheControl === 'no-store' &&
      statusProjectionIsSafe(verifiedData) &&
      verifiedData.enabled === true && verifiedData.verified === true &&
      typeof verifiedData.enrolledAt === 'string' && Number.isFinite(Date.parse(verifiedData.enrolledAt)), {
        status: verifiedStatus.facts.status,
        cacheControl: verifiedStatus.facts.cacheControl,
        projectionSafe: statusProjectionIsSafe(verifiedData),
      })

    const validCodes = new Set()
    const nowStep = currentStep(totp.period)
    for (let step = Math.max(0, nowStep - 2); step <= nowStep + 2; step += 1) {
      validCodes.add(codeForStep(totp.secret, step, totp.digits, totp.algorithm))
    }
    const baseCode = Number(codeForStep(totp.secret, currentStep(totp.period), totp.digits, totp.algorithm))
    let invalidCode = ''
    for (let delta = 1; delta < 100; delta += 1) {
      const candidate = String((baseCode + delta) % 1_000_000).padStart(6, '0')
      if (!validCodes.has(candidate)) { invalidCode = candidate; break }
    }
    check('negative_test_has_nonmatching_code', invalidCode.length === 6, {
      codeValueLogged: false,
      candidateMatchesCurrentTOTPWindow: validCodes.has(invalidCode),
    })
    if (invalidCode) {
      const invalidAttempt = await request('mfa_disable_rejects_invalid_totp', 'POST', '/v1/auth/mfa/disable', {
        headers: { 'content-type': 'application/json' },
        body: { currentPassword: password, code: invalidCode },
      })
      check('mfa_disable_rejects_invalid_totp_without_mutation', invalidAttempt.facts.status === 401, {
        status: invalidAttempt.facts.status,
        errorCode: invalidAttempt.facts.errorCode,
      })
    }

    if (factorEnabled && totp && confirmedStep !== null) {
      const replayCode = codeForStep(totp.secret, confirmedStep, totp.digits, totp.algorithm)
      const replayAttempt = await request('mfa_disable_rejects_reused_totp_step', 'POST', '/v1/auth/mfa/disable', {
        headers: { 'content-type': 'application/json' },
        body: { currentPassword: password, code: replayCode },
      })
      check('mfa_disable_rejects_replayed_totp_step', replayAttempt.facts.status === 401, {
        status: replayAttempt.facts.status,
        errorCode: replayAttempt.facts.errorCode,
        replayCodeLogged: false,
      })
      const afterRejections = await request('mfa_remains_enabled_after_negative_tests', 'GET', '/v1/auth/mfa')
      const afterRejectionData = totpStatus(afterRejections.payload)
      check('negative_mfa_attempts_do_not_disable_factor',
        afterRejections.facts.status === 200 && afterRejectionData?.enabled === true &&
        afterRejectionData?.verified === true, {
          status: afterRejections.facts.status,
          factorStillEnabled: afterRejectionData?.enabled === true && afterRejectionData?.verified === true,
        })
    }

    const oldCookie = cookieHeader()
    let disable = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const step = currentStep(totp.period)
      if (step <= confirmedStep) {
        const remainingMs = (confirmedStep + 1) * totp.period * 1000 - Date.now()
        await sleep(Math.max(250, Math.min(remainingMs + 250, 31_000)))
        continue
      }
      const code = codeForStep(totp.secret, step, totp.digits, totp.algorithm)
      disable = await request('mfa_disable_with_fresh_totp', 'POST', '/v1/auth/mfa/disable', {
        headers: { 'content-type': 'application/json' },
        body: { currentPassword: password, code },
      })
      if (disable.facts.status === 204) {
        normalDisableSucceeded = true
        factorEnabled = false
        break
      }
      if (disable.facts.status !== 401) break
      await sleep(1_000)
    }
    check('mfa_disable_requires_password_and_fresh_totp', normalDisableSucceeded, {
      status: disable?.facts.status ?? null,
      factorDisableSucceeded: normalDisableSucceeded,
      cacheControl: disable?.facts.cacheControl ?? null,
    })
    if (!normalDisableSucceeded) {
      result.cleanupStatus = factorEnabled ? 'manual_review_required' : 'not_needed'
      return
    }

    const staleSession = await request('old_session_rejected_after_mfa_disable', 'GET', '/v1/auth/session', {
      headers: { cookie: oldCookie },
      useCookies: false,
    })
    check('mfa_disable_revokes_existing_session', staleSession.facts.status === 401, {
      status: staleSession.facts.status,
      errorCode: staleSession.facts.errorCode,
    })

    clearCookies()
    const relogin = await request('login_after_mfa_disable', 'POST', '/v1/auth/login', {
      headers: { 'content-type': 'application/json' },
      body: { identity: email, credential: password },
    })
    const reloginUser = relogin.payload?.data?.user
    const reloginPass = relogin.facts.status === 200 && reloginUser &&
      reloginUser.id === userId && reloginUser.emailVerified === true &&
      relogin.response?.headers.get('cache-control') === 'no-store'
    check('login_succeeds_after_factor_disabled', Boolean(reloginPass), {
      status: relogin.facts.status,
      cacheControl: relogin.facts.cacheControl,
      sameUserComparedInMemory: Boolean(reloginPass),
    })
    if (reloginPass) {
      const finalStatus = await request('mfa_disabled_final_readback', 'GET', '/v1/auth/mfa')
      const finalData = totpStatus(finalStatus.payload)
      check('mfa_disable_final_readback_clears_factor_state',
        finalStatus.facts.status === 200 && finalStatus.facts.cacheControl === 'no-store' &&
        statusProjectionIsSafe(finalData) && finalData.enabled === false &&
        finalData.verified === false && finalData.enrolledAt === null, {
          status: finalStatus.facts.status,
          cacheControl: finalStatus.facts.cacheControl,
          factorDisabled: finalData?.enabled === false && finalData?.verified === false && finalData?.enrolledAt === null,
          projectionSafe: statusProjectionIsSafe(finalData),
        })
    }
  } catch (error) {
    result.status = 'FAIL'
    result.failureCategory = error instanceof Error ? safeCode(error.message) || error.name : typeof error
    check('unexpected_test_error', false, { category: result.failureCategory })
  } finally {
    // If the test failed after enabling MFA, attempt a bounded cleanup with a fresh
    // time step. A cleanup failure is surfaced as a manual-review blocker, never hidden.
    if (factorEnabled && !normalDisableSucceeded && totp && confirmedStep !== null) {
      result.cleanupStatus = 'cleanup_attempted'
      let cleanupSucceeded = false
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const step = currentStep(totp.period)
        if (step <= confirmedStep) {
          const remainingMs = (confirmedStep + 1) * totp.period * 1000 - Date.now()
          await sleep(Math.max(250, Math.min(remainingMs + 250, 31_000)))
          continue
        }
        const code = codeForStep(totp.secret, step, totp.digits, totp.algorithm)
        const cleanup = await request('mfa_test_cleanup_disable', 'POST', '/v1/auth/mfa/disable', {
          headers: { 'content-type': 'application/json' },
          body: { currentPassword: password, code },
        })
        if (cleanup.facts.status === 204) {
          cleanupSucceeded = true
          factorEnabled = false
          break
        }
        if (cleanup.facts.status !== 401) break
        await sleep(1_000)
      }
      result.cleanupStatus = cleanupSucceeded ? 'completed' : 'manual_review_required'
      check('mfa_cleanup_after_test_failure', cleanupSucceeded, {
        factorDisableSucceeded: cleanupSucceeded,
      })
    } else if (enrollmentStarted && !factorEnabled && !normalDisableSucceeded) {
      result.cleanupStatus = 'manual_review_required'
    }
  }
}

await run().catch((error) => {
  result.status = 'FAIL'
  result.failureCategory = error instanceof Error ? safeCode(error.message) || error.name : typeof error
  check('unexpected_test_error', false, { category: result.failureCategory })
}).finally(finish)
