import { buildAccountStateChangedAuditEvent } from './audit-event'
import { persistAuditEvent } from './audit-event-persistence'

export type IdentityAccountStateChangedEvent = {
  eventId: string
  eventType: 'identity.account_state_changed'
  schemaVersion: '1.0'
  producer: 'W02'
  resourceType: 'User'
  resourceId: string
  occurredAt: string
  publishedAt: string
  correlationId: string
  causationId: string
  idempotencyKey: string
  attempt: 1
  sourceVersion: number
  actor: {
    actorId: string
    actorType: 'user' | 'service' | 'admin' | 'system' | 'job'
    operationalRole?: 'PLATFORM_OPERATOR'
  }
  before: { accountState: string; accountStateVersion: number }
  after: { accountState: string; accountStateVersion: number }
  reason: string
}

function assertEvent(value: unknown): asserts value is IdentityAccountStateChangedEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_AUTH_013_EVENT')
  }

  const event = value as Record<string, unknown>
  if (
    event.eventType !== 'identity.account_state_changed' ||
    event.schemaVersion !== '1.0' ||
    event.producer !== 'W02' ||
    event.resourceType !== 'User' ||
    typeof event.eventId !== 'string' ||
    typeof event.resourceId !== 'string' ||
    typeof event.occurredAt !== 'string' ||
    typeof event.publishedAt !== 'string' ||
    typeof event.correlationId !== 'string' ||
    typeof event.causationId !== 'string' ||
    typeof event.idempotencyKey !== 'string' ||
    event.attempt !== 1 ||
    !Number.isInteger(event.sourceVersion) ||
    !event.actor ||
    !event.before ||
    !event.after ||
    typeof event.reason !== 'string'
  ) {
    throw new Error('INVALID_AUTH_013_EVENT')
  }
}

export async function consumeAccountStateChanged(
  db: D1Database,
  raw: unknown,
): Promise<'persisted' | 'duplicate'> {
  assertEvent(raw)
  const event = raw

  const existing = await db
    .prepare('SELECT event_id AS eventId FROM audit_events WHERE event_id = ? LIMIT 1')
    .bind(event.eventId)
    .first<{ eventId: string }>()

  if (existing) return 'duplicate'

  const auditEvent = buildAccountStateChangedAuditEvent({
    eventId: event.eventId,
    requestId: event.correlationId,
    traceId: event.causationId,
    actor: event.actor,
    userId: event.resourceId,
    beforeState: event.before.accountState,
    beforeVersion: event.before.accountStateVersion,
    afterState: event.after.accountState,
    afterVersion: event.after.accountStateVersion,
    occurredAt: event.occurredAt,
    reason: event.reason,
  })

  await persistAuditEvent(db, auditEvent)
  return 'persisted'
}
