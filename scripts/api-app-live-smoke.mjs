import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const baseUrl = 'https://api.luckread.com'
const runId = process.env.GITHUB_RUN_ID || 'local'
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1'
const sourceSha = process.env.GITHUB_SHA || 'unknown'
const requestSuffix = randomUUID().replaceAll('-', '').slice(0, 16)
const evidenceDir = resolve('artifacts/api-app-live-smoke')
const evidencePath = resolve(evidenceDir, `api-app-live-smoke-${runId}-${runAttempt}.json`)

const summarizeBody = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { json: false, topLevelKeys: [] }
  }

  const summary = {
    json: true,
    topLevelKeys: Object.keys(value).sort(),
  }
  if (value.error && typeof value.error === 'object' && typeof value.error.code === 'string') {
    summary.errorCode = value.error.code
  }
  if (typeof value.requestId === 'string') summary.requestId = value.requestId
  if (Array.isArray(value.data)) summary.dataCount = value.data.length
  if (Array.isArray(value.docs)) summary.docsCount = value.docs.length
  return summary
}

const probe = async ({ name, method, path, headers = {}, body, accepts, expectedErrorCode, inspectPublicCache = false }) => {
  const started = Date.now()
  let result

  try {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { accept: 'application/json', ...headers },
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    })

    const text = await response.text()
    let parsed
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = undefined
    }
    const bodySummary = summarizeBody(parsed)
    const contentType = response.headers.get('content-type')
    const cacheControl = response.headers.get('cache-control')
    const requestIdHeader = response.headers.get('x-request-id')
    const luckReadCache = response.headers.get('x-luckread-cache')
    const statusAccepted = accepts.includes(response.status)
    const errorAccepted = !expectedErrorCode || bodySummary.errorCode === expectedErrorCode
    const isJsonExpected = response.status === 204 || bodySummary.json === true
    const normalizedCacheControl = (cacheControl ?? '').toLowerCase()
    const cacheContractPass = !inspectPublicCache || (
      (luckReadCache === 'HIT' || luckReadCache === 'MISS') &&
      typeof requestIdHeader === 'string' &&
      requestIdHeader.length > 0 &&
      bodySummary.requestId === requestIdHeader &&
      normalizedCacheControl.includes('private') &&
      normalizedCacheControl.includes('no-store')
    )

    result = {
      name,
      method,
      path,
      status: response.status,
      acceptedStatuses: accepts,
      expectedErrorCode: expectedErrorCode || null,
      pass: statusAccepted && errorAccepted && isJsonExpected && cacheContractPass,
      cacheContractPass: inspectPublicCache ? cacheContractPass : null,
      durationMs: Date.now() - started,
      contentType,
      cacheControl,
      xRequestId: requestIdHeader,
      luckReadCache,
      cfRay: response.headers.get('cf-ray'),
      body: bodySummary,
    }
  } catch (error) {
    result = {
      name,
      method,
      path,
      status: null,
      acceptedStatuses: accepts,
      expectedErrorCode: expectedErrorCode || null,
      pass: false,
      cacheContractPass: inspectPublicCache ? false : null,
      durationMs: Date.now() - started,
      transportError: error instanceof Error ? error.name : typeof error,
    }
  }

  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${method} ${path} -> ${result.status ?? result.transportError}`)
  return result
}

const headers = (extra = {}) => ({
  'content-type': 'application/json',
  ...extra,
})

const results = []
const publicCacheFirst = await probe({
  name: 'public_content_list_cache_contract_first_request',
  method: 'GET',
  path: '/api/v1/contents?limit=1',
  accepts: [200],
  inspectPublicCache: true,
})
results.push(publicCacheFirst)

const publicCacheSecond = await probe({
  name: 'public_content_list_cache_contract_repeat_request',
  method: 'GET',
  path: '/api/v1/contents?limit=1',
  accepts: [200],
  inspectPublicCache: true,
})
results.push(publicCacheSecond)

const requestIdsAreFresh = (
  typeof publicCacheFirst.body?.requestId === 'string' &&
  typeof publicCacheSecond.body?.requestId === 'string' &&
  publicCacheFirst.body.requestId !== publicCacheSecond.body.requestId
)
results.push({
  name: 'public_content_list_request_id_refresh',
  method: 'ASSERT',
  path: '/api/v1/contents?limit=1 (two requests)',
  status: requestIdsAreFresh ? 200 : 500,
  acceptedStatuses: [200],
  expectedErrorCode: null,
  pass: requestIdsAreFresh,
  requestIdsAreDistinct: requestIdsAreFresh,
  durationMs: 0,
})

results.push(await probe({
  name: 'anonymous_current_profile_denied',
  method: 'GET',
  path: '/api/v1/users/me',
  accepts: [401],
}))

results.push(await probe({
  name: 'invalid_login_rejected_at_public_edge',
  method: 'POST',
  path: '/api/v1/auth/login',
  headers: headers(),
  body: JSON.stringify({ identity: 'not-an-email', credential: 'probe-only' }),
  accepts: [422],
  expectedErrorCode: 'EMAIL_INVALID',
}))

results.push(await probe({
  name: 'invalid_verification_email_rejected_at_public_edge',
  method: 'POST',
  path: '/api/v1/auth/verification/send',
  headers: headers(),
  body: JSON.stringify({ identity: 'not-an-email' }),
  accepts: [422],
  expectedErrorCode: 'VALIDATION_FAILED',
}))

results.push(await probe({
  name: 'registration_invalid_body_rejected_without_account_creation',
  method: 'POST',
  path: '/api/v1/auth/register',
  headers: headers({ 'Idempotency-Key': `api-smoke-invalid-${requestSuffix}` }),
  body: JSON.stringify({}),
  accepts: [422],
  expectedErrorCode: 'VALIDATION_FAILED',
}))

results.push(await probe({
  name: 'anonymous_content_create_denied_before_body_processing',
  method: 'POST',
  path: '/api/v1/contents',
  headers: headers({ 'Idempotency-Key': `api-smoke-unauth-content-${requestSuffix}` }),
  // Deliberately malformed JSON: if auth is accidentally bypassed, validation
  // still prevents a valid content mutation.
  body: '{ invalid-json',
  accepts: [401, 403],
}))

results.push(await probe({
  name: 'anonymous_like_mutation_denied',
  method: 'POST',
  path: '/api/v1/interactions/likes',
  headers: headers({ 'Idempotency-Key': `api-smoke-unauth-like-${requestSuffix}` }),
  // Deliberately malformed JSON; auth must reject before social write handling.
  body: '{ invalid-json',
  accepts: [401, 403],
}))

results.push(await probe({
  name: 'unknown_public_username_returns_not_found',
  method: 'GET',
  path: `/api/v1/users/by-username/api-smoke-no-user-${requestSuffix}`,
  accepts: [404],
  expectedErrorCode: 'NOT_FOUND',
}))

const failed = results.filter((item) => !item.pass)
const evidence = {
  evidenceType: 'LUCKREAD_APP_API_LIVE_HTTP_SMOKE',
  timestamp: new Date().toISOString(),
  baseUrl,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceSha,
  credentialsUsed: false,
  writeIntent: 'negative-validation-or-anonymous-denial-only; no successful mutations requested',
  summary: {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    status: failed.length === 0 ? 'PASS_SMOKE_ONLY' : 'FAIL',
  },
  results,
}

await mkdir(evidenceDir, { recursive: true })
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
console.log(`Evidence saved to ${evidencePath}`)
console.log(`Summary: ${evidence.summary.passed}/${evidence.summary.total} probes passed`)

if (failed.length > 0) {
  console.error('One or more HTTP probes failed; inspect the uploaded evidence artifact.')
  process.exitCode = 1
}
