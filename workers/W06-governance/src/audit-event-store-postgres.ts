import { assertW09AuditEventStatement } from '../../W09-platform/src/audit-event-postgres-adapter.js'

import type { AuditEvent, AuditActor } from './audit-event.js'
import type { AuditEventStore } from './audit-event-store.js'
import { AuditEventStoreError } from './audit-event-store.js'
import type { W06ModerationPostgresPool } from './neon-postgres-d1-database.js'

type QueryResult<Row extends Record<string, unknown>> = {
  rows: Row[]
  rowCount: number | null
}

type AuditEventRow = {
  eventId: string
  requestId: string | null
  traceId: string | null
  actor: unknown
  action: string
  targetType: string
  targetId: string
  before: unknown
  after: unknown
  reason: string | null
  ip: string | null
  userAgent: string | null
  occurredAt: string | Date
}

const FIND_AUDIT_EVENT_SQL = `
  SELECT
    event_id AS "eventId",
    request_id AS "requestId",
    trace_id AS "traceId",
    actor_json AS actor,
    action,
    target_type AS "targetType",
    target_id AS "targetId",
    before_json AS "before",
    after_json AS "after",
    reason,
    ip,
    user_agent AS "userAgent",
    occurred_at AS "occurredAt"
  FROM audit_events
  WHERE event_id = $1
  LIMIT 1
`

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
  ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13)
`

function decodeObject(value: unknown): Record<string, unknown> {
  let candidate = value
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown
    } catch {
      throw new AuditEventStoreError('AUDIT_EVENT_LOOKUP_FAILED')
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new AuditEventStoreError('AUDIT_EVENT_LOOKUP_FAILED')
  }
  return candidate as Record<string, unknown>
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
  }
  throw new AuditEventStoreError('AUDIT_EVENT_LOOKUP_FAILED')
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  const actor = decodeObject(row.actor)
  if (
    typeof row.eventId !== 'string' ||
    typeof row.action !== 'string' ||
    typeof row.targetType !== 'string' ||
    typeof row.targetId !== 'string' ||
    typeof actor.actorId !== 'string' ||
    !['user', 'service', 'admin', 'system', 'job'].includes(String(actor.actorType))
  ) {
    throw new AuditEventStoreError('AUDIT_EVENT_LOOKUP_FAILED')
  }
  const before = decodeObject(row.before)
  const after = decodeObject(row.after)
  const result: AuditEvent = {
    eventId: row.eventId,
    ...(row.requestId !== null ? { requestId: row.requestId } : {}),
    ...(row.traceId !== null ? { traceId: row.traceId } : {}),
    actor: actor as unknown as AuditActor,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    before,
    after,
    ...(row.reason !== null ? { reason: row.reason } : {}),
    ...(row.ip !== null ? { ip: row.ip } : {}),
    ...(row.userAgent !== null ? { userAgent: row.userAgent } : {}),
    occurredAt: toIsoTimestamp(row.occurredAt),
  }
  return result
}

function isAllowedAuditSql(sql: string): boolean {
  return assertW09AuditEventStatement(sql)
}

export function createPostgresAuditEventStore(pool: W06ModerationPostgresPool): AuditEventStore {
  if (!isAllowedAuditSql(FIND_AUDIT_EVENT_SQL) || !isAllowedAuditSql(INSERT_AUDIT_EVENT_SQL)) {
    throw new Error('W09_AUDIT_EVENT_APPEND_ONLY_STATEMENT_REQUIRED')
  }

  return {
    async findByEventId(eventId: string): Promise<AuditEvent | null> {
      try {
        const result: QueryResult<AuditEventRow> = await pool.query<AuditEventRow>(
          FIND_AUDIT_EVENT_SQL,
          [eventId],
        )
        const row = result.rows[0]
        return row ? mapAuditEvent(row) : null
      } catch (error) {
        if (error instanceof AuditEventStoreError) throw error
        throw new AuditEventStoreError('AUDIT_EVENT_LOOKUP_FAILED')
      }
    },

    async append(event: AuditEvent): Promise<void> {
      try {
        const result = await pool.query(
          INSERT_AUDIT_EVENT_SQL,
          [
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
          ],
        )
        const affectedRows = result.rowCount ?? result.rows.length
        if (affectedRows !== 1) throw new Error('AUDIT_EVENT_INSERT_ROW_COUNT_INVALID')
      } catch {
        throw new AuditEventStoreError('AUDIT_EVENT_PERSISTENCE_FAILED')
      }
    },
  }
}
