import { QueueTaskFailure } from './retry-policy.js'

/**
 * The shared transport metadata already present in admitted event schemas.
 *
 * This is intentionally not a complete event schema: the owning event
 * contract must validate its payload/typed fields and allowed extra properties.
 */
export interface EventEnvelopeMetadata {
  readonly eventId: string
  readonly eventType: string
  readonly schemaVersion: string
  readonly producer: string
  readonly resourceType: string
  readonly resourceId: string
  readonly occurredAt: string
  readonly publishedAt: string
  readonly correlationId: string
  readonly causationId: string
  readonly idempotencyKey: string
  readonly attempt: number
  readonly sourceVersion: number
  readonly [key: string]: unknown
}

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,255}$/
const EVENT_TYPE = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:_-]{0,254}$/
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyLabel = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxLength &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/.test(value)

const isDateTime = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const match = DATE_TIME.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[8] === undefined ? 0 : Number(match[8])
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9])
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

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1]! &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  )
}

const invalidEnvelope = (): never => {
  throw new QueueTaskFailure(
    'Event envelope metadata is invalid',
    'poison',
    'INVALID_EVENT_ENVELOPE',
  )
}

/**
 * Validates routing/correlation metadata without normalizing or rewriting the
 * original message. The admitted event-specific validator still must enforce
 * the exact schema, producer semantics, payload rules, and version contract.
 */
export function parseEventEnvelopeMetadata(value: unknown): EventEnvelopeMetadata {
  if (!isRecord(value)) return invalidEnvelope()

  const {
    eventId,
    eventType,
    schemaVersion,
    producer,
    resourceType,
    resourceId,
    occurredAt,
    publishedAt,
    correlationId,
    causationId,
    idempotencyKey,
    attempt,
    sourceVersion,
  } = value

  if (
    typeof eventId !== 'string' ||
    !RESOURCE_ID.test(eventId) ||
    typeof eventType !== 'string' ||
    !EVENT_TYPE.test(eventType) ||
    !isNonEmptyLabel(schemaVersion, 64) ||
    !isNonEmptyLabel(producer, 64) ||
    typeof resourceType !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(resourceType) ||
    typeof resourceId !== 'string' ||
    !RESOURCE_ID.test(resourceId) ||
    !isDateTime(occurredAt) ||
    !isDateTime(publishedAt) ||
    !isNonEmptyLabel(correlationId, 255) ||
    !SAFE_LABEL.test(correlationId) ||
    !isNonEmptyLabel(causationId, 255) ||
    !SAFE_LABEL.test(causationId) ||
    typeof idempotencyKey !== 'string' ||
    !IDEMPOTENCY_KEY.test(idempotencyKey) ||
    !Number.isSafeInteger(attempt) ||
    (attempt as number) < 1 ||
    !Number.isSafeInteger(sourceVersion) ||
    (sourceVersion as number) < 1
  ) {
    return invalidEnvelope()
  }

  // Preserve event-specific fields exactly; no payload rewrite or normalization.
  return value as EventEnvelopeMetadata
}
