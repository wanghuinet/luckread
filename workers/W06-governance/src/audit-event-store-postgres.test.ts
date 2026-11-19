import { describe, expect, it } from 'vitest'

import { createPostgresAuditEventStore } from './audit-event-store-postgres.js'
import type { AuditEvent } from './audit-event.js'
import type { W06ModerationPostgresPool } from './neon-postgres-d1-database.js'

type ScriptedResponse = {
  match: string
  rows?: Array<Record<string, unknown>>
  rowCount?: number
  error?: Error
}

function fakePool(responses: ScriptedResponse[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = []
  const pending = [...responses]
  const pool: W06ModerationPostgresPool = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ) {
      calls.push({ sql, values })
      const response = pending.shift()
      if (!response || !sql.includes(response.match)) {
        throw new Error('unexpected PostgreSQL statement: ' + sql)
      }
      if (response.error) throw response.error
      return {
        rows: (response.rows ?? []) as Row[],
        rowCount: response.rowCount ?? response.rows?.length ?? 0,
      }
    },
    async connect() {
      throw new Error('AuditEvent Store must use the shared pool query contract')
    },
  }
  return { pool, calls }
}

const event: AuditEvent = {
  eventId: 'evt-auth-queue-001',
  requestId: 'req-auth-queue-001',
  traceId: 'trace-auth-queue-001',
  actor: { actorId: 'user-001', actorType: 'user', layer: 'L2' },
  action: 'auth.mfa.enrollment_started',
  targetType: 'User',
  targetId: 'user-001',
  before: {},
  after: { operationId: 'authMfaEnrollmentStart', result: 'started' },
  reason: 'USER_REQUESTED',
  ip: '203.0.113.4',
  userAgent: 'LuckRead/1.0',
  occurredAt: '2026-11-19T12:00:00.000Z',
}

describe('W06 native PostgreSQL AuditEvent Store', () => {
  it('reads a canonical AuditEvent from the W09-owned append-only table', async () => {
    const fake = fakePool([{
      match: 'FROM audit_events',
      rows: [{
        eventId: event.eventId,
        requestId: event.requestId,
        traceId: event.traceId,
        actor: event.actor,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        before: event.before,
        after: event.after,
        reason: event.reason,
        ip: event.ip,
        userAgent: event.userAgent,
        occurredAt: new Date(event.occurredAt),
      }],
    }])

    const store = createPostgresAuditEventStore(fake.pool)
    await expect(store.findByEventId(event.eventId)).resolves.toEqual(event)
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]?.sql).toContain('WHERE event_id = $1')
    expect(fake.calls[0]?.values).toEqual([event.eventId])
    expect(fake.calls[0]?.sql).toContain('FROM audit_events')
  })

  it('returns null when the event ID has not been written', async () => {
    const fake = fakePool([{ match: 'FROM audit_events', rows: [] }])
    await expect(createPostgresAuditEventStore(fake.pool).findByEventId('missing-event'))
      .resolves.toBeNull()
  })

  it('appends a canonical AuditEvent through W09 SQL policy without a second connection', async () => {
    const fake = fakePool([{ match: 'INSERT INTO audit_events', rowCount: 1 }])
    const store = createPostgresAuditEventStore(fake.pool)

    await expect(store.append(event)).resolves.toBeUndefined()

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]?.sql).toContain('INSERT INTO audit_events')
    expect(fake.calls[0]?.values).toEqual([
      event.eventId,
      event.requestId,
      event.traceId,
      JSON.stringify(event.actor),
      event.action,
      event.targetType,
      event.targetId,
      JSON.stringify(event.before),
      JSON.stringify(event.after),
      event.reason,
      event.ip,
      event.userAgent,
      event.occurredAt,
    ])
  })

  it('sanitizes PostgreSQL lookup and append failures', async () => {
    const failedLookup = fakePool([{ match: 'FROM audit_events', error: new Error('database secret') }])
    await expect(createPostgresAuditEventStore(failedLookup.pool).findByEventId(event.eventId))
      .rejects.toMatchObject({ code: 'AUDIT_EVENT_LOOKUP_FAILED', message: 'AUDIT_EVENT_LOOKUP_FAILED' })

    const failedAppend = fakePool([{ match: 'INSERT INTO audit_events', error: new Error('database secret') }])
    await expect(createPostgresAuditEventStore(failedAppend.pool).append(event))
      .rejects.toMatchObject({ code: 'AUDIT_EVENT_PERSISTENCE_FAILED', message: 'AUDIT_EVENT_PERSISTENCE_FAILED' })
  })

  it('rejects malformed canonical JSON projections rather than returning partial identity', async () => {
    const fake = fakePool([{
      match: 'FROM audit_events',
      rows: [{
        eventId: event.eventId,
        requestId: event.requestId,
        traceId: event.traceId,
        actor: 'not-json',
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        before: {},
        after: {},
        reason: null,
        ip: null,
        userAgent: null,
        occurredAt: new Date(event.occurredAt),
      }],
    }])

    await expect(createPostgresAuditEventStore(fake.pool).findByEventId(event.eventId))
      .rejects.toMatchObject({ code: 'AUDIT_EVENT_LOOKUP_FAILED' })
  })
})
