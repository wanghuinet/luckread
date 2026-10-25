const EXPECTED_SCRIPT = 'luckread-w02'
const WINDOW_MS = 30 * 60 * 1000
const MAX_INVOCATIONS = 200
const SAFE_LABELS = Object.freeze({
  tick: 'W02 scheduled publication tick',
  result: 'W02 scheduled publication result',
  taskFailed: 'W02 scheduled publication task failed',
  stageFailed: 'W02 scheduled publication stage failed',
})
const COMMON_EVENT_TYPES = new Set(['fetch', 'scheduled', 'cron', 'queue'])
const W02_SCRIPT_FILTER = Object.freeze({
  key: '$workers.scriptName',
  operation: 'eq',
  type: 'string',
  value: EXPECTED_SCRIPT,
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
    w02InvocationGroups: 0,
    fetchInvocations: 0,
    scheduledEventTypeInvocations: 0,
    cronEventTypeInvocations: 0,
    queueInvocations: 0,
    otherEventTypeInvocations: 0,
    unknownEventTypeInvocations: 0,
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
    const eventTypes = new Set()
    let matchingW02Invocation = false
    let scheduledOutcome = null

    for (const event of events) {
      if (!event || typeof event !== 'object') continue
      const meta = event.$workers && typeof event.$workers === 'object'
        ? event.$workers
        : null
      if (!meta || meta.scriptName !== EXPECTED_SCRIPT) continue

      matchingW02Invocation = true
      if (typeof meta.eventType === 'string' && meta.eventType.length > 0) {
        eventTypes.add(meta.eventType.toLowerCase())
        if ((meta.eventType === 'scheduled' || meta.eventType === 'cron') &&
            typeof meta.outcome === 'string') {
          scheduledOutcome = meta.outcome.toLowerCase()
        }
      }
    }

    if (!matchingW02Invocation) continue
    stats.w02InvocationGroups += 1

    if (eventTypes.has('fetch')) stats.fetchInvocations += 1
    if (eventTypes.has('scheduled')) stats.scheduledEventTypeInvocations += 1
    if (eventTypes.has('cron')) stats.cronEventTypeInvocations += 1
    if (eventTypes.has('queue')) stats.queueInvocations += 1
    if ([...eventTypes].some((type) => !COMMON_EVENT_TYPES.has(type))) {
      stats.otherEventTypeInvocations += 1
    }
    if (eventTypes.size === 0 || eventTypes.has('unknown')) {
      stats.unknownEventTypeInvocations += 1
    }

    const isScheduledInvocation = eventTypes.has('scheduled') || eventTypes.has('cron')
    if (!isScheduledInvocation) continue

    stats.scheduledInvocations += 1
    if (scheduledOutcome === 'ok' || scheduledOutcome === 'success') stats.outcomeOk += 1
    else if (['error', 'exception', 'failure', 'canceled'].includes(scheduledOutcome)) stats.outcomeError += 1
    else stats.outcomeOther += 1

    // Scan only scheduled invocation events in memory. Only fixed labels and
    // numeric aggregates survive; no log body, user data, URL, or event ID is returned.
    let rawContainsTick = false
    let rawContainsResult = false
    let rawContainsTaskFailure = false
    let rawContainsStageFailure = false
    for (const event of events) {
      if (!event || typeof event !== 'object') continue
      let serialized = ''
      try { serialized = JSON.stringify(event) } catch { /* treat as no marker */ }
      rawContainsTick ||= serialized.includes(SAFE_LABELS.tick)
      rawContainsResult ||= serialized.includes(SAFE_LABELS.result)
      rawContainsTaskFailure ||= serialized.includes(SAFE_LABELS.taskFailed)
      rawContainsStageFailure ||= serialized.includes(SAFE_LABELS.stageFailed)
      countSafeDetails(event, stats)
    }
    if (rawContainsTick) stats.tickMarkerInvocations += 1
    if (rawContainsResult) stats.resultMarkerInvocations += 1
    if (rawContainsTaskFailure) stats.taskFailureMarkerInvocations += 1
    if (rawContainsStageFailure) stats.stageFailureMarkerInvocations += 1
  }

  return {
    queriedInvocationGroups: safeCount(stats.queriedInvocationGroups),
    w02InvocationGroups: safeCount(stats.w02InvocationGroups),
    fetchInvocations: safeCount(stats.fetchInvocations),
    scheduledEventTypeInvocations: safeCount(stats.scheduledEventTypeInvocations),
    cronEventTypeInvocations: safeCount(stats.cronEventTypeInvocations),
    queueInvocations: safeCount(stats.queueInvocations),
    otherEventTypeInvocations: safeCount(stats.otherEventTypeInvocations),
    unknownEventTypeInvocations: safeCount(stats.unknownEventTypeInvocations),
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

function safeEventStats(events) {
  const rows = Array.isArray(events) ? events.slice(0, MAX_INVOCATIONS) : null
  if (!rows) return null

  const stats = {
    queriedEventRows: rows.length,
    w02EventRows: 0,
    fetchEventRows: 0,
    scheduledEventRows: 0,
    cronEventRows: 0,
    queueEventRows: 0,
    otherEventTypeRows: 0,
    unknownEventTypeRows: 0,
    tickMarkerRows: 0,
    resultMarkerRows: 0,
    taskFailureMarkerRows: 0,
    stageFailureMarkerRows: 0,
    eventMfaSummaryLogs: 0,
    eventSelected: 0,
    eventPublished: 0,
    eventFailed: 0,
  }
  const details = { selected: 0, published: 0, failed: 0, summaryLogs: 0 }

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const meta = row.$workers && typeof row.$workers === 'object'
      ? row.$workers
      : null
    if (!meta || meta.scriptName !== EXPECTED_SCRIPT) continue

    stats.w02EventRows += 1
    const type = typeof meta.eventType === 'string' ? meta.eventType.toLowerCase() : ''
    if (type === 'fetch') stats.fetchEventRows += 1
    else if (type === 'scheduled') stats.scheduledEventRows += 1
    else if (type === 'cron') stats.cronEventRows += 1
    else if (type === 'queue') stats.queueEventRows += 1
    else if (type === '' || type === 'unknown') stats.unknownEventTypeRows += 1
    else stats.otherEventTypeRows += 1

    // Event payloads are inspected in memory only. No raw event, message,
    // request ID, URL, or user information is returned or persisted.
    let serialized = ''
    try { serialized = JSON.stringify(row) } catch { /* no marker on serialization failure */ }
    if (serialized.includes(SAFE_LABELS.tick)) stats.tickMarkerRows += 1
    if (serialized.includes(SAFE_LABELS.result)) stats.resultMarkerRows += 1
    if (serialized.includes(SAFE_LABELS.taskFailed)) stats.taskFailureMarkerRows += 1
    if (serialized.includes(SAFE_LABELS.stageFailed)) stats.stageFailureMarkerRows += 1
    countSafeDetails(row, details)
  }

  return {
    queriedEventRows: safeCount(stats.queriedEventRows),
    w02EventRows: safeCount(stats.w02EventRows),
    fetchEventRows: safeCount(stats.fetchEventRows),
    scheduledEventRows: safeCount(stats.scheduledEventRows),
    cronEventRows: safeCount(stats.cronEventRows),
    queueEventRows: safeCount(stats.queueEventRows),
    otherEventTypeRows: safeCount(stats.otherEventTypeRows),
    unknownEventTypeRows: safeCount(stats.unknownEventTypeRows),
    tickMarkerRows: safeCount(stats.tickMarkerRows),
    resultMarkerRows: safeCount(stats.resultMarkerRows),
    taskFailureMarkerRows: safeCount(stats.taskFailureMarkerRows),
    stageFailureMarkerRows: safeCount(stats.stageFailureMarkerRows),
    eventMfaSummaryLogs: safeCount(details.summaryLogs),
    eventSelected: safeCount(details.selected),
    eventPublished: safeCount(details.published),
    eventFailed: safeCount(details.failed),
  }
}

async function probeW02EventsView({ accountId, apiToken, now, fetchImpl }) {
  const empty = safeEventStats([])
  const failure = (category, httpStatus = 'NONE') => ({
    eventViewStatus: 'FAIL',
    eventViewCategory: category,
    eventViewHttpStatus: httpStatus,
    ...empty,
  })
  let response
  try {
    response = await fetchImpl(
      'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers/observability/telemetry/query',
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + apiToken,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          queryId: 'auth007-w02-event-diagnostic',
          timeframe: { from: now - WINDOW_MS, to: now },
          view: 'events',
          limit: MAX_INVOCATIONS,
          dry: true,
          parameters: {
            datasets: ['cloudflare-workers'],
            filterCombination: 'and',
            filters: [W02_SCRIPT_FILTER],
          },
        }),
      },
    )
  } catch {
    return failure(CATEGORIES.NETWORK)
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
    return failure(category, response.status)
  }

  let payload
  try { payload = await response.json() } catch {
    return failure(CATEGORIES.RESPONSE, response.status)
  }

  const events = payload?.success === true ? payload.result?.events?.events : null
  const stats = safeEventStats(events)
  if (!stats) return failure(CATEGORIES.RESPONSE, response.status)

  return {
    eventViewStatus: 'PASS',
    eventViewCategory: 'NONE',
    eventViewHttpStatus: response.status,
    ...stats,
  }
}

/**
 * Query Cloudflare Workers Observability without opening a WebSocket tail.
 * Apply the exact W02 script-name filter on the server before result limits,
 * so unrelated Workers cannot crowd scheduled records out of the evidence window.
 * Only fixed labels and safe numeric aggregates survive; event bodies and
 * request identifiers are never logged or persisted.
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
          queryId: 'auth007-w02-invocation-diagnostic',
          timeframe: { from: now - WINDOW_MS, to: now },
          view: 'invocations',
          limit: MAX_INVOCATIONS,
          dry: true,
          parameters: {
            datasets: ['cloudflare-workers'],
            filterCombination: 'and',
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
  const eventsView = await probeW02EventsView({ accountId, apiToken, now, fetchImpl })
  // Query success is not proof that the scheduled handler ran. Publish a separate
  // evidence boolean so callers can fail fast before mutating the live MFA QA account.
  const scheduledExecutionObserved = stats.scheduledInvocations > 0 ||
    stats.tickMarkerInvocations > 0 ||
    safeCount(eventsView.scheduledEventRows) + safeCount(eventsView.cronEventRows) +
      safeCount(eventsView.tickMarkerRows) > 0
  return {
    status: 'PASS',
    category: 'NONE',
    httpStatus: response.status,
    windowMinutes: WINDOW_MS / 60_000,
    ...stats,
    ...eventsView,
    scheduledExecutionObserved,
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
      'queriedInvocationGroups', 'w02InvocationGroups', 'fetchInvocations',
      'scheduledEventTypeInvocations', 'cronEventTypeInvocations', 'queueInvocations',
      'otherEventTypeInvocations', 'unknownEventTypeInvocations',
      'scheduledInvocations', 'scheduledExecutionObserved', 'outcomeOk', 'outcomeError', 'outcomeOther',
      'tickMarkerInvocations', 'resultMarkerInvocations', 'taskFailureMarkerInvocations',
      'stageFailureMarkerInvocations', 'mfaSummaryLogs', 'selected', 'published', 'failed',
    ].map((key) => `${key[0].toLowerCase() + key.slice(1)}=${result[key]}`),
    ...[
      'eventViewStatus', 'eventViewCategory', 'eventViewHttpStatus',
      'queriedEventRows', 'w02EventRows', 'fetchEventRows', 'scheduledEventRows',
      'cronEventRows', 'queueEventRows', 'otherEventTypeRows', 'unknownEventTypeRows',
      'tickMarkerRows', 'resultMarkerRows', 'taskFailureMarkerRows', 'stageFailureMarkerRows',
      'eventMfaSummaryLogs', 'eventSelected', 'eventPublished', 'eventFailed',
    ].map((key) => `${key[0].toLowerCase() + key.slice(1)}=${result[key] ?? (key.startsWith('eventView') ? 'NOT_RUN' : 0)}`),
  ]
  process.stdout.write(`W02_OBSERVABILITY_CRON_DIAGNOSTIC ${fields.join(' ')}\n`)
  if (result.status !== 'PASS') process.exitCode = 1
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname) {
  await main()
}
