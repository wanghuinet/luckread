import { describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from './audit-event'

const eventInput = {
  eventId: 'evt-runtime-1',
  requestId: 'req_runtime-1',
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

describe('W06 canonical API error mapping', () => {
  it('preserves canonical codes before normalizing internal aliases', async () => {
    const runtime = await import('./index')
    expect(runtime.canonicalErrorCode('INVALID_STATE')).toBe('INVALID_STATE')
    expect(runtime.canonicalErrorCode('INVALID_CURSOR')).toBe('INVALID_CURSOR')
    expect(runtime.canonicalErrorCode('CURSOR_EXPIRED')).toBe('CURSOR_EXPIRED')
    expect(runtime.canonicalErrorCode('REPORT_WRITE_FAILED')).toBe('INTERNAL_ERROR')
    expect(runtime.canonicalErrorCode('INVALID_AUDIT_EVENT')).toBe('VALIDATION_FAILED')
  })
})

describe('W06 moderation queue pagination scope', () => {
  it('rejects queue cursors reused by a different reviewer before D1 access', async () => {
    const rows = [
      {
        case_id: 'case_2',
        target_type: 'content',
        target_id: 'content_2',
        target_version: null,
        policy_version: 'policy-v1',
        state: 'OPEN',
        priority: 5,
        assigned_reviewer_id: null,
        current_decision_id: null,
        evidence_bundle_ref: null,
        version: 1,
        created_at: '2026-10-07T00:00:00.000Z',
        updated_at: '2026-10-07T00:00:00.000Z',
        decision_id: null,
        case_version: null,
        outcome: null,
        decision_policy_version: null,
        decision_effective_at: null,
        decision_request_id: null,
        decision_created_at: null,
      },
      {
        case_id: 'case_3',
        target_type: 'content',
        target_id: 'content_3',
        target_version: null,
        policy_version: 'policy-v1',
        state: 'OPEN',
        priority: 4,
        assigned_reviewer_id: null,
        current_decision_id: null,
        evidence_bundle_ref: null,
        version: 1,
        created_at: '2026-10-07T00:01:00.000Z',
        updated_at: '2026-10-07T00:01:00.000Z',
        decision_id: null,
        case_version: null,
        outcome: null,
        decision_policy_version: null,
        decision_effective_at: null,
        decision_request_id: null,
        decision_created_at: null,
      },
    ]
    const prepare = vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: rows })),
      })),
    }))
    const db = { prepare } as unknown as D1Database
    const runtime = await import('./index')
    const requestFor = (reviewerId: string, requestId: string, cursor?: string) =>
      new Request('https://w06.internal/admin/moderation/queue?limit=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': reviewerId,
          'X-LuckRead-Principal-Layer': 'L6',
          'X-LuckRead-Correlation-Id': 'correlation-' + reviewerId,
          'X-LuckRead-Request-Id': requestId,
        },
      })

    const first = await runtime.default.fetch(requestFor('reviewer_1', 'req_queue_first'), { D1_03: db })
    expect(first.status).toBe(200)
    const payload = await first.json() as { nextCursor?: string }
    expect(payload.nextCursor).toEqual(expect.any(String))
    expect(payload.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(prepare).toHaveBeenCalledTimes(1)

    const reused = await runtime.default.fetch(
      requestFor('reviewer_2', 'req_queue_second', payload.nextCursor),
      { D1_03: db },
    )
    expect(reused.status).toBe(400)
    await expect(reused.json()).resolves.toMatchObject({
      error: { code: 'INVALID_CURSOR', details: {} },
      requestId: 'req_queue_second',
    })
    expect(prepare).toHaveBeenCalledTimes(1)
  })
})

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
      'req_runtime-1',
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
      moderationRuntime: 'enabled',
    })
  })
})

export type RuntimeAuditEvent = AuditEvent
