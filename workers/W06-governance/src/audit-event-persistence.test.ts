import { describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from './audit-event'
import { persistAuditEvent } from './audit-event-persistence'

const event: AuditEvent = {
  eventId: 'evt-1',
  requestId: 'req-1',
  traceId: 'trace-1',
  actor: {
    actorId: 'user-1',
    actorType: 'user',
    layer: 'L2',
    sessionId: 'session-1',
  },
  action: 'identity.account_state_changed',
  targetType: 'User',
  targetId: 'user-2',
  before: {
    account_state: 'PENDING_VERIFICATION',
    account_state_version: 1,
  },
  after: {
    account_state: 'ACTIVE',
    account_state_version: 2,
  },
  reason: 'verified',
  ip: '203.0.113.10',
  userAgent: 'test-agent',
  occurredAt: '2026-09-24T06:00:00.000Z',
}

describe('persistAuditEvent', () => {
  it('inserts the canonical immutable AuditEvent payload', async () => {
    const run = vi.fn().mockResolvedValue({ success: true })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    await persistAuditEvent(db, event)

    expect(prepare).toHaveBeenCalledTimes(1)
    expect(prepare.mock.calls[0][0]).toContain('INSERT INTO audit_events')
    expect(bind).toHaveBeenCalledWith(
      'evt-1',
      'req-1',
      'trace-1',
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
    )
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('fails closed when D1 reports an unsuccessful write', async () => {
    const run = vi.fn().mockResolvedValue({ success: false })
    const bind = vi.fn().mockReturnValue({ run })
    const prepare = vi.fn().mockReturnValue({ bind })
    const db = { prepare } as unknown as D1Database

    await expect(persistAuditEvent(db, event)).rejects.toThrow(
      'AUDIT_EVENT_PERSISTENCE_FAILED',
    )
  })
})
