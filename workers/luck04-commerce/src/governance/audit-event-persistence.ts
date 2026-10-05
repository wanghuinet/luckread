import type { AuditEvent } from './audit-event'

const INSERT_AUDIT_EVENT_SQL = `
  INSERT INTO audit_events (
    event_id,
    request_id,
    trace_id,
    actor_json,
    action,
    target_type,
    target_id,
    before_json,
    after_json,
    reason,
    ip,
    user_agent,
    occurred_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

export async function persistAuditEvent(
  db: D1Database,
  event: AuditEvent,
): Promise<void> {
  const result = await db
    .prepare(INSERT_AUDIT_EVENT_SQL)
    .bind(
      event.eventId,
      event.requestId ?? null,
      event.traceId ?? null,
      JSON.stringify(event.actor),
      event.action,
      event.targetType,
      event.targetId,
      JSON.stringify(event.before),
      JSON.stringify(event.after),
      event.reason ?? null,
      event.ip ?? null,
      event.userAgent ?? null,
      event.occurredAt,
    )
    .run()

  if (!result.success) {
    throw new Error('AUDIT_EVENT_PERSISTENCE_FAILED')
  }
}
