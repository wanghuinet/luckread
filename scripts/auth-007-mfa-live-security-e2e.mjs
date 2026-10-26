import { codeForStep, currentStep, parseTotpUri } from './auth-007-totp.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = (process.env.LUCKREAD_API_BASE_URL || 'https://api.luckread.com').replace(/\/$/, '')
const browserOrigin = (process.env.LUCKREAD_BROWSER_ORIGIN || 'https://luckread.com').replace(/\/$/, '')
const email = process.env.LUCKREAD_AUTH007_MFA_E2E_EMAIL || ''
const password = process.env.LUCKREAD_AUTH007_MFA_E2E_PASSWORD || ''
const runId = process.env.GITHUB_RUN_ID || 'local'
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1'
const sourceSha = process.env.LUCKREAD_SOURCE_SHA || process.env.GITHUB_SHA || 'unknown'
const auditCorrelationId = `req_auth007mfa_${runId}_${runAttempt}`
const auditRequestId = `req_auth007mfareq_${runId}_${runAttempt}`
const evidenceDir = resolve('artifacts/mapping-0/auth-007-mfa-live-security-e2e')
const evidencePath = resolve(evidenceDir, `auth-007-mfa-live-security-e2e-${runId}-${runAttempt}.json`)

const result = {
  evidenceType: 'AUTH-007_MFA_LIVE_SECURITY_E2E',
  timestamp: new Date().toISOString(),
  baseUrl,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceSha,
  auditCorrelationId,
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
const restoreCookieHeader = (value) => {
  cookieJar.clear()
  for (const part of String(value || '').split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    const content = part.slice(separator + 1).trim()
    if (name && content) cookieJar.set(name, content)
  }
}
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
      'x-luckread-correlation-id': auditCorrelationId,
      'x-luckread-request-id': auditRequestId,
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

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

const hasCredentialField = (value) => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(hasCredentialField)
  return Object.entries(value).some(([key, nested]) =>
    /^(?:token|accessToken|refreshToken|sessionToken)$/i.test(key) || hasCredentialField(nested))
}

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
  const priorStatus = result.status
  result.status = failed.length === 0 ? 'PASS' : (priorStatus !== 'PENDING' ? priorStatus : 'FAIL')
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
  let latestAcceptedTotpStep = null
  let userId = ''
  let recoveryCodes = []
  let lastAuthenticatedCookie = ''
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
    lastAuthenticatedCookie = cookieHeader()

    // A live session must never substitute for the signed, unauthenticated
    // two_factor challenge cookie. The endpoint must reject before W02 even
    // though this account has an authenticated session cookie.
    const sessionCannotReplaceChallenge = await request(
      'authenticated_session_cannot_replace_mfa_challenge',
      'POST',
      '/v1/auth/mfa/challenge/verify',
      {
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `${baseKey}-session-not-challenge`,
        },
        body: { code: '123456', method: 'totp' },
      },
    )
    check('authenticated_session_is_not_accepted_as_signin_challenge',
      sessionCannotReplaceChallenge.facts.status === 401 &&
      sessionCannotReplaceChallenge.facts.errorCode === 'MFA_CHALLENGE_REQUIRED' &&
      !sessionCannotReplaceChallenge.response?.headers.has('x-luckread-session-token'), {
        status: sessionCannotReplaceChallenge.facts.status,
        errorCode: sessionCannotReplaceChallenge.facts.errorCode,
        tokenIssued: Boolean(sessionCannotReplaceChallenge.response?.headers.has('x-luckread-session-token')),
      })

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

    // Emit and verify the enrollment-failure path with a deliberately
    // non-matching password, then prove no factor or one-time material leaked
    // and the account remains eligible for a clean enrollment attempt.
    let wrongPassword = 'AUTH007-invalid-password-' + password.slice(-12)
    if (wrongPassword === password) wrongPassword = 'Definitely-not-the-current-password-007!'
    const rejectedEnrollment = await request(
      'mfa_enrollment_rejects_wrong_current_password',
      'POST',
      '/v1/auth/mfa/enrollment',
      {
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `${baseKey}-enroll-wrong-password`,
        },
        body: { currentPassword: wrongPassword },
      },
    )
    check('mfa_enrollment_rejects_wrong_current_password_without_disclosing_one_time_material',
      rejectedEnrollment.facts.status === 401 &&
      !rejectedEnrollment.payload?.data?.totpUri &&
      !Array.isArray(rejectedEnrollment.payload?.data?.recoveryCodes), {
        status: rejectedEnrollment.facts.status,
        errorCode: rejectedEnrollment.facts.errorCode,
        oneTimeMaterialReturned: Boolean(rejectedEnrollment.payload?.data?.totpUri) ||
          Array.isArray(rejectedEnrollment.payload?.data?.recoveryCodes),
        passwordLogged: false,
      })

    const afterRejectedEnrollment = await request('mfa_disabled_after_failed_enrollment', 'GET', '/v1/auth/mfa')
    const afterRejectedEnrollmentData = totpStatus(afterRejectedEnrollment.payload)
    check('failed_enrollment_keeps_factor_disabled',
      afterRejectedEnrollment.facts.status === 200 &&
      afterRejectedEnrollmentData?.enabled === false &&
      afterRejectedEnrollmentData?.verified === false &&
      afterRejectedEnrollmentData?.enrolledAt === null, {
        status: afterRejectedEnrollment.facts.status,
        factorStillDisabled: afterRejectedEnrollmentData?.enabled === false &&
          afterRejectedEnrollmentData?.verified === false &&
          afterRejectedEnrollmentData?.enrolledAt === null,
      })

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
    recoveryCodes = [...enrollData.recoveryCodes]
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
        latestAcceptedTotpStep = step
        factorEnabled = true
        lastAuthenticatedCookie = cookieHeader()
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

    const afterRejections = await request('mfa_remains_enabled_after_invalid_code', 'GET', '/v1/auth/mfa')
    const afterRejectionData = totpStatus(afterRejections.payload)
    check('invalid_mfa_attempt_does_not_disable_factor',
      afterRejections.facts.status === 200 && afterRejectionData?.enabled === true &&
      afterRejectionData?.verified === true, {
        status: afterRejections.facts.status,
        factorStillEnabled: afterRejectionData?.enabled === true && afterRejectionData?.verified === true,
      })

    if (factorEnabled && totp && confirmedStep !== null) {
      // A distinct fresh time step is required because enrollment confirmation
      // has already atomically consumed its own TOTP step.
      while (currentStep(totp.period) <= (latestAcceptedTotpStep ?? confirmedStep)) {
        const step = latestAcceptedTotpStep ?? confirmedStep
        const remainingMs = (step + 1) * totp.period * 1000 - Date.now()
        await sleep(Math.max(250, Math.min(remainingMs + 250, 31_000)))
      }

      clearCookies()
      const challengeLogin = await request('login_requires_mfa_challenge', 'POST', '/v1/auth/login', {
        headers: { 'content-type': 'application/json' },
        body: { identity: email, credential: password },
      })
      const challengeMethods = challengeLogin.payload?.data?.methods
      const challengeLoginPass = challengeLogin.facts.status === 202 &&
        challengeLogin.payload?.data?.challengeRequired === true &&
        Array.isArray(challengeMethods) && challengeMethods.includes('totp') &&
        challengeMethods.includes('recovery_code') &&
        !challengeLogin.response?.headers.has('x-luckread-session-token') &&
        cookieNames().some((name) => /two_factor/i.test(name)) &&
        !cookieNames().some((name) => /session_token/i.test(name))
      check('password_login_requires_totp_challenge_without_session', Boolean(challengeLoginPass), {
        status: challengeLogin.facts.status,
        challengeCookiePresent: cookieNames().some((name) => /two_factor/i.test(name)),
        sessionCredentialIssued: Boolean(challengeLogin.response?.headers.has('x-luckread-session-token')),
      })
      if (!challengeLoginPass) {
        result.status = 'MFA_SIGN_IN_CHALLENGE_FAILED'
        restoreCookieHeader(lastAuthenticatedCookie)
        return
      }
      const totpChallengeCookie = cookieHeader()
      const challengeStep = currentStep(totp.period)
      const challengeCode = codeForStep(totp.secret, challengeStep, totp.digits, totp.algorithm)

      // Subject/actor/target IDs are never accepted from a challenge client.
      // This malformed cross-account attempt must be rejected by W01 before
      // the legitimate challenge is consumed or forwarded to W02.
      const suppliedSubjectAttempt = await request(
        'challenge_rejects_caller_supplied_account_subject',
        'POST',
        '/v1/auth/mfa/challenge/verify',
        {
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': `${baseKey}-client-subject-injection`,
          },
          body: { code: challengeCode, method: 'totp', userId: 'another-user-not-selected-by-client' },
        },
      )
      check('challenge_rejects_caller_supplied_account_subject',
        suppliedSubjectAttempt.facts.status === 422 &&
        suppliedSubjectAttempt.facts.errorCode === 'VALIDATION_FAILED' &&
        !suppliedSubjectAttempt.response?.headers.has('x-luckread-session-token'), {
          status: suppliedSubjectAttempt.facts.status,
          errorCode: suppliedSubjectAttempt.facts.errorCode,
          tokenIssued: Boolean(suppliedSubjectAttempt.response?.headers.has('x-luckread-session-token')),
          suppliedIdentityLogged: false,
        })

      const challengeVerify = await request('signin_totp_challenge_success', 'POST', '/v1/auth/mfa/challenge/verify', {
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `${baseKey}-signin-totp`,
        },
        body: { code: challengeCode, method: 'totp' },
      })
      const challengeData = challengeVerify.payload?.data
      const challengeVerifyPass = challengeVerify.facts.status === 200 &&
        challengeData?.authenticated === true && challengeData?.user?.id === userId &&
        challengeVerify.response?.headers.has('x-luckread-session-token') &&
        !hasCredentialField(challengeVerify.payload) &&
        cookieNames().some((name) => /session_token/i.test(name))
      check('valid_totp_completes_signin_challenge_without_json_token_leak', Boolean(challengeVerifyPass), {
        status: challengeVerify.facts.status,
        cacheControl: challengeVerify.facts.cacheControl,
        nativeSessionHeaderPresent: Boolean(challengeVerify.response?.headers.has('x-luckread-session-token')),
        sessionTokenInJson: hasCredentialField(challengeVerify.payload),
      })
      if (!challengeVerifyPass) {
        result.status = 'MFA_SIGNIN_TOTP_CHALLENGE_FAILED'
        restoreCookieHeader(lastAuthenticatedCookie)
        return
      }
      latestAcceptedTotpStep = challengeStep
      lastAuthenticatedCookie = cookieHeader()

      const challengeReplay = await request('signin_challenge_cookie_is_single_use', 'POST', '/v1/auth/mfa/challenge/verify', {
        headers: {
          cookie: totpChallengeCookie,
          'content-type': 'application/json',
          'Idempotency-Key': `${baseKey}-signin-totp-replay`,
        },
        body: { code: challengeCode, method: 'totp' },
        useCookies: false,
      })
      check('consumed_totp_challenge_cookie_is_rejected', challengeReplay.facts.status === 401, {
        status: challengeReplay.facts.status,
        errorCode: challengeReplay.facts.errorCode,
      })

      const totpReplay = await request('reused_signin_totp_step_is_rejected', 'POST', '/v1/auth/mfa/disable', {
        headers: { 'content-type': 'application/json' },
        body: { currentPassword: password, code: challengeCode },
      })
      check('mfa_rejects_totp_step_already_accepted_during_signin', totpReplay.facts.status === 401, {
        status: totpReplay.facts.status,
        errorCode: totpReplay.facts.errorCode,
        totpValueLogged: false,
      })

      const enabledAfterTotpReplay = await request('mfa_stays_enabled_after_signin_replay', 'GET', '/v1/auth/mfa')
      const enabledAfterTotpReplayData = totpStatus(enabledAfterTotpReplay.payload)
      check('replayed_signin_totp_does_not_disable_factor',
        enabledAfterTotpReplay.facts.status === 200 &&
        enabledAfterTotpReplayData?.enabled === true && enabledAfterTotpReplayData?.verified === true, {
          status: enabledAfterTotpReplay.facts.status,
          factorStillEnabled: enabledAfterTotpReplayData?.enabled === true &&
            enabledAfterTotpReplayData?.verified === true,
        })

      // Exercise one-time recovery-code consumption via a separate fresh
      // sign-in challenge. The recovery code remains in memory only.
      const recoveryCode = recoveryCodes[0]
      check('recovery_code_available_for_one_time_challenge_test',
        typeof recoveryCode === 'string' && recoveryCode.length > 0, {
          recoveryCodeCount: recoveryCodes.length,
          recoveryCodeLogged: false,
        })
      if (typeof recoveryCode !== 'string' || recoveryCode.length === 0) {
        result.status = 'MFA_RECOVERY_CODE_NOT_AVAILABLE'
        restoreCookieHeader(lastAuthenticatedCookie)
        return
      }

      clearCookies()
      const recoveryLogin = await request('login_issues_recovery_challenge', 'POST', '/v1/auth/login', {
        headers: { 'content-type': 'application/json' },
        body: { identity: email, credential: password },
      })
      const recoveryLoginPass = recoveryLogin.facts.status === 202 &&
        recoveryLogin.payload?.data?.challengeRequired === true &&
        Array.isArray(recoveryLogin.payload?.data?.methods) &&
        recoveryLogin.payload.data.methods.includes('recovery_code') &&
        cookieNames().some((name) => /two_factor/i.test(name))
      check('fresh_login_issues_recovery_code_challenge', Boolean(recoveryLoginPass), {
        status: recoveryLogin.facts.status,
        challengeCookiePresent: cookieNames().some((name) => /two_factor/i.test(name)),
      })
      if (!recoveryLoginPass) {
        result.status = 'MFA_RECOVERY_CHALLENGE_FAILED'
        restoreCookieHeader(lastAuthenticatedCookie)
        return
      }
      const recoveryChallengeCookie = cookieHeader()
      const recoveryVerify = await request('signin_recovery_code_success', 'POST', '/v1/auth/mfa/challenge/verify', {
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `${baseKey}-recovery-code`,
        },
        body: { code: recoveryCode, method: 'recovery_code' },
      })
      const recoveryData = recoveryVerify.payload?.data
      const recoveryVerifyPass = recoveryVerify.facts.status === 200 &&
        recoveryData?.authenticated === true && recoveryData?.user?.id === userId &&
        recoveryVerify.response?.headers.has('x-luckread-session-token') &&
        !hasCredentialField(recoveryVerify.payload) &&
        cookieNames().some((name) => /session_token/i.test(name))
      check('valid_recovery_code_completes_signin_without_json_token_leak', Boolean(recoveryVerifyPass), {
        status: recoveryVerify.facts.status,
        cacheControl: recoveryVerify.facts.cacheControl,
        nativeSessionHeaderPresent: Boolean(recoveryVerify.response?.headers.has('x-luckread-session-token')),
        sessionTokenInJson: hasCredentialField(recoveryVerify.payload),
      })
      if (!recoveryVerifyPass) {
        result.status = 'MFA_RECOVERY_CODE_CHALLENGE_FAILED'
        restoreCookieHeader(lastAuthenticatedCookie)
        return
      }
      lastAuthenticatedCookie = cookieHeader()

      const recoveryChallengeReplay = await request('consumed_recovery_challenge_cookie_is_single_use', 'POST',
        '/v1/auth/mfa/challenge/verify', {
          headers: {
            cookie: recoveryChallengeCookie,
            'content-type': 'application/json',
            'Idempotency-Key': `${baseKey}-recovery-challenge-replay`,
          },
          body: { code: recoveryCode, method: 'recovery_code' },
          useCookies: false,
        })
      check('consumed_recovery_challenge_cookie_is_rejected', recoveryChallengeReplay.facts.status === 401, {
        status: recoveryChallengeReplay.facts.status,
        errorCode: recoveryChallengeReplay.facts.errorCode,
      })

      // A fresh challenge with the same recovery code must fail too; this
      // distinguishes recovery-code consumption from challenge-cookie expiry.
      clearCookies()
      const recoveryReuseLogin = await request('login_for_recovery_reuse_negative_test', 'POST', '/v1/auth/login', {
        headers: { 'content-type': 'application/json' },
        body: { identity: email, credential: password },
      })
      const recoveryReuseChallengeReady = recoveryReuseLogin.facts.status === 202 &&
        recoveryReuseLogin.payload?.data?.challengeRequired === true &&
        cookieNames().some((name) => /two_factor/i.test(name))
      check('fresh_challenge_available_for_recovery_reuse_test', Boolean(recoveryReuseChallengeReady), {
        status: recoveryReuseLogin.facts.status,
        challengeCookiePresent: cookieNames().some((name) => /two_factor/i.test(name)),
      })
      if (recoveryReuseChallengeReady) {
        const recoveryReuse = await request('reused_recovery_code_rejected_on_fresh_challenge', 'POST',
          '/v1/auth/mfa/challenge/verify', {
            headers: {
              'content-type': 'application/json',
              'Idempotency-Key': `${baseKey}-recovery-code-replay`,
            },
            body: { code: recoveryCode, method: 'recovery_code' },
          })
        check('recovery_code_is_single_use_across_new_challenges', recoveryReuse.facts.status === 401, {
          status: recoveryReuse.facts.status,
          errorCode: recoveryReuse.facts.errorCode,
          recoveryCodeLogged: false,
        })
      } else {
        check('recovery_code_is_single_use_across_new_challenges', false, {
          reason: 'fresh recovery challenge could not be established',
        })
      }

      restoreCookieHeader(lastAuthenticatedCookie)
      const recoveredStatus = await request('mfa_stays_enabled_after_recovery_flow', 'GET', '/v1/auth/mfa')
      const recoveredData = totpStatus(recoveredStatus.payload)
      check('recovery_code_flow_keeps_authoritative_factor_enabled',
        recoveredStatus.facts.status === 200 && recoveredData?.enabled === true && recoveredData?.verified === true, {
          status: recoveredStatus.facts.status,
          factorStillEnabled: recoveredData?.enabled === true && recoveredData?.verified === true,
        })

      // Rotation must invalidate every unused code from the old set and
      // return a new no-store set. Only counts and booleans enter evidence.
      const oldUnusedRecoveryCode = recoveryCodes.find((code) => code !== recoveryCode)
      check('unused_pre_rotation_recovery_code_available', typeof oldUnusedRecoveryCode === 'string', {
        recoveryCodeCount: recoveryCodes.length,
        recoveryCodeValuesLogged: false,
      })
      if (typeof oldUnusedRecoveryCode !== 'string') {
        result.status = 'MFA_RECOVERY_ROTATION_PRECONDITION_FAILED'
        return
      }

      let rotation = null
      let rotationStep = null
      let rotatedRecoveryCodes = []
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const step = currentStep(totp.period)
        if (step <= (latestAcceptedTotpStep ?? confirmedStep)) {
          const previousStep = latestAcceptedTotpStep ?? confirmedStep
          const remainingMs = (previousStep + 1) * totp.period * 1000 - Date.now()
          await sleep(Math.max(250, Math.min(remainingMs + 250, 31_000)))
          continue
        }
        const code = codeForStep(totp.secret, step, totp.digits, totp.algorithm)
        rotation = await request('rotate_recovery_codes_with_password_and_fresh_totp',
          'POST', '/v1/auth/mfa/recovery-codes/rotate', {
            headers: {
              'content-type': 'application/json',
              'Idempotency-Key': `${baseKey}-recovery-rotation-${attempt}`,
            },
            body: { currentPassword: password, code },
          })
        const candidate = rotation.payload?.data?.recoveryCodes
        if (rotation.facts.status === 200 && Array.isArray(candidate) &&
            candidate.length >= 1 && candidate.length <= 32 &&
            candidate.every((value) => typeof value === 'string' && value.length >= 1 && value.length <= 128)) {
          rotationStep = step
          rotatedRecoveryCodes = [...candidate]
          break
        }
        if (rotation.facts.status !== 401) break
        await sleep(1_000)
      }

      const oldAndNewCodesDisjoint = rotatedRecoveryCodes.length > 0 &&
        rotatedRecoveryCodes.every((code) => !recoveryCodes.includes(code))
      const rotationPass = rotation?.facts.status === 200 &&
        rotation.facts.cacheControl === 'no-store' &&
        rotatedRecoveryCodes.length > 0 &&
        oldAndNewCodesDisjoint
      check('recovery_code_rotation_requires_password_and_fresh_totp_and_replaces_entire_set',
        Boolean(rotationPass), {
          status: rotation?.facts.status ?? null,
          cacheControl: rotation?.facts.cacheControl ?? null,
          oldRecoveryCodeCount: recoveryCodes.length,
          newRecoveryCodeCount: rotatedRecoveryCodes.length,
          oldAndNewSetsDisjoint: oldAndNewCodesDisjoint,
          recoveryCodeValuesLogged: false,
        })
      if (!rotationPass || rotationStep === null) {
        result.status = 'MFA_RECOVERY_CODE_ROTATION_FAILED'
        return
      }
      recoveryCodes = rotatedRecoveryCodes
      latestAcceptedTotpStep = rotationStep
      lastAuthenticatedCookie = cookieHeader()

      clearCookies()
      const oldCodeLogin = await request('login_for_old_recovery_code_rejection', 'POST', '/v1/auth/login', {
        headers: { 'content-type': 'application/json' },
        body: { identity: email, credential: password },
      })
      const oldCodeChallengeReady = oldCodeLogin.facts.status === 202 &&
        oldCodeLogin.payload?.data?.challengeRequired === true &&
        Array.isArray(oldCodeLogin.payload?.data?.methods) &&
        oldCodeLogin.payload.data.methods.includes('recovery_code') &&
        cookieNames().some((name) => /two_factor/i.test(name))
      check('fresh_challenge_available_for_old_recovery_code_rejection', Boolean(oldCodeChallengeReady), {
        status: oldCodeLogin.facts.status,
        challengeCookiePresent: cookieNames().some((name) => /two_factor/i.test(name)),
      })
      if (!oldCodeChallengeReady) {
        result.status = 'MFA_OLD_RECOVERY_CODE_CHALLENGE_FAILED'
        restoreCookieHeader(lastAuthenticatedCookie)
        return
      }
      const oldCodeAttempt = await request('pre_rotation_unused_recovery_code_rejected_after_rotation',
        'POST', '/v1/auth/mfa/challenge/verify', {
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': `${baseKey}-old-recovery-code-after-rotation`,
          },
          body: { code: oldUnusedRecoveryCode, method: 'recovery_code' },
        })
      check('pre_rotation_unused_recovery_code_is_invalidated',
        oldCodeAttempt.facts.status === 401 &&
        !oldCodeAttempt.response?.headers.has('x-luckread-session-token'), {
          status: oldCodeAttempt.facts.status,
          errorCode: oldCodeAttempt.facts.errorCode,
          recoveryCodeValueLogged: false,
        })

      clearCookies()
      const newCodeLogin = await request('login_for_new_recovery_code_acceptance', 'POST', '/v1/auth/login', {
        headers: { 'content-type': 'application/json' },
        body: { identity: email, credential: password },
      })
      const newCodeChallengeReady = newCodeLogin.facts.status === 202 &&
        newCodeLogin.payload?.data?.challengeRequired === true &&
        Array.isArray(newCodeLogin.payload?.data?.methods) &&
        newCodeLogin.payload.data.methods.includes('recovery_code') &&
        cookieNames().some((name) => /two_factor/i.test(name))
      check('fresh_challenge_available_for_new_recovery_code', Boolean(newCodeChallengeReady), {
        status: newCodeLogin.facts.status,
        challengeCookiePresent: cookieNames().some((name) => /two_factor/i.test(name)),
      })
      if (!newCodeChallengeReady) {
        result.status = 'MFA_NEW_RECOVERY_CODE_CHALLENGE_FAILED'
        restoreCookieHeader(lastAuthenticatedCookie)
        return
      }
      const newCodeAttempt = await request('newly_rotated_recovery_code_is_accepted',
        'POST', '/v1/auth/mfa/challenge/verify', {
          headers: {
            'content-type': 'application/json',
            'Idempotency-Key': `${baseKey}-new-recovery-code-after-rotation`,
          },
          body: { code: recoveryCodes[0], method: 'recovery_code' },
        })
      const newCodeData = newCodeAttempt.payload?.data
      const newCodeAccepted = newCodeAttempt.facts.status === 200 &&
        newCodeData?.authenticated === true && newCodeData?.user?.id === userId &&
        newCodeAttempt.response?.headers.has('x-luckread-session-token') &&
        !hasCredentialField(newCodeAttempt.payload)
      check('newly_rotated_recovery_code_completes_signin_without_json_token_leak',
        Boolean(newCodeAccepted), {
          status: newCodeAttempt.facts.status,
          tokenIssuedInHeader: Boolean(newCodeAttempt.response?.headers.has('x-luckread-session-token')),
          sessionTokenInJson: hasCredentialField(newCodeAttempt.payload),
          recoveryCodeValueLogged: false,
        })
      if (!newCodeAccepted) {
        result.status = 'MFA_NEW_RECOVERY_CODE_REJECTED'
        restoreCookieHeader(lastAuthenticatedCookie)
        return
      }
      lastAuthenticatedCookie = cookieHeader()
      restoreCookieHeader(lastAuthenticatedCookie)
      const afterRotationStatus = await request('mfa_status_after_recovery_rotation', 'GET', '/v1/auth/mfa')
      const afterRotationData = totpStatus(afterRotationStatus.payload)
      check('recovery_rotation_keeps_factor_enabled',
        afterRotationStatus.facts.status === 200 && afterRotationData?.enabled === true &&
        afterRotationData?.verified === true, {
          status: afterRotationStatus.facts.status,
          factorStillEnabled: afterRotationData?.enabled === true && afterRotationData?.verified === true,
        })
    }

    const oldCookie = cookieHeader()
    let disable = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const step = currentStep(totp.period)
      if (step <= (latestAcceptedTotpStep ?? confirmedStep)) {
        const remainingMs = ((latestAcceptedTotpStep ?? confirmedStep) + 1) * totp.period * 1000 - Date.now()
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
    // If the test failed after enabling MFA, restore the most recently verified
    // session cookie before attempting bounded cleanup with a fresh TOTP step.
    // Cookie values remain memory-only and are never added to evidence or logs.
    if (factorEnabled && !normalDisableSucceeded && lastAuthenticatedCookie) {
      restoreCookieHeader(lastAuthenticatedCookie)
    }
    // Cleanup failure is surfaced as a manual-review blocker, never hidden.
    if (factorEnabled && !normalDisableSucceeded && totp && confirmedStep !== null) {
      result.cleanupStatus = 'cleanup_attempted'
      let cleanupSucceeded = false
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const step = currentStep(totp.period)
        if (step <= (latestAcceptedTotpStep ?? confirmedStep)) {
          const remainingMs = ((latestAcceptedTotpStep ?? confirmedStep) + 1) * totp.period * 1000 - Date.now()
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
