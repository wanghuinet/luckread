import { ingestAnalyticsBatch } from './analytics-ingest'
import type {
  AnalyticsD1Database,
  AnalyticsD1PreparedStatement,
} from './analytics-d1-store'

interface AnalyticsSchemaObject {
  type: string
  name: string
  sql?: string | null
}

interface AnalyticsHealthStatement extends AnalyticsD1PreparedStatement {
  first(): Promise<{ ok: number } | null>
  all(): Promise<{ results?: AnalyticsSchemaObject[] }>
}

type W11AnalyticsDatabase = AnalyticsD1Database & {
  prepare(query: string): AnalyticsHealthStatement
}

export interface W11Env {
  D1_05: W11AnalyticsDatabase
}

const REQUIRED_SCHEMA_OBJECTS = [
  { type: 'table', name: 'analytics_event_dedupe' },
  { type: 'table', name: 'analytics_content_hourly' },
  { type: 'table', name: 'analytics_creator_hourly' },
  { type: 'table', name: 'analytics_rollup_watermark' },
  { type: 'table', name: 'analytics_reconciliation_status' },
  { type: 'table', name: 'analytics_projection_rebuild_state' },
  { type: 'index', name: 'analytics_event_dedupe_ingested_at_idx' },
  { type: 'index', name: 'analytics_event_dedupe_occurred_at_idx' },
  { type: 'index', name: 'analytics_event_dedupe_hour_start_idx' },
  { type: 'index', name: 'analytics_event_dedupe_pending_idx' },
  { type: 'index', name: 'analytics_content_hourly_content_time_idx' },
  { type: 'index', name: 'analytics_content_hourly_content_id_time_idx' },
  { type: 'index', name: 'analytics_content_hourly_time_idx' },
  { type: 'index', name: 'analytics_creator_hourly_creator_time_idx' },
] as const

const ANALYTICS_SCHEMA_PROBE = `
  SELECT type, name, sql
  FROM sqlite_master
  WHERE
    (type = 'table' AND name IN (
      'analytics_event_dedupe',
      'analytics_content_hourly',
      'analytics_creator_hourly',
      'analytics_rollup_watermark',
      'analytics_reconciliation_status',
      'analytics_projection_rebuild_state'
    ))
    OR
    (type = 'index' AND name IN (
      'analytics_event_dedupe_ingested_at_idx',
      'analytics_event_dedupe_occurred_at_idx',
      'analytics_event_dedupe_hour_start_idx',
      'analytics_event_dedupe_pending_idx',
      'analytics_content_hourly_content_time_idx',
      'analytics_content_hourly_content_id_time_idx',
      'analytics_content_hourly_time_idx',
      'analytics_creator_hourly_creator_time_idx'
    ))
`

const MAX_INGEST_BODY_BYTES = 64 * 1024
const INTERNAL_CORRELATION_PATTERN = /^[A-Za-z0-9:_-]{8,255}$/
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,159}$/
const FIELD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/

const CLIENT_TELEMETRY_EVENT_NAMES = [
  'content_impression',
  'content_open',
  'read_start',
  'read_progress_25',
  'read_progress_50',
  'read_progress_75',
  'read_complete',
  'read_dwell',
  'dwell',
  'complete_view',
  'video_impression',
  'video_play_request',
  'video_play_success',
  'video_progress_25',
  'video_progress_50',
  'video_progress_75',
  'video_progress_90',
  'video_complete',
  'video_replay',
  'video_watch',
] as const
type ClientTelemetryEventName = (typeof CLIENT_TELEMETRY_EVENT_NAMES)[number]
const CLIENT_TELEMETRY_EVENT_NAME_SET = new Set<string>(CLIENT_TELEMETRY_EVENT_NAMES)
const CLIENT_TELEMETRY_EVENT_KEYS = new Set([
  'eventId',
  'dedupeKey',
  'eventName',
  'occurredAt',
  'sessionId',
  'contentId',
  'contentType',
  'durationMs',
  'position',
])

interface ClientTelemetryEvent {
  eventId: string
  dedupeKey: string
  eventName: ClientTelemetryEventName
  occurredAt: string
  sessionId: string
  contentId: string
  contentType: 'article' | 'post' | 'video'
  durationMs?: number
  position?: number
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })

const errorResponse = (
  status: number,
  code: string,
  message: string,
  requestId = crypto.randomUUID(),
): Response => jsonResponse({
  error: { code, message, details: {} },
  requestId,
}, status)

const notFound = (): Response =>
  new Response('Not Found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isClientTelemetryEvent(value: unknown): value is ClientTelemetryEvent {
  if (!isRecord(value) || Object.keys(value).some((key) => !CLIENT_TELEMETRY_EVENT_KEYS.has(key))) {
    return false
  }
  if (
    typeof value.eventId !== 'string' || !EVENT_ID_PATTERN.test(value.eventId) ||
    typeof value.dedupeKey !== 'string' || !EVENT_ID_PATTERN.test(value.dedupeKey) ||
    typeof value.eventName !== 'string' || !CLIENT_TELEMETRY_EVENT_NAME_SET.has(value.eventName) ||
    typeof value.occurredAt !== 'string' || value.occurredAt.length > 40 ||
    typeof value.sessionId !== 'string' || !FIELD_ID_PATTERN.test(value.sessionId) ||
    typeof value.contentId !== 'string' || !FIELD_ID_PATTERN.test(value.contentId) ||
    (value.contentType !== 'article' && value.contentType !== 'post' && value.contentType !== 'video')
  ) {
    return false
  }

  if (
    Object.prototype.hasOwnProperty.call(value, 'durationMs') &&
    (typeof value.durationMs !== 'number' || !Number.isSafeInteger(value.durationMs) ||
      value.durationMs < 1 || value.durationMs > 86_400_000)
  ) return false

  if (
    Object.prototype.hasOwnProperty.call(value, 'position') &&
    (typeof value.position !== 'number' || !Number.isFinite(value.position) ||
      value.position < 0 || value.position > 100)
  ) return false

  return true
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_INGEST_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(result)
}

async function ingestClientTelemetry(request: Request, env: W11Env): Promise<Response> {
  const correlationId = request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
    !INTERNAL_CORRELATION_PATTERN.test(correlationId)
  ) {
    return notFound()
  }

  const principalUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
  if (principalUserId && !FIELD_ID_PATTERN.test(principalUserId)) {
    return errorResponse(403, 'INVALID_PRINCIPAL', 'Invalid trusted principal', correlationId)
  }

  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', correlationId)
  }
  const declaredLength = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INGEST_BODY_BYTES) {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Analytics batch exceeds 64 KiB', correlationId)
  }

  let payload: unknown
  try {
    const text = await readBoundedBody(request)
    if (text === null) {
      return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Analytics batch exceeds 64 KiB', correlationId)
    }
    payload = JSON.parse(text)
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid analytics request body', correlationId)
  }

  if (
    !isRecord(payload) ||
    Object.keys(payload).length !== 1 ||
    !Array.isArray(payload.events) ||
    payload.events.length < 1 ||
    payload.events.length > 90 ||
    !payload.events.every(isClientTelemetryEvent)
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid analytics event batch', correlationId)
  }

  const now = Date.now()
  const receivedAt = new Date(now).toISOString()
  const events = payload.events.map((event) => ({
    ...event,
    schemaVersion: '1.0' as const,
    sourceWorker: 'W01' as const,
    receivedAt,
    actorType: principalUserId ? 'user' as const : 'visitor' as const,
    ...(principalUserId
      ? { actorId: principalUserId }
      : { visitorId: event.sessionId }),
    correlationId,
  }))

  try {
    const result = await ingestAnalyticsBatch(env.D1_05, events, { now })
    return jsonResponse({
      data: {
        received: events.length,
        qualityCounts: result.quality.counts,
        persistence: {
          attempted: result.persistence.attempted,
          inserted: result.persistence.inserted,
          duplicates: result.persistence.duplicates,
          lateAttempted: result.persistence.lateAttempted,
          lateInserted: result.persistence.lateInserted,
          lateDuplicates: result.persistence.lateDuplicates,
        },
      },
      requestId: correlationId,
    })
  } catch {
    return errorResponse(503, 'ANALYTICS_UNAVAILABLE', 'Analytics ingestion is temporarily unavailable', correlationId)
  }
}

const worker = {
  async fetch(request: Request, env: W11Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/internal/analytics/events') {
      if (request.method !== 'POST') return notFound()
      return ingestClientTelemetry(request, env)
    }

    if (
      request.method !== 'GET' ||
      (url.pathname !== '/healthz' && url.pathname !== '/readyz')
    ) {
      return notFound()
    }

    if (url.pathname === '/healthz') {
      try {
        const probe = await env.D1_05.prepare('SELECT 1 AS ok').first()
        if (probe?.ok !== 1) throw new Error('D1-05 health probe returned no result')
        return jsonResponse({ worker: 'W11', status: 'ok', database: 'reachable' })
      } catch {
        return jsonResponse({ worker: 'W11', status: 'degraded', database: 'unavailable' }, 503)
      }
    }

    try {
      const result = await env.D1_05.prepare(ANALYTICS_SCHEMA_PROBE).all()
      const schemaRows = result.results ?? []
      const found = new Set(schemaRows.map(({ type, name }) => `${type}:${name}`))
      const eventLedgerDefinition = schemaRows.find(
        ({ type, name }) => type === 'table' && name === 'analytics_event_dedupe',
      )?.sql?.toUpperCase() ?? ''
      const lateEventSchemaReady =
        eventLedgerDefinition.includes('PROJECTION_STATUS') &&
        eventLedgerDefinition.includes("'LATE'")
      const clientTelemetrySchemaReady =
        eventLedgerDefinition.includes('SOURCE_WORKER') &&
        eventLedgerDefinition.includes("'W01'") &&
        eventLedgerDefinition.includes("'W03'") &&
        eventLedgerDefinition.includes("'W05'")
      const schemaReady =
        lateEventSchemaReady &&
        clientTelemetrySchemaReady &&
        REQUIRED_SCHEMA_OBJECTS.every(({ type, name }) =>
          found.has(`${type}:${name}`),
        )

      if (!schemaReady) {
        return jsonResponse({
          worker: 'W11',
          status: 'not_ready',
          database: 'reachable',
          schema: 'incomplete',
        }, 503)
      }

      return jsonResponse({
        worker: 'W11',
        status: 'ready',
        database: 'reachable',
        schema: 'ready',
      })
    } catch {
      return jsonResponse({
        worker: 'W11',
        status: 'degraded',
        database: 'unavailable',
        schema: 'unknown',
      }, 503)
    }
  },
}

export default worker
