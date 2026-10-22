import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const configuredBaseUrl = process.env.LUCKREAD_API_BASE_URL || 'https://luckread.com'
const runId = process.env.GITHUB_RUN_ID || 'local'
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1'
const sourceSha = process.env.GITHUB_SHA || 'unknown'
const evidenceDir = resolve('artifacts/analytics-events-live-security-e2e')
const evidencePath = resolve(evidenceDir, `analytics-events-live-security-e2e-${runId}-${runAttempt}.json`)

function validateBaseUrl(value) {
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' ||
    !(host === 'luckread.com' || host.endsWith('.luckread.com')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('LUCKREAD_API_BASE_URL must be an HTTPS LuckRead origin without credentials, query, or fragment')
  }
  return url.origin
}

const baseUrl = validateBaseUrl(configuredBaseUrl)
const endpoint = baseUrl + '/api/v1/analytics/events'
const evidence = {
  evidenceType: 'LUCKREAD_ANALYTICS_EVENTS_LIVE_NEGATIVE_SECURITY_E2E',
  timestamp: new Date().toISOString(),
  baseUrl,
  endpointPath: '/api/v1/analytics/events',
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceSha,
  testMode: 'negative-only; no successful telemetry batch is sent',
  credentialsUsed: false,
  cookiesSent: false,
  requestBodiesStored: false,
  responseBodiesStored: false,
  checks: [],
  status: 'PENDING',
}

const requestId = () => 'analytics-security-e2e-' + randomUUID().replaceAll('-', '')
const makeEvent = (suffix, overrides = {}) => ({
  eventId: `security-e2e-event-${suffix}`,
  dedupeKey: `security-e2e-dedupe-${suffix}`,
  eventName: 'content_open',
  occurredAt: new Date().toISOString(),
  sessionId: 'security-e2e-session',
  contentId: 'security-e2e-content',
  contentType: 'article',
  ...overrides,
})

async function probe(name, { headers = {}, body }) {
  const started = Date.now()
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'X-LuckRead-Correlation-Id': requestId(),
        ...headers,
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    })
    const raw = await response.text()
    let payload = null
    try { payload = raw ? JSON.parse(raw) : null } catch {}
    const errorCode = payload && typeof payload === 'object' &&
      typeof payload.error?.code === 'string' ? payload.error.code : null
    return {
      name,
      status: response.status,
      errorCode,
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      cfRayPresent: Boolean(response.headers.get('cf-ray')),
      requestIdPresent: typeof payload?.requestId === 'string' && payload.requestId.length > 0,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return {
      name,
      status: null,
      transportError: error instanceof Error ? error.name : typeof error,
      durationMs: Date.now() - started,
    }
  }
}

const cases = [
  {
    name: 'reject_non_json_media_type',
    request: () => ({
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ events: [makeEvent('media')] }),
    }),
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
  },
  {
    name: 'reject_malformed_json',
    request: () => ({
      headers: { 'content-type': 'application/json' },
      body: '{"events":[',
    }),
    status: 422,
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'reject_oversized_body_before_ingest',
    request: () => ({
      headers: { 'content-type': 'application/json' },
      body: ' '.repeat(64 * 1024 + 1),
    }),
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
  },
  {
    name: 'reject_client_forged_actor',
    request: () => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [makeEvent('actor', { actorId: 'forged-actor-id' })] }),
    }),
    status: 422,
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'reject_social_authority_event',
    request: () => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [makeEvent('social', { eventName: 'like_created' })] }),
    }),
    status: 422,
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'reject_more_than_90_events',
    request: () => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        events: Array.from({ length: 91 }, (_, index) =>
          makeEvent(String(index).padStart(4, '0'))),
      }),
    }),
    status: 422,
    code: 'VALIDATION_FAILED',
  },
]

for (const item of cases) {
  const result = await probe(item.name, item.request())
  result.expectedStatus = item.status
  result.expectedErrorCode = item.code
  result.pass = result.status === item.status && result.errorCode === item.code
  evidence.checks.push(result)
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${item.name}: HTTP ${result.status ?? 'transport-error'}`)
}

const failed = evidence.checks.filter((check) => !check.pass)
evidence.summary = {
  total: evidence.checks.length,
  passed: evidence.checks.length - failed.length,
  failed: failed.length,
}
evidence.status = failed.length === 0 ? 'PASS_NEGATIVE_SECURITY_PROBES' : 'FAIL'

await mkdir(evidenceDir, { recursive: true })
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
console.log(`Sanitized security evidence saved: ${evidencePath}`)
console.log(`Summary: ${evidence.summary.passed}/${evidence.summary.total} probes passed; status=${evidence.status}`)
if (failed.length > 0) process.exitCode = 1
