import {
  resolveOptionalCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../content/w03-content-client.js'
import {
  TrafficLimitError,
  enforceW01WriteRateLimit,
  rateLimitResponse,
} from '../../../../../auth/traffic-limit.js'
import {
  callW11AnalyticsEvents,
  W11AnalyticsClientError,
  type ClientAnalyticsEvent,
} from '../../../../../analytics/w11-analytics-client.js'

const MAX_BODY_BYTES = 64 * 1024
const MAX_EVENTS = 90
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,159}$/
const FIELD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/
const EVENT_NAMES = new Set([
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
])
const EVENT_KEYS = new Set([
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

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isClientEvent(value: unknown): value is ClientAnalyticsEvent {
  if (!isRecord(value) || Object.keys(value).some((key) => !EVENT_KEYS.has(key))) return false
  return (
    typeof value.eventId === 'string' && EVENT_ID_PATTERN.test(value.eventId) &&
    typeof value.dedupeKey === 'string' && EVENT_ID_PATTERN.test(value.dedupeKey) &&
    typeof value.eventName === 'string' && EVENT_NAMES.has(value.eventName) &&
    typeof value.occurredAt === 'string' && value.occurredAt.length <= 40 &&
    typeof value.sessionId === 'string' && FIELD_ID_PATTERN.test(value.sessionId) &&
    typeof value.contentId === 'string' && FIELD_ID_PATTERN.test(value.contentId) &&
    (value.contentType === 'article' || value.contentType === 'post' || value.contentType === 'video') &&
    (!Object.prototype.hasOwnProperty.call(value, 'durationMs') ||
      (typeof value.durationMs === 'number' && Number.isSafeInteger(value.durationMs) &&
        value.durationMs >= 1 && value.durationMs <= 86_400_000)) &&
    (!Object.prototype.hasOwnProperty.call(value, 'position') ||
      (typeof value.position === 'number' && Number.isFinite(value.position) &&
        value.position >= 0 && value.position <= 100))
  )
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
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export async function POST(request: Request): Promise<Response> {
  try {
    await enforceW01WriteRateLimit(request)

    const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
      return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
    }
    const declaredLength = Number(request.headers.get('Content-Length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Analytics batch exceeds 64 KiB')
    }

    let payload: unknown
    try {
      const text = await readBoundedBody(request)
      if (text === null) return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Analytics batch exceeds 64 KiB')
      payload = JSON.parse(text)
    } catch {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid analytics request body')
    }

    if (
      !isRecord(payload) ||
      Object.keys(payload).length !== 1 ||
      !Array.isArray(payload.events) ||
      payload.events.length < 1 ||
      payload.events.length > MAX_EVENTS ||
      !payload.events.every(isClientEvent)
    ) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid analytics event batch')
    }

    const principal = await resolveOptionalCookieContentPrincipal(request)
    if (principal instanceof Response) return principal
    return await callW11AnalyticsEvents({
      request,
      events: payload.events,
      ...(principal ? { principalUserId: principal.userId } : {}),
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    if (error instanceof W11AnalyticsClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Analytics service unavailable')
  }
}
