const EXPECTED_SCRIPT = 'luckread-w02'
const WINDOW_MS = 10 * 60 * 1000
const MAX_INVOCATIONS = 200
const SAFE_LABELS = Object.freeze({
  tick: 'W02 scheduled publication tick',
  result: 'W02 scheduled publication result',
  taskFailed: 'W02 scheduled publication task failed',
  stageFailed: 'W02 scheduled publication stage failed',
})

const CATEGORIES = Object.freeze({
  CONFIG: 'CONFIGURATION_MISSING',
  AUTH: 'AUTH_OR_PERMISSION',
  SCOPE: 'WORKER_OR_DATASET_NOT_FOUND',
  RATE: 'RATE_LIMITED',
  API: 'CLOUDFLARE_API_FAILURE_REDACTED',
  HTTP: 'HTTP_FAILURE_DETAILS_REDACTED',
  NETWORK: 'NETWORK_OR_CONNECTION',
  RESPONSE: 'MALFORMED_OBSERVABILITY_RESPONSE',
})

const safeCount = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0

function countSafeDetails(node, summary, depth = 0, budget = { nodes: 0 }) {
  if (!node || typeof node !== 'object' || depth > 12 || budget.nodes >= 20_000) return
  budget.nodes += 1

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length && budget.nodes < 20_000; i += 1) {
      const label = node[i]
      const detail = node[i + 1]
      if (label === SAFE_LABELS.result && detail && typeof detail === 'object' &&
          !Array.isArray(detail) && detail.task === 'mfa-audit' &&
          ['selected', 'published', 'failed'].every((key) =>
            Number.isSafeInteger(detail[key]) && detail[key] >= 0)) {
        summary.selected += detail.selected
        summary.published += detail.published
        summary.failed += detail.failed
        summary.summaryLogs += 1
      }
      countSafeDetails(node[i], summary, depth + 1, budget)
    }
    return
  }

  for (const value of Object.values(node)) {
    if (budget.nodes >= 20_000) break
    countSafeDetails(value, summary, depth + 1, budget)
  }
}

function safeInvocationStats(invocations) {
  const groups = Array.isArray(invocations)
    ? invocations.slice(0, MAX_INVOCATIONS)
    : invocations && typeof invocations === 'object'
      ? Object.values(invocations).slice(0, MAX_INVOCATIONS)
      : null
  if (!groups) return null

  const stats = {
    queriedInvocationGroups: groups.length,
    scheduledInvocations: 0,
    outcomeOk: 0,
    outcomeError: 0,
    outcomeOther: 0,
    tickMarkerInvocations: 0,
    resultMarkerInvocations: 0,
    taskFailureMarkerInvocations: 0,
    stageFailureMarkerInvocations: 0,
    selected: 0,
    published: 0,
    failed: 0,
    summaryLogs: 0,
  }

  for (const group of groups) {
    const events = Array.isArray(group) ? group : [group]
    let matchingScheduledInvocation = false
    let outcome = null
    let rawContainsTick = false
    let rawContainsResult = false
    let rawContainsTaskFailure = false
    let rawContainsStageFailure = false

    for (const event of events) {
      if (!event || typeof event !== 'object') continue
      const workers = event.$workers && typeof event.$workers === 'object'
        ? [event.$workers]
        : []
      for (const meta of workers) {
        if (meta.scriptName === EXPECTED_SCRIPT &&
            (meta.eventType === 'scheduled' || meta.eventType === 'cron')) {
          matchingScheduledInvocation = true
          if (typeof meta.outcome === 'string') outcome = meta.outcome.toLowerCase()
        }
      }

      // Scan only the in-memory response. Only booleans and fixed numeric
      // aggregates survive; no log body, user data, URL, or event ID is returned.
      let serialized = ''
      try { serialized = JSON.stringify(event) } catch { /* treat as no marker */ }
      rawContainsTick ||= serialized.includes(SAFE_LABELS.tick)
      rawContainsResult ||= serialized.includes(SAFE_LABELS.result)
      rawContainsTaskFailure ||= serialized.includes(SAFE_LABELS.taskFailed)
      rawContainsStageFailure ||= serialized.includes(SAFE_LABELS.stageFailed)
      countSafeDetails(event, stats)
    }

    if (!matchingScheduledInvocation) continue
    stats.scheduledInvocations += 1
    if (outcome === 'ok' || outcome === 'success') stats.outcomeOk += 1
    else if (['error', 'exception', 'failure', 'canceled'].includes(outcome)) stats.outcomeError += 1
    else stats.outcomeOther += 1
    if (rawContainsTick) stats.tickMarkerInvocations += 1
    if (rawContainsResult) stats.resultMarkerInvocations += 1
    if (rawContainsTaskFailure) stats.taskFailureMarkerInvocations += 1
    if (rawContainsStageFailure) stats.stageFailureMarkerInvocations += 1
  }

  return {
    queriedInvocationGroups: safeCount(stats.queriedInvocationGroups),
    scheduledInvocations: safeCount(stats.scheduledInvocations),
    outcomeOk: safeCount(stats.outcomeOk),
    outcomeError: safeCount(stats.outcomeError),
    outcomeOther: safeCount(stats.outcomeOther),
    tickMarkerInvocations: safeCount(stats.tickMarkerInvocations),
    resultMarkerInvocations: safeCount(stats.resultMarkerInvocations),
    taskFailureMarkerInvocations: safeCount(stats.taskFailureMarkerInvocations),
    stageFailureMarkerInvocations: safeCount(stats.stageFailureMarkerInvocations),
    mfaSummaryLogs: safeCount(stats.summaryLogs),
    selected: safeCount(stats.selected),
    published: safeCount(stats.published),
    failed: safeCount(stats.failed),
  }
}

/**
 * Query Cloudflare Workers Observability without opening a WebSocket tail.
 * The query is dry-run and limited to a ten-minute time window. The API
 * response is held in memory and reduced to fixed counters only.
 */
export async function probeW02ScheduledObservability({
  accountId,
  apiToken,
  now = Date.now(),
  fetchImpl = globalThis.fetch,
}) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '') ||
      typeof apiToken !== 'string' || apiToken.length < 20 ||
      typeof fetchImpl !== 'function' ||
      !Number.isSafeInteger(now) || now <= WINDOW_MS) {
    return {
      status: 'FAIL',
      category: CATEGORIES.CONFIG,
      httpStatus: 'NONE',
      windowMinutes: WINDOW_MS / 60_000,
      ...safeInvocationStats({}),
    }
  }

  let response
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiToken}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          queryId: 'auth007-w02-scheduled-observability-diagnostic',
          timeframe: { from: now - WINDOW_MS, to: now },
          view: 'invocations',
          limit: MAX_INVOCATIONS,
          dry: true,
          parameters: {
            datasets: ['cloudflare-workers'],
            filterCombination: 'and',
            filters: [
              { key: '$workers.scriptName', operation: 'eq', type: 'string', value: EXPECTED_SCRIPT },
              { key: '$workers.eventType', operation: 'in', type: 'string', value: 'scheduled,cron' },
            ],
          },
        }),
      },
    )
  } catch {
    return {
      status: 'FAIL',
      category: CATEGORIES.NETWORK,
      httpStatus: 'NONE',
      windowMinutes: WINDOW_MS / 60_000,
      ...safeInvocationStats({}),
    }
  }

  if (!response.ok) {
    const category = response.status === 401 || response.status === 403
      ? CATEGORIES.AUTH
      : response.status === 404
        ? CATEGORIES.SCOPE
        : response.status === 429
          ? CATEGORIES.RATE
          : response.status >= 500
            ? CATEGORIES.API
            : CATEGORIES.HTTP
    return {
      status: 'FAIL',
      category,
      httpStatus: response.status,
      windowMinutes: WINDOW_MS / 60_000,
      ...safeInvocationStats({}),
    }
  }

  let payload
  try { payload = await response.json() } catch {
    return {
      status: 'FAIL',
      category: CATEGORIES.RESPONSE,
      httpStatus: response.status,
      windowMinutes: WINDOW_MS / 60_000,
      ...safeInvocationStats({}),
    }
  }

  const invocations = payload?.success === true ? payload.result?.invocations : null
  const stats = safeInvocationStats(invocations)
  if (!stats) {
    return {
      status: 'FAIL',
      category: CATEGORIES.RESPONSE,
      httpStatus: response.status,
      windowMinutes: WINDOW_MS / 60_000,
      ...safeInvocationStats({}),
    }
  }
  return {
    status: 'PASS',
    category: 'NONE',
    httpStatus: response.status,
    windowMinutes: WINDOW_MS / 60_000,
    ...stats,
  }
}

async function main() {
  const result = await probeW02ScheduledObservability({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
  })
  const fields = [
    `status=${result.status}`,
    `category=${result.category}`,
    `http_status=${result.httpStatus}`,
    `window_minutes=${result.windowMinutes}`,
    ...[
      'scheduledInvocations', 'outcomeOk', 'outcomeError', 'outcomeOther',
      'tickMarkerInvocations', 'resultMarkerInvocations', 'taskFailureMarkerInvocations',
      'stageFailureMarkerInvocations', 'mfaSummaryLogs', 'selected', 'published', 'failed',
    ].map((key) => `${key[0].toLowerCase() + key.slice(1)}=${result[key]}`),
  ]
  process.stdout.write(`W02_OBSERVABILITY_CRON_DIAGNOSTIC ${fields.join(' ')}\n`)
  if (result.status !== 'PASS') process.exitCode = 1
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  await main()
}
