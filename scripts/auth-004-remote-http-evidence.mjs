import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const BASE_URL = String(process.env.W01_BASE_URL || '').replace(/\/$/, '')
const DATABASE_NAME = String(process.env.DATABASE_NAME || '')
const TESTED_SOURCE_SHA = String(process.env.TESTED_SOURCE_SHA || '')
const WORKFLOW_HEAD_SHA = String(process.env.WORKFLOW_HEAD_SHA || '')
const DEPLOYMENT_RUN_ID = Number(process.env.DEPLOYMENT_RUN_ID || 0)
const WRANGLER_VERSION = process.env.WRANGLER_VERSION || '4.116.0'
const WRANGLER_CONFIG = process.env.WRANGLER_CONFIG || 'workers/W01-payload/wrangler.jsonc'
const ARTIFACT_DIR = 'artifacts/evidence/auth-004/remote'
const POLICY_PATH = 'artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json'

if (!BASE_URL || !DATABASE_NAME || !/^[0-9a-f]{40}$/.test(TESTED_SOURCE_SHA)) {
  throw new Error('AUTH-004 remote evidence inputs are incomplete')
}
if (!/^[0-9a-f]{40}$/.test(WORKFLOW_HEAD_SHA)) throw new Error('workflow provenance SHA is invalid')
if (!DEPLOYMENT_RUN_ID) throw new Error('deployment run id is required')

mkdirSync(ARTIFACT_DIR, { recursive: true })

const runId = String(process.env.GITHUB_RUN_ID || Date.now())
const nonce = randomBytes(8).toString('hex')
const email = 'auth004-remote-' + runId + '-' + nonce + '@luckread.invalid'
const username = 'auth004_' + runId + '_' + nonce
const initialPassword = 'AUTH004-Remote-' + randomBytes(24).toString('base64url') + '-A'
const changedPassword = 'AUTH004-Changed-' + randomBytes(24).toString('base64url') + '-B'
const secondChangedPassword = 'AUTH004-Changed2-' + randomBytes(24).toString('base64url') + '-C'
const resetPassword = 'AUTH004-Reset-' + randomBytes(24).toString('base64url') + '-D'
const expiredResetPassword = 'AUTH004-Expired-' + randomBytes(24).toString('base64url') + '-E'

const context = { userId: '', cleanupErrors: [], rawTokenSeen: false }
const assertions = {
  sourceExact: false,
  change204: false,
  changeBodyEmpty: false,
  changeNoStore: false,
  previousSessionInvalidatedAfterChange: false,
  activeSessionStillUsableAfterChange: false,
  resetRequestKnownAccount202: false,
  resetRequestUnknownAccount202: false,
  resetRequestUniformBody: false,
  resetConfirm204: false,
  resetConfirmBodyEmpty: false,
  resetReplay422: false,
  resetPreviousSessionInvalidated: false,
  wrongPurpose422: false,
  expiredReset422: false,
  resetTokenNeverReturned: true,
  cleanupCompleted: false,
}
const responses = {}

const sqlString = (value) => "'" + String(value).replace(/'/g, "''") + "'"
const pastIso = () => new Date(Date.now() - 60_000).toISOString()
const json = (value) => JSON.stringify(value, null, 2) + '\n'
const digest = (value) => createHash('sha256').update(value).digest('hex')

function unwrapRows(value) {
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

function d1Json(command) {
  const output = execFileSync(
    'npx',
    ['--yes', 'wrangler@' + WRANGLER_VERSION, 'd1', 'execute', DATABASE_NAME, '--remote', '--json', '--config', WRANGLER_CONFIG, '--command', command],
    { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 },
  )
  return JSON.parse(output)
}

function d1Rows(command) {
  return unwrapRows(d1Json(command))
}

async function request(path, options = {}) {
  const method = options.method || 'GET'
  const body = options.body
  const token = options.token
  const extraHeaders = options.extraHeaders || {}
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20_000)
  try {
    const response = await fetch(BASE_URL + path, {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return {
      status: response.status,
      bodyText: await response.text(),
      contentType: response.headers.get('content-type') || '',
      cacheControl: response.headers.get('cache-control') || '',
      cfRay: response.headers.get('cf-ray') || '',
    }
  } finally {
    clearTimeout(timeout)
  }
}

function safeResponse(result, secret = '') {
  return {
    status: result.status,
    bodyEmpty: result.bodyText.length === 0,
    contentType: result.contentType,
    cacheControl: result.cacheControl,
    cfRayObserved: Boolean(result.cfRay),
    secretLeaked: secret ? result.bodyText.includes(secret) : false,
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function registerUser() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'))
  assert(policy.status === 'APPROVED' && policy.environment === 'PRODUCTION' && policy.usage?.productionUse === true, 'production registration policy is not admissible')
  const response = await request('/auth/register', {
    method: 'POST',
    body: {
      identityType: 'email',
      identity: email,
      credential: initialPassword,
      username,
      consent: { purpose: 'ACCOUNT_REGISTRATION', policyVersion: policy.policyVersion },
    },
    extraHeaders: { 'Idempotency-Key': 'auth004-' + runId + '-register-' + nonce },
  })
  assert(response.status === 201, 'ephemeral AUTH-004 registration failed with HTTP ' + response.status)
  const parsed = response.bodyText ? JSON.parse(response.bodyText) : {}
  assert(typeof parsed.userId === 'string', 'registration returned no userId')
  context.userId = parsed.userId
}

async function login(deviceId, password) {
  const response = await request('/auth/login', {
    method: 'POST',
    body: { identity: email, credential: password, deviceId },
  })
  assert(response.status === 200, 'login failed with HTTP ' + response.status)
  const parsed = JSON.parse(response.bodyText)
  assert(typeof parsed.accessToken === 'string' && parsed.accessToken.length > 20, 'login returned no access token')
  return { accessToken: parsed.accessToken, deviceId }
}

async function passwordChange(session, currentPassword, newPassword, label) {
  return request('/auth/password/change', {
    method: 'POST',
    token: session.accessToken,
    body: { currentPassword, newPassword },
    extraHeaders: { 'Idempotency-Key': 'auth004-' + runId + '-' + label + '-' + randomBytes(6).toString('hex') },
  })
}

async function resetRequest(identifier) {
  return request('/auth/password/reset/request', { method: 'POST', body: { identifier } })
}

async function resetConfirm(token, newPassword) {
  return request('/auth/password/reset/confirm', { method: 'POST', body: { recoveryToken: token, newPassword } })
}

function readNativeResetToken() {
  const rows = d1Rows(
    'SELECT id, reset_password_token, reset_password_expiration FROM users WHERE CAST(id AS TEXT)=' + sqlString(context.userId) + ' LIMIT 1',
  )
  const row = rows[0]
  assert(row && row.id, 'remote reset user disappeared')
  const token = typeof row.reset_password_token === 'string' ? row.reset_password_token : ''
  const expiration = typeof row.reset_password_expiration === 'string' ? row.reset_password_expiration : ''
  assert(token.length >= 20, 'native Payload reset token was not materialized')
  assert(Date.parse(expiration) > Date.now(), 'native Payload reset token expiration is not in the future')
  context.rawTokenSeen = true
  return { token, expiration }
}

function forceResetExpiry() {
  d1Json('UPDATE users SET reset_password_expiration=' + sqlString(pastIso()) + ' WHERE CAST(id AS TEXT)=' + sqlString(context.userId))
}

async function cleanup() {
  if (!context.userId) return
  const steps = [
    ['consents', 'DELETE FROM consents WHERE CAST(owner_subject_id AS TEXT)=' + sqlString(context.userId) + ' OR CAST(actor_subject_id AS TEXT)=' + sqlString(context.userId) + ' OR CAST(resource_id AS TEXT)=' + sqlString(context.userId)],
    ['auth_session_state', 'DELETE FROM auth_session_state WHERE user_id=' + sqlString(context.userId)],
    ['users_sessions', 'DELETE FROM users_sessions WHERE CAST(_parent_id AS TEXT)=' + sqlString(context.userId)],
    ['users', 'DELETE FROM users WHERE CAST(id AS TEXT)=' + sqlString(context.userId)],
  ]
  for (const step of steps) {
    try {
      d1Json(step[1])
    } catch (error) {
      context.cleanupErrors.push(step[0] + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
}

try {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  assert(head === WORKFLOW_HEAD_SHA, 'workflow checkout SHA does not match workflow SHA')
  assert(execFileSync('git', ['cat-file', '-t', TESTED_SOURCE_SHA], { encoding: 'utf8' }).trim() === 'commit', 'tested source SHA is not a commit')
  for (const file of [
    'workers/W01-payload/src/app/auth/password/change/route.ts',
    'workers/W01-payload/src/app/auth/password/reset/request/route.ts',
    'workers/W01-payload/src/app/auth/password/reset/confirm/route.ts',
  ]) {
    execFileSync('git', ['cat-file', '-e', TESTED_SOURCE_SHA + ':' + file])
  }
  assertions.sourceExact = true

  await registerUser()

  const changeA = await login('auth004-change-a', initialPassword)
  const changeB = await login('auth004-change-b', initialPassword)

  const changed = await passwordChange(changeA, initialPassword, changedPassword, 'change-a')
  responses.change = safeResponse(changed)
  assertions.change204 = changed.status === 204
  assertions.changeBodyEmpty = changed.bodyText.length === 0
  assertions.changeNoStore = changed.cacheControl.toLowerCase() === 'no-store'
  assert(assertions.change204 && assertions.changeBodyEmpty && assertions.changeNoStore, 'password change contract failed')

  const staleChange = await passwordChange(changeB, changedPassword, secondChangedPassword, 'stale-after-change')
  responses.staleAfterChange = safeResponse(staleChange)
  assertions.previousSessionInvalidatedAfterChange = staleChange.status === 401
  assert(assertions.previousSessionInvalidatedAfterChange, 'password change did not invalidate the other session')

  const activeChange = await passwordChange(changeA, changedPassword, secondChangedPassword, 'active-after-change')
  responses.activeAfterChange = safeResponse(activeChange)
  assertions.activeSessionStillUsableAfterChange = activeChange.status === 204 && activeChange.bodyText.length === 0
  assert(assertions.activeSessionStillUsableAfterChange, 'current password-change session was unexpectedly invalidated')

  const knownRequest = await resetRequest(email)
  const unknownRequest = await resetRequest('unknown-' + runId + '-' + nonce + '@luckread.invalid')
  responses.resetRequestKnown = safeResponse(knownRequest)
  responses.resetRequestUnknown = safeResponse(unknownRequest)
  assertions.resetRequestKnownAccount202 = knownRequest.status === 202 && knownRequest.bodyText.length === 0
  assertions.resetRequestUnknownAccount202 = unknownRequest.status === 202 && unknownRequest.bodyText.length === 0
  assertions.resetRequestUniformBody = knownRequest.bodyText === unknownRequest.bodyText
  assert(assertions.resetRequestKnownAccount202 && assertions.resetRequestUnknownAccount202 && assertions.resetRequestUniformBody, 'reset request enumeration resistance failed')

  const resetFixture = readNativeResetToken()
  const resetConfirmed = await resetConfirm(resetFixture.token, resetPassword)
  responses.resetConfirm = safeResponse(resetConfirmed, resetFixture.token)
  assertions.resetConfirm204 = resetConfirmed.status === 204
  assertions.resetConfirmBodyEmpty = resetConfirmed.bodyText.length === 0
  assertions.resetTokenNeverReturned = assertions.resetTokenNeverReturned && !resetConfirmed.bodyText.includes(resetFixture.token)
  assert(assertions.resetConfirm204 && assertions.resetConfirmBodyEmpty, 'reset confirm did not return contracted 204/no-body')

  const replay = await resetConfirm(resetFixture.token, 'AUTH004-Replay-' + randomBytes(24).toString('base64url') + '-F')
  responses.resetReplay = safeResponse(replay, resetFixture.token)
  assertions.resetReplay422 = replay.status === 422
  assertions.resetTokenNeverReturned = assertions.resetTokenNeverReturned && !replay.bodyText.includes(resetFixture.token)
  assert(assertions.resetReplay422, 'reset replay was not rejected with 422')

  const staleResetSession = await passwordChange(changeA, resetPassword, 'AUTH004-OldSession-' + randomBytes(24).toString('base64url') + '-G', 'stale-after-reset')
  responses.staleAfterReset = safeResponse(staleResetSession)
  assertions.resetPreviousSessionInvalidated = staleResetSession.status === 401
  assert(assertions.resetPreviousSessionInvalidated, 'password reset did not invalidate the previous session')

  const postResetLogin = await login('auth004-wrong-purpose', resetPassword)
  const wrongPurpose = await resetConfirm(postResetLogin.accessToken, 'AUTH004-WrongPurpose-' + randomBytes(24).toString('base64url') + '-H')
  responses.wrongPurpose = safeResponse(wrongPurpose, postResetLogin.accessToken)
  assertions.wrongPurpose422 = wrongPurpose.status === 422
  assert(assertions.wrongPurpose422, 'wrong-purpose recovery token was not rejected')

  const secondRequest = await resetRequest(email)
  assert(secondRequest.status === 202 && secondRequest.bodyText.length === 0, 'second reset request failed')
  const expiredFixture = readNativeResetToken()
  forceResetExpiry()
  const expired = await resetConfirm(expiredFixture.token, expiredResetPassword)
  responses.expired = safeResponse(expired, expiredFixture.token)
  assertions.expiredReset422 = expired.status === 422
  assertions.resetTokenNeverReturned = assertions.resetTokenNeverReturned && !expired.bodyText.includes(expiredFixture.token)
  assert(assertions.expiredReset422, 'expired reset token was not rejected with 422')

  const evidence = {
    featureId: 'AUTH-004',
    result: 'EVIDENCE_CAPTURED_WITH_OPEN_BLOCKERS',
    admissionGreen: false,
    testedSourceSha: TESTED_SOURCE_SHA,
    workflowHeadSha: WORKFLOW_HEAD_SHA,
    deploymentRunId: DEPLOYMENT_RUN_ID,
    environmentClass: 'CONTROLLED_REMOTE_W01',
    assertions,
    responses,
    lifecycleEventEvidence: 'NOT_ESTABLISHED',
    mapping0Admission: 'NOT_ESTABLISHED',
    rawSecretsRedacted: true,
    note: 'HTTP/security evidence only. Lifecycle/event evidence remains missing and Mapping 0 is separately gated.',
  }
  writeFileSync(ARTIFACT_DIR + '/auth-004-remote-http-evidence.json', json(evidence))
} catch (error) {
  writeFileSync(ARTIFACT_DIR + '/auth-004-remote-http-evidence.json', json({
    featureId: 'AUTH-004',
    result: 'EVIDENCE_CAPTURE_FAILED',
    admissionGreen: false,
    testedSourceSha: TESTED_SOURCE_SHA,
    workflowHeadSha: WORKFLOW_HEAD_SHA,
    deploymentRunId: DEPLOYMENT_RUN_ID,
    assertions,
    responses,
    lifecycleEventEvidence: 'NOT_ESTABLISHED',
    mapping0Admission: 'NOT_ESTABLISHED',
    rawSecretsRedacted: true,
    failureMessage: error instanceof Error ? error.message : String(error),
  }))
  throw error
} finally {
  await cleanup()
  assertions.cleanupCompleted = context.cleanupErrors.length === 0 && Boolean(context.userId)
  const evidencePath = ARTIFACT_DIR + '/auth-004-remote-http-evidence.json'
  let current = null
  try {
    current = JSON.parse(readFileSync(evidencePath, 'utf8'))
  } catch {
    current = { featureId: 'AUTH-004', result: 'EVIDENCE_CAPTURE_FAILED', admissionGreen: false, testedSourceSha: TESTED_SOURCE_SHA, workflowHeadSha: WORKFLOW_HEAD_SHA, deploymentRunId: DEPLOYMENT_RUN_ID, assertions, responses, lifecycleEventEvidence: 'NOT_ESTABLISHED', mapping0Admission: 'NOT_ESTABLISHED', rawSecretsRedacted: true }
  }
  current.assertions = assertions
  current.cleanup = { completed: assertions.cleanupCompleted, errors: context.cleanupErrors }
  current.generatedAt = new Date().toISOString()
  current.rawSecretMaterialObservedOnlyInMemory = context.rawTokenSeen
  current.rawSecretsRedacted = true
  current.artifactSha256 = digest(JSON.stringify({ featureId: current.featureId, result: current.result, admissionGreen: current.admissionGreen, testedSourceSha: current.testedSourceSha, deploymentRunId: current.deploymentRunId, assertions: current.assertions, cleanup: current.cleanup }))
  writeFileSync(evidencePath, json(current))
  rmSync('/tmp/auth004-reset-token.json', { force: true })
  if (context.cleanupErrors.length > 0) throw new Error('AUTH-004 cleanup failed: ' + context.cleanupErrors.join(' | '))
}