import { describe, expect, it, vi } from 'vitest'
import { publishPendingMfaAuditEvents } from './mfa-audit-publication-journal'

const event = {
  eventId: 'evt_01234567890123456789012345678901',
  eventType: 'auth.mfa.enrollment_started',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'User',
  resourceId: 'user-1',
  occurredAt: '2026-10-24T14:00:00.000Z',
  publishedAt: '2026-10-24T14:00:30.000Z',
  correlationId: 'corr-1',
  causationId: 'cause-1',
  idempotencyKey: 'mfa-evt_01234567890123456789012345678901',
  attempt: 1,
  sourceVersion: 1,
  actor: { actorId: 'user-1', actorType: 'user' },
  payload: { operationId: 'authMfaEnrollmentStart', result: 'started', factorState: 'PENDING_VERIFICATION' },
}

function createEnv(rows: Array<{ journalId: string; payload: string; attempt: number }>, queueSend = vi.fn().mockResolvedValue(undefined)) {
  const update = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
  const all = vi.fn().mockResolvedValue({ results: rows })
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...values: unknown[]) => sql.startsWith('SELECT')
      ? { all: () => all(...values) }
      : { run: () => update(...values) }),
  }))
  return {
    env: { D1_01: { prepare } as unknown as D1Database, AUTH013_QUEUE: { send: queueSend } as unknown as Queue },
    prepare, update, all, queueSend,
  }
}

describe('AUTH-007 MFA audit outbox publisher', () => {
  it('sends the allowlisted MFA event through the existing W02-to-W06 queue and marks it published', async () => {
    const { env, prepare, update, queueSend } = createEnv([
      { journalId: 'journal-1', payload: JSON.stringify(event), attempt: 1 },
    ])
    await expect(publishPendingMfaAuditEvents(env, '2026-10-24T14:01:00.000Z')).resolves.toEqual({
      selected: 1, published: 1, failed: 0,
    })
    expect(event.publishedAt).not.toBe(event.occurredAt)
    expect(queueSend).toHaveBeenCalledWith(event)
    // Queue transport acknowledgment time is stored in the journal column;
    // the immutable event envelope is sent as-is and is never rewritten.
    expect(update).toHaveBeenCalledWith('PUBLISHED', '2026-10-24T14:01:00.000Z', null, null, 'journal-1', 'PENDING')
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('keeps an accepted event pending with backoff when queue send fails', async () => {
    const { env, update, queueSend } = createEnv(
      [{ journalId: 'journal-1', payload: JSON.stringify(event), attempt: 2 }],
      vi.fn().mockRejectedValue(new Error('queue unavailable')),
    )
    await expect(publishPendingMfaAuditEvents(env, '2026-10-24T14:01:00.000Z')).resolves.toEqual({
      selected: 1, published: 0, failed: 1,
    })
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('PENDING', '2026-10-24T14:01:02.000Z', 'QUEUE_DESTINATION_FAILED', 'journal-1', 'PENDING')
  })

  it('permanently marks malformed event payload as failed without publishing', async () => {
    const { env, update, queueSend } = createEnv([
      { journalId: 'journal-1', payload: '{bad', attempt: 1 },
    ])
    await expect(publishPendingMfaAuditEvents(env, '2026-10-24T14:01:00.000Z')).resolves.toEqual({
      selected: 1, published: 0, failed: 1,
    })
    expect(queueSend).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('FAILED', 'INVALID_EVENT_PAYLOAD', 'journal-1', 'PENDING')
  })
})
