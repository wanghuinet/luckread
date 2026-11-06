import { parseEventEnvelopeMetadata } from '../../../W10-async/src/event-envelope.js'

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const REQUEST_ID = /^req_[A-Za-z0-9_-]{1,123}$/
const TRACE_ID = /^[A-Za-z0-9._:-]{1,128}$/

export type SessionRevokedEvent = {
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

export async function buildSessionRevokedEvent(input: {
  sessionId: string
  userId: string
  occurredAt?: string
  correlationId?: string | null
  causationId?: string | null
}): Promise<SessionRevokedEvent> {
  if (!RESOURCE_ID.test(input.sessionId) || !RESOURCE_ID.test(input.userId)) {
    throw new TypeError('invalid session revocation event subject')
  }
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(occurredAt))) throw new TypeError('invalid session revocation event timestamp')

  // A stable identity makes duplicate/retried revoke requests publish one
  // logical event only. The raw session token is never read into this event.
  const material = 'AUTH010_SESSION_REVOKE:' + input.userId + ':' + input.sessionId
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  const suffix = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const eventId = 'evt_' + suffix
  // AuditEvent.requestId has the canonical req_ shape. W01 passes its
  // request ID as correlationId; the independent correlation/trace header
  // remains causationId and is stored in AuditEvent.traceId.
  const correlationId = input.correlationId && REQUEST_ID.test(input.correlationId)
    ? input.correlationId
    : 'req_' + suffix
  const causationId = input.causationId && TRACE_ID.test(input.causationId)
    ? input.causationId
    : eventId

  return {
    eventId,
    eventType: 'user.session.revoked',
    schemaVersion: '1.0',
    producer: 'W02',
    resourceType: 'Session',
    resourceId: input.sessionId,
    occurredAt,
    publishedAt: new Date().toISOString(),
    correlationId,
    causationId,
    idempotencyKey: 'AUTH010_SESSION_REVOKE_' + suffix,
    attempt: 1,
    sourceVersion: 1,
    actor: { actorId: input.userId, actorType: 'user' },
    payload: {
      operationId: 'authSessionRevoke',
      result: 'succeeded',
      reasonCode: 'USER_INITIATED',
    },
  }
}

/**
 * The caller batches the session DELETE immediately before this statement.
 * changes() therefore inserts the durable event only when that DELETE
 * actually removed one caller-owned session row.
 */
export function buildSessionRevocationOutboxInsert(
  db: D1Database,
  event: SessionRevokedEvent,
): D1PreparedStatement {
  return db.prepare(
    'INSERT INTO auth_010_session_revocation_journal ' +
    '(journal_id, event_id, event_type, schema_version, resource_id, source_version, idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
    'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1',
  ).bind(
    crypto.randomUUID(),
    event.eventId,
    event.eventType,
    event.schemaVersion,
    event.resourceId,
    event.sourceVersion,
    event.idempotencyKey,
    JSON.stringify(event),
    'PENDING',
    1,
    null,
    event.publishedAt,
    null,
    null,
  )
}

export function assertSessionRevokedEvent(value: unknown): asserts value is SessionRevokedEvent {
  const envelope = parseEventEnvelopeMetadata(value)
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
    envelope.eventType !== 'user.session.revoked' ||
    envelope.schemaVersion !== '1.0' ||
    envelope.producer !== 'W02' ||
    envelope.resourceType !== 'Session' ||
    !RESOURCE_ID.test(envelope.resourceId) ||
    typeof actorValue.actorId !== 'string' || !RESOURCE_ID.test(actorValue.actorId) ||
    typeof envelope.correlationId !== 'string' || !REQUEST_ID.test(envelope.correlationId) ||
    typeof envelope.causationId !== 'string' || !TRACE_ID.test(envelope.causationId) ||
    actorValue.actorType !== 'user' ||
    Object.keys(actorValue).some((key) => key !== 'actorId' && key !== 'actorType') ||
    Object.keys(payloadValue).some((key) => !['operationId', 'result', 'reasonCode'].includes(key)) ||
    payloadValue.operationId !== 'authSessionRevoke' ||
    payloadValue.result !== 'succeeded' ||
    payloadValue.reasonCode !== 'USER_INITIATED'
  ) {
    throw new Error('INVALID_AUTH_010_SESSION_EVENT')
  }
}
