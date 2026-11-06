import { describe, expect, it, vi } from 'vitest'
import { publishPendingSessionRevocationEvents } from './session-revocation-publication-journal'
import { buildSessionRevokedEvent } from './session-revocation-events'

async function makeEvent() {
  return buildSessionRevokedEvent({
    sessionId: 'session-1',
    userId: 'user-1',
    occurredAt: '2026-11-06T00:00:00.000Z',
    correlationId: 'req_session_audit_1',
    causationId: 'trace-session-audit-1',
  })
}

function createEnv(
  rows: Array<{ journalId: string; payload: string; attempt: number }>,
  queueSend = vi.fn().mockResolvedValue(undefined),
) {
  const update = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
  const all = vi.fn().mockResolvedValue({ success: true, results: rows })
  const prepare = vi.fn((sql: string) => sql.startsWith('SELECT')
    ? { bind: vi.fn().mockReturnValue({ all }) }
    : { bind: vi.fn().mockReturnValue({ run: update }) })
  return {
    env: {
      D1_01: { prepare } as unknown as D1Database,
      AUTH013_QUEUE: { send: queueSend } as unknown as Queue,
    },
    prepare,
    update,
    all,
    queueSend,
  }
}

describe('AUTH-010 session revocation audit publisher', () => {
  it('publishes valid session events through the existing AUTH013_QUEUE and confirms the journal state', async () => {
    const event = await makeEvent()
    const { env, queueSend, update, prepare } = createEnv([
      { journalId: 'journal-1', payload: JSON.stringify(event), attempt: 1 },
    ])
    await expect(publishPendingSessionRevocationEvents(env, '2026-11-06T00:01:00.000Z'))
      .resolves.toEqual({ selected: 1, published: 1, failed: 0 })
    expect(queueSend).toHaveBeenCalledWith(event)
    expect(update).toHaveBeenCalledWith('PUBLISHED', '2026-11-06T00:01:00.000Z', 'journal-1', 'PENDING')
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('keeps a pending event with bounded backoff when the existing queue is unavailable', async () => {
    const event = await makeEvent()
    const { env, queueSend, update } = createEnv(
      [{ journalId: 'journal-1', payload: JSON.stringify(event), attempt: 3 }],
      vi.fn().mockRejectedValue(new Error('queue unavailable')),
    )
    await expect(publishPendingSessionRevocationEvents(env, '2026-11-06T00:01:00.000Z'))
      .resolves.toEqual({ selected: 1, published: 0, failed: 1 })
    expect(queueSend).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(
      'PENDING',
      '2026-11-06T00:01:04.000Z',
      'QUEUE_DESTINATION_FAILED',
      'journal-1',
      'PENDING',
    )
  })

  it('quarantines a malformed journal payload without publishing it', async () => {
    const { env, queueSend, update } = createEnv([
      { journalId: 'journal-1', payload: '{bad', attempt: 1 },
    ])
    await expect(publishPendingSessionRevocationEvents(env, '2026-11-06T00:01:00.000Z'))
      .resolves.toEqual({ selected: 1, published: 0, failed: 1 })
    expect(queueSend).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('FAILED', 'INVALID_EVENT_PAYLOAD', 'journal-1', 'PENDING')
  })

  it('fails closed when D1 cannot read the pending journal', async () => {
    const event = await makeEvent()
    const { env, all, queueSend } = createEnv([
      { journalId: 'journal-1', payload: JSON.stringify(event), attempt: 1 },
    ])
    all.mockResolvedValueOnce({ success: false, results: [] })
    await expect(publishPendingSessionRevocationEvents(env, '2026-11-06T00:01:00.000Z'))
      .rejects.toThrow('SESSION_AUDIT_PUBLICATION_STAGE_FAILED')
    expect(queueSend).not.toHaveBeenCalled()
  })
})
