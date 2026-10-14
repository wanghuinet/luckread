export const ANALYTICS_EVENT_SCHEMA_VERSION = '1.0' as const

/**
 * Bound one persistence transaction to 90 event INSERTs plus three projection
 * statements (93 D1 batch statements total). Every INSERT binds only 16 values,
 * staying below Cloudflare D1's 100-bound-parameter per-query limit.
 */
export const ANALYTICS_MAX_BATCH_SIZE = 90 as const

export const ANALYTICS_EVENT_NAMES = [
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
  'like_created',
  'comment_created',
  'share_created',
  'favorite_created',
  'follow_created',
  'follow_removed',
] as const

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number]
export type AnalyticsContentType = 'article' | 'post' | 'video'
export type AnalyticsSourceWorker = 'W03' | 'W05'
export type AnalyticsActorType = 'user' | 'visitor'
export type AnalyticsEventQuality =
  | 'VALID'
  | 'SUSPECT'
  | 'INVALID'
  | 'DUPLICATE'
  | 'LATE'
  | 'REJECTED'

export interface AnalyticsEvent {
  eventId: string
  schemaVersion: typeof ANALYTICS_EVENT_SCHEMA_VERSION
  eventName: AnalyticsEventName
  sourceWorker: AnalyticsSourceWorker
  occurredAt: string
  receivedAt: string
  dedupeKey: string
  actorType: AnalyticsActorType
  actorId?: string
  visitorId?: string
  sessionId?: string
  contentId?: string
  contentType?: AnalyticsContentType
  creatorId?: string
  durationMs?: number
  position?: number
  correlationId?: string
}

export interface AnalyticsEventOutcome {
  quality: AnalyticsEventQuality
  reason: string
  eventId?: string
  event?: AnalyticsEvent
}

export interface AnalyticsBatchOptions {
  /** Current server time in epoch milliseconds; injected to keep decisions deterministic. */
  now: number
  /** Idempotency keys already persisted by the caller's storage adapter. */
  knownEventIds?: ReadonlySet<string>
  knownDedupeKeys?: ReadonlySet<string>
  /** Events older than this are routed to a late-event path, not trusted live metrics. */
  maxLatenessMs?: number
  /** Tolerance for producer/client clock skew. */
  allowedFutureSkewMs?: number
}

export interface AnalyticsBatchResult {
  outcomes: AnalyticsEventOutcome[]
  accepted: AnalyticsEvent[]
  counts: Record<AnalyticsEventQuality, number>
}

const EVENT_NAME_SET = new Set<string>(ANALYTICS_EVENT_NAMES)
const SOCIAL_EVENT_NAMES = new Set<AnalyticsEventName>([
  'like_created',
  'comment_created',
  'share_created',
  'favorite_created',
  'follow_created',
  'follow_removed',
])
const CONTENT_EVENT_NAMES = new Set<AnalyticsEventName>(
  ANALYTICS_EVENT_NAMES.filter((name) => !SOCIAL_EVENT_NAMES.has(name)),
)
const CONTENT_SOCIAL_EVENT_NAMES = new Set<AnalyticsEventName>([
  'like_created',
  'comment_created',
  'share_created',
  'favorite_created',
])
const VIDEO_EVENT_NAMES = new Set<AnalyticsEventName>([
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
const ARTICLE_EVENT_NAMES = new Set<AnalyticsEventName>([
  'read_start',
  'read_progress_25',
  'read_progress_50',
  'read_progress_75',
  'read_complete',
  'read_dwell',
])
const POST_EVENT_NAMES = new Set<AnalyticsEventName>(['dwell', 'complete_view'])
const DURATION_EVENT_NAMES = new Set<AnalyticsEventName>([
  'read_dwell',
  'dwell',
  'video_watch',
])
const VALID_CONTENT_TYPES = new Set<string>(['article', 'post', 'video'])
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,159}$/
const FIELD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/

const DEFAULT_MAX_LATENESS_MS = 24 * 60 * 60 * 1000
const DEFAULT_ALLOWED_FUTURE_SKEW_MS = 5 * 60 * 1000
const MAX_EVENT_DURATION_MS = 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFieldId(value: unknown): value is string {
  return typeof value === 'string' && FIELD_ID_PATTERN.test(value)
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = TIMESTAMP_PATTERN.exec(value)
  if (!match) return undefined

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHours = match[8] === undefined ? 0 : Number(match[9])
  const offsetMinutes = match[8] === undefined ? 0 : Number(match[10])

  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHours > 23 ||
    offsetMinutes > 59
  ) {
    return undefined
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  if (day < 1 || day > (daysInMonth[month - 1] ?? 0)) return undefined

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function outcome(
  quality: AnalyticsEventQuality,
  reason: string,
  event?: AnalyticsEvent,
  eventId?: string,
): AnalyticsEventOutcome {
  return {
    quality,
    reason,
    ...(event ? { event } : {}),
    ...(eventId ? { eventId } : {}),
  }
}

function validateOptions(options: AnalyticsBatchOptions): {
  maxLatenessMs: number
  allowedFutureSkewMs: number
} {
  if (!Number.isFinite(options.now)) {
    throw new RangeError('now must be a finite epoch-millisecond timestamp')
  }

  const maxLatenessMs = options.maxLatenessMs ?? DEFAULT_MAX_LATENESS_MS
  const allowedFutureSkewMs =
    options.allowedFutureSkewMs ?? DEFAULT_ALLOWED_FUTURE_SKEW_MS

  if (!Number.isSafeInteger(maxLatenessMs) || maxLatenessMs < 0) {
    throw new RangeError('maxLatenessMs must be a non-negative safe integer')
  }
  if (
    !Number.isSafeInteger(allowedFutureSkewMs) ||
    allowedFutureSkewMs < 0
  ) {
    throw new RangeError(
      'allowedFutureSkewMs must be a non-negative safe integer',
    )
  }

  return { maxLatenessMs, allowedFutureSkewMs }
}

/**
 * Validate and normalize one event without writing storage or trusting arbitrary
 * client properties. A caller must persist accepted idempotency keys before
 * treating this in-memory decision as durable deduplication.
 */
export function validateAnalyticsEvent(
  value: unknown,
  options: AnalyticsBatchOptions,
): AnalyticsEventOutcome {
  const { maxLatenessMs, allowedFutureSkewMs } = validateOptions(options)
  if (!isRecord(value)) return outcome('INVALID', 'EVENT_MUST_BE_AN_OBJECT')

  const candidateEventId =
    typeof value.eventId === 'string' ? value.eventId : undefined

  if (
    typeof value.eventId !== 'string' ||
    !EVENT_ID_PATTERN.test(value.eventId)
  ) {
    return outcome('INVALID', 'INVALID_EVENT_ID', undefined, candidateEventId)
  }
  if (
    typeof value.dedupeKey !== 'string' ||
    !EVENT_ID_PATTERN.test(value.dedupeKey)
  ) {
    return outcome('INVALID', 'INVALID_DEDUPE_KEY', undefined, candidateEventId)
  }
  if (value.schemaVersion !== ANALYTICS_EVENT_SCHEMA_VERSION) {
    return outcome(
      'REJECTED',
      'UNSUPPORTED_SCHEMA_VERSION',
      undefined,
      candidateEventId,
    )
  }
  if (typeof value.eventName !== 'string') {
    return outcome('INVALID', 'INVALID_EVENT_NAME', undefined, candidateEventId)
  }
  if (!EVENT_NAME_SET.has(value.eventName)) {
    return outcome(
      'REJECTED',
      'UNSUPPORTED_EVENT_NAME',
      undefined,
      candidateEventId,
    )
  }

  const eventName = value.eventName as AnalyticsEventName
  const isSocialEvent = SOCIAL_EVENT_NAMES.has(eventName)
  const expectedSourceWorker: AnalyticsSourceWorker = isSocialEvent ? 'W05' : 'W03'
  if (value.sourceWorker !== expectedSourceWorker) {
    return outcome(
      'REJECTED',
      'SOURCE_WORKER_NOT_AUTHORIZED_FOR_EVENT',
      undefined,
      candidateEventId,
    )
  }

  if (value.actorType !== 'user' && value.actorType !== 'visitor') {
    return outcome('INVALID', 'INVALID_ACTOR_TYPE', undefined, candidateEventId)
  }
  if (value.actorType === 'user' && !isFieldId(value.actorId)) {
    return outcome('INVALID', 'ACTOR_ID_REQUIRED', undefined, candidateEventId)
  }
  if (value.actorType === 'visitor' && !isFieldId(value.visitorId)) {
    return outcome('INVALID', 'VISITOR_ID_REQUIRED', undefined, candidateEventId)
  }
  if (isSocialEvent && value.actorType !== 'user') {
    return outcome(
      'INVALID',
      'SOCIAL_EVENTS_REQUIRE_AUTHENTICATED_ACTOR',
      undefined,
      candidateEventId,
    )
  }

  if (
    value.contentType !== undefined &&
    (typeof value.contentType !== 'string' || !VALID_CONTENT_TYPES.has(value.contentType))
  ) {
    return outcome('INVALID', 'INVALID_CONTENT_TYPE', undefined, candidateEventId)
  }

  if (
    CONTENT_SOCIAL_EVENT_NAMES.has(eventName) &&
    !VALID_CONTENT_TYPES.has(String(value.contentType))
  ) {
    return outcome(
      'INVALID',
      'CONTENT_SOCIAL_EVENT_REQUIRES_CONTENT_TYPE',
      undefined,
      candidateEventId,
    )
  }

  if (CONTENT_EVENT_NAMES.has(eventName)) {
    if (!isFieldId(value.contentId)) {
      return outcome('INVALID', 'CONTENT_ID_REQUIRED', undefined, candidateEventId)
    }
    if (
      typeof value.contentType !== 'string' ||
      !VALID_CONTENT_TYPES.has(value.contentType)
    ) {
      return outcome('INVALID', 'INVALID_CONTENT_TYPE', undefined, candidateEventId)
    }
    if (!isFieldId(value.sessionId)) {
      return outcome('INVALID', 'SESSION_ID_REQUIRED', undefined, candidateEventId)
    }
  } else if (eventName === 'follow_created' || eventName === 'follow_removed') {
    if (!isFieldId(value.creatorId)) {
      return outcome('INVALID', 'CREATOR_ID_REQUIRED', undefined, candidateEventId)
    }
  } else if (!isFieldId(value.contentId)) {
    return outcome('INVALID', 'CONTENT_ID_REQUIRED', undefined, candidateEventId)
  }

  if (VIDEO_EVENT_NAMES.has(eventName) && value.contentType !== 'video') {
    return outcome(
      'INVALID',
      'VIDEO_EVENT_REQUIRES_VIDEO_CONTENT',
      undefined,
      candidateEventId,
    )
  }
  if (ARTICLE_EVENT_NAMES.has(eventName) && value.contentType !== 'article') {
    return outcome(
      'INVALID',
      'READ_EVENT_REQUIRES_ARTICLE_CONTENT',
      undefined,
      candidateEventId,
    )
  }
  if (POST_EVENT_NAMES.has(eventName) && value.contentType !== 'post') {
    return outcome(
      'INVALID',
      'POST_EVENT_REQUIRES_POST_CONTENT',
      undefined,
      candidateEventId,
    )
  }

  if (DURATION_EVENT_NAMES.has(eventName)) {
    if (
      typeof value.durationMs !== 'number' ||
      !Number.isSafeInteger(value.durationMs) ||
      value.durationMs <= 0 ||
      value.durationMs > MAX_EVENT_DURATION_MS
    ) {
      return outcome('INVALID', 'INVALID_DURATION_MS', undefined, candidateEventId)
    }
  } else if (value.durationMs !== undefined) {
    return outcome(
      'INVALID',
      'DURATION_NOT_ALLOWED_FOR_EVENT',
      undefined,
      candidateEventId,
    )
  }

  if (
    value.position !== undefined &&
    (typeof value.position !== 'number' ||
      !Number.isFinite(value.position) ||
      value.position < 0 ||
      value.position > 100)
  ) {
    return outcome('INVALID', 'INVALID_POSITION', undefined, candidateEventId)
  }
  if (value.correlationId !== undefined && !isFieldId(value.correlationId)) {
    return outcome('INVALID', 'INVALID_CORRELATION_ID', undefined, candidateEventId)
  }

  const occurredAtMs = parseTimestamp(value.occurredAt)
  const receivedAtMs = parseTimestamp(value.receivedAt)
  if (occurredAtMs === undefined || receivedAtMs === undefined) {
    return outcome(
      'INVALID',
      'INVALID_EVENT_TIMESTAMP',
      undefined,
      candidateEventId,
    )
  }

  const event: AnalyticsEvent = {
    eventId: value.eventId,
    schemaVersion: ANALYTICS_EVENT_SCHEMA_VERSION,
    eventName,
    sourceWorker: expectedSourceWorker,
    occurredAt: value.occurredAt as string,
    receivedAt: value.receivedAt as string,
    dedupeKey: value.dedupeKey,
    actorType: value.actorType,
    ...(value.actorType === 'user' && typeof value.actorId === 'string'
      ? { actorId: value.actorId }
      : {}),
    ...(value.actorType === 'visitor' && typeof value.visitorId === 'string'
      ? { visitorId: value.visitorId }
      : {}),
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(typeof value.contentId === 'string' ? { contentId: value.contentId } : {}),
    ...(typeof value.contentType === 'string'
      ? { contentType: value.contentType as AnalyticsContentType }
      : {}),
    ...(typeof value.creatorId === 'string' ? { creatorId: value.creatorId } : {}),
    ...(typeof value.durationMs === 'number' ? { durationMs: value.durationMs } : {}),
    ...(typeof value.position === 'number' ? { position: value.position } : {}),
    ...(typeof value.correlationId === 'string'
      ? { correlationId: value.correlationId }
      : {}),
  }

  if (
    occurredAtMs > options.now + allowedFutureSkewMs ||
    occurredAtMs > receivedAtMs + allowedFutureSkewMs ||
    receivedAtMs > options.now + allowedFutureSkewMs
  ) {
    return outcome('SUSPECT', 'EVENT_TIMESTAMP_OUTSIDE_CLOCK_SKEW', event)
  }
  if (options.now - occurredAtMs > maxLatenessMs) {
    return outcome('LATE', 'EVENT_EXCEEDS_LIVE_LATENESS_WINDOW', event)
  }

  return outcome('VALID', 'EVENT_ACCEPTED', event)
}

/**
 * Apply bounded, deterministic deduplication to a batch. knownEventIds and
 * knownDedupeKeys should be loaded from the caller's durable idempotency store.
 * This function itself deliberately performs no D1, Queue, or network writes.
 */
export function processAnalyticsBatch(
  values: readonly unknown[],
  options: AnalyticsBatchOptions,
): AnalyticsBatchResult {
  validateOptions(options)
  if (values.length > ANALYTICS_MAX_BATCH_SIZE) {
    throw new RangeError(
      `batch exceeds the ${ANALYTICS_MAX_BATCH_SIZE}-event limit`,
    )
  }

  const seenEventIds = new Set(options.knownEventIds ?? [])
  const seenDedupeKeys = new Set(options.knownDedupeKeys ?? [])
  const counts: Record<AnalyticsEventQuality, number> = {
    VALID: 0,
    SUSPECT: 0,
    INVALID: 0,
    DUPLICATE: 0,
    LATE: 0,
    REJECTED: 0,
  }
  const outcomes: AnalyticsEventOutcome[] = []
  const accepted: AnalyticsEvent[] = []

  for (const value of values) {
    const result = validateAnalyticsEvent(value, options)
    if (result.quality !== 'VALID' || !result.event) {
      outcomes.push(result)
      counts[result.quality] += 1
      continue
    }

    if (seenEventIds.has(result.event.eventId)) {
      const duplicate = outcome(
        'DUPLICATE',
        'DUPLICATE_EVENT_ID',
        undefined,
        result.event.eventId,
      )
      outcomes.push(duplicate)
      counts.DUPLICATE += 1
      continue
    }
    if (seenDedupeKeys.has(result.event.dedupeKey)) {
      const duplicate = outcome(
        'DUPLICATE',
        'DUPLICATE_DEDUPE_KEY',
        undefined,
        result.event.eventId,
      )
      outcomes.push(duplicate)
      counts.DUPLICATE += 1
      continue
    }

    seenEventIds.add(result.event.eventId)
    seenDedupeKeys.add(result.event.dedupeKey)
    accepted.push(result.event)
    outcomes.push(result)
    counts.VALID += 1
  }

  return { outcomes, accepted, counts }
}
