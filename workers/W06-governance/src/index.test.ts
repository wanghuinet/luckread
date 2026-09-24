import { describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from './audit-event'

const eventInput = {
  eventId: 'evt-runtime-1',
  requestId: 'req-runtime-1',
  traceId: 'trace-runtime-1',
  actor: {
    actorId: 'admin-1',
    actorType: 'admin',
    layer: 'L7',
  },
  userId: 'user-001',
  beforeState: 'PENDING_VERIFICATION',
  beforeVersion: 1,
  afterState: 'ACTIVE',
  afterVersion: 2,
  occurredAt: '2026-09-24T08:30:00.000Z',
  reason: 'verification completed',
}

function createDb(success = true) {
  const run = vi.fn().mockResolvedValue({ success })
  const bind = vi.fn().mockReturnValue({ run })
  const prepare = vi.fn().mockReturnValue({ bind })
  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bind,
    run,
  }
}

describe('W06 runtime', () => {
  it('persists a canonical AUTH-013 account-state AuditEvent', async () => {
    const { db, prepare, bind, run } = createDb(true)
    const runtime = await import('./index')

    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/account-state-changed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(eventInput),
      }),
      { D1_03: db },
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      eventId: 'evt-runtime-1',
      action: 'identity.account_state_changed',
      targetType: 'User',
      targetId: 'user-001',
    })
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(bind).toHaveBeenCalledWith(
      'evt-runtime-1',
      'req-runtime-1',
      'trace-runtime-1',
      JSON.stringify(eventInput.actor),
      'identity.account_state_changed',
      'User',
      'user-001',
      JSON.stringify({
        account_state: 'PENDING_VERIFICATION',
        account_state_version: 1,
      }),
      JSON.stringify({
        account_state: 'ACTIVE',
        account_state_version: 2,
      }),
      'verification completed',
      null,
      null,
      '2026-09-24T08:30:00.000Z',
    )
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed runtime input without touching D1', async () => {
    const { db, prepare } = createDb(true)
    const runtime = await import('./index')

    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/account-state-changed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...eventInput,
          afterVersion: 4,
        }),
      }),
      { D1_03: db },
    )

    expect(response.status).toBe(400)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('rejects non-canonical resource and correlation identifiers', async () => {
    const { db, prepare } = createDb(true)
    const runtime = await import('./index')

    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/account-state-changed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...eventInput,
          eventId: 'event.invalid',
          requestId: 'request-runtime-1',
        }),
      }),
      { D1_03: db },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'INVALID_AUDIT_EVENT' })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('fails closed when AuditEvent persistence fails', async () => {
    const { db } = createDb(false)
    const runtime = await import('./index')

    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/account-state-changed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(eventInput),
      }),
      { D1_03: db },
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' })
  })

  it('keeps the health response explicit about persistence support', async () => {
    const { db } = createDb(true)
    const runtime = await import('./index')

    const response = await runtime.default.fetch(
      new Request('https://w06.internal/health'),
      { D1_03: db },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      service: 'W06',
      status: 'ok',
      auditPersistence: 'enabled',
      d1Binding: true,
    })
  })
})

export type RuntimeAuditEvent = AuditEvent
