const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const EVENT_ID = /^evt_[a-f0-9]{32}$/
const REQUEST_ID = /^req_[A-Za-z0-9_-]{1,123}$/
const TRACE_ID = /^[A-Za-z0-9._:-]{1,128}$/
const IDEMPOTENCY_KEY = /^AUTH010_SESSION_REVOKE_[a-f0-9]{32}$/

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

export async function assertSessionRevokedEvent(value: unknown): Promise<SessionRevokedEvent> {
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
    typeof event.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(event.idempotencyKey) ||
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

  // Bind the claimed actor and target to the same deterministic identity used
  // by W02 when creating the event. This detects actor/session substitution
  // without disclosing the native session token or adding a new authority.
  const material = 'AUTH010_SESSION_REVOKE:' + actorValue.actorId + ':' + event.resourceId
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  const suffix = Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  if (
    event.eventId !== 'evt_' + suffix ||
    event.idempotencyKey !== 'AUTH010_SESSION_REVOKE_' + suffix
  ) {
    throw new Error('INVALID_AUTH_010_SESSION_EVENT')
  }
  return event as unknown as SessionRevokedEvent
}
