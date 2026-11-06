import { persistAuditEvent } from './audit-event-persistence'
import type { AuditActor, AuditEvent } from './audit-event'

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const EVENT_ID = /^evt_[a-f0-9]{32}$/
const REQUEST_ID = /^req_[A-Za-z0-9_-]{1,123}$/
const TRACE_ID = /^[A-Za-z0-9._:-]{1,128}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,255}$/

export type SessionRevokedAuditEvent = {
  eventId: string
  eventType: 'user.session.revoked'
  schemaVersion: '1.0'
  producer: 'W02'
  resourceType: 'Session'
  resourceId: string
  occurredAt: string
  publishedAt: string
  correlationId: string
  causationId: string
  idempotencyKey: string
  attempt: 1
  sourceVersion: 1
  actor: { actorId: string; actorType: 'user' }
  payload: {
    operationId: 'authSessionRevoke'
    result: 'succeeded'
    reasonCode: 'USER_INITIATED'
  }
}

async function assertSessionRevokedEvent(value: unknown): Promise<SessionRevokedAuditEvent> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_AUTH_010_SESSION_EVENT')
  }
  const event = value as Record<string, unknown>
  const actor = event.actor
  const payload = event.payload
  if (!actor || typeof actor !== 'object' || Array.isArray(actor) ||
      !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('INVALID_AUTH_010_SESSION_EVENT')
  }
  const actorValue = actor as Record<string, unknown>
  const payloadValue = payload as Record<string, unknown>
  if (
    typeof event.eventId !== 'string' || !EVENT_ID.test(event.eventId) ||
    event.eventType !== 'user.session.revoked' ||
    event.schemaVersion !== '1.0' ||
    event.producer !== 'W02' ||
    event.resourceType !== 'Session' ||
    typeof event.resourceId !== 'string' || !RESOURCE_ID.test(event.resourceId) ||
    typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt)) ||
    typeof event.publishedAt !== 'string' || !Number.isFinite(Date.parse(event.publishedAt)) ||
    typeof event.correlationId !== 'string' || !REQUEST_ID.test(event.correlationId) ||
    typeof event.causationId !== 'string' || !TRACE_ID.test(event.causationId) ||
    typeof event.idempotencyKey !== 'string' ||
      event.idempotencyKey !== 'AUTH010_SESSION_REVOKE_' + event.eventId.slice(4) ||
    !IDEMPOTENCY_KEY.test(event.idempotencyKey) ||
    event.attempt !== 1 ||
    event.sourceVersion !== 1 ||
    typeof actorValue.actorId !== 'string' || !RESOURCE_ID.test(actorValue.actorId) ||
    actorValue.actorType !== 'user' ||
    Object.keys(actorValue).some((key) => key !== 'actorId' && key !== 'actorType') ||
    Object.keys(payloadValue).some((key) => !['operationId', 'result', 'reasonCode'].includes(key)) ||
    payloadValue.operationId !== 'authSessionRevoke' ||
    payloadValue.result !== 'succeeded' ||
    payloadValue.reasonCode !== 'USER_INITIATED' ||
    Object.keys(event).some((key) => ![
      'eventId', 'eventType', 'schemaVersion', 'producer', 'resourceType', 'resourceId',
      'occurredAt', 'publishedAt', 'correlationId', 'causationId', 'idempotencyKey',
      'attempt', 'sourceVersion', 'actor', 'payload',
    ].includes(key))
  ) {
    throw new Error('INVALID_AUTH_010_SESSION_EVENT')
  }

  const material = 'AUTH010_SESSION_REVOKE:' + actorValue.actorId + ':' + event.resourceId
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  const suffix = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  if (event.eventId !== 'evt_' + suffix) {
    throw new Error('INVALID_AUTH_010_SESSION_EVENT')
  }
  return event as unknown as SessionRevokedAuditEvent
}
type ExistingSessionAuditRow = {
  eventId: string
  requestId: string | null
  traceId: string | null
  actorJson: string
  action: string
  targetType: string
  targetId: string
  beforeJson: string
  afterJson: string
  reason: string | null
  occurredAt: string
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function sameRecord(actual: Record<string, unknown> | null, expected: Record<string, unknown>): boolean {
  if (!actual) return false
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key])
}

function matchesPersisted(existing: ExistingSessionAuditRow, event: SessionRevokedAuditEvent): boolean {
  return existing.eventId === event.eventId &&
    existing.requestId === event.correlationId &&
    existing.traceId === event.causationId &&
    existing.action === event.eventType &&
    existing.targetType === 'Session' &&
    existing.targetId === event.resourceId &&
    existing.reason === 'USER_INITIATED' &&
    existing.occurredAt === event.occurredAt &&
    sameRecord(parseJsonObject(existing.actorJson), { actorId: event.actor.actorId, actorType: 'user' }) &&
    sameRecord(parseJsonObject(existing.beforeJson), { status: 'ACTIVE' }) &&
    sameRecord(parseJsonObject(existing.afterJson), { status: 'REVOKED' })
}

/** Persist a session revocation into W06's canonical immutable AuditEvent store. */
export async function consumeSessionRevokedAuditEvent(
  db: D1Database,
  raw: unknown,
): Promise<'persisted' | 'duplicate'> {
  const event = await assertSessionRevokedEvent(raw)
  const existing = await db.prepare(
    'SELECT event_id AS eventId, request_id AS requestId, trace_id AS traceId, ' +
    'actor_json AS actorJson, action, target_type AS targetType, target_id AS targetId, ' +
    'before_json AS beforeJson, after_json AS afterJson, reason, occurred_at AS occurredAt ' +
    'FROM audit_events WHERE event_id = ? LIMIT 1',
  ).bind(event.eventId).first<ExistingSessionAuditRow>()

  if (existing) {
    if (!matchesPersisted(existing, event)) throw new Error('SESSION_AUDIT_EVENT_IDENTITY_CONFLICT')
    return 'duplicate'
  }

  const auditEvent: AuditEvent = {
    eventId: event.eventId,
    requestId: event.correlationId,
    traceId: event.causationId,
    actor: { actorId: event.actor.actorId, actorType: 'user' } as AuditActor,
    action: event.eventType,
    targetType: 'Session',
    targetId: event.resourceId,
    before: { status: 'ACTIVE' },
    after: { status: 'REVOKED' },
    reason: 'USER_INITIATED',
    occurredAt: event.occurredAt,
  }
  try {
    await persistAuditEvent(db, auditEvent)
    return 'persisted'
  } catch (error) {
    // Two at-least-once deliveries can race after both observe no row. If the
    // unique event_id constraint wins for an identical immutable record, treat
    // the loser as a duplicate; a different record remains a permanent conflict.
    const raced = await db.prepare(
      'SELECT event_id AS eventId, request_id AS requestId, trace_id AS traceId, ' +
      'actor_json AS actorJson, action, target_type AS targetType, target_id AS targetId, ' +
      'before_json AS beforeJson, after_json AS afterJson, reason, occurred_at AS occurredAt ' +
      'FROM audit_events WHERE event_id = ? LIMIT 1',
    ).bind(event.eventId).first<ExistingSessionAuditRow>()
    if (raced) {
      if (!matchesPersisted(raced, event)) throw new Error('SESSION_AUDIT_EVENT_IDENTITY_CONFLICT')
      return 'duplicate'
    }
    throw error
  }
}
