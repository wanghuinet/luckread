import { describe, expect, it, vi } from 'vitest'
import { publishPendingAccountStateEvents } from './publication-journal-publisher'

function createEnv(rows: Array<{ journalId: string; payload: string; attempt: number }>, send = vi.fn().mockResolvedValue(undefined)) {
  const run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
  const all = vi.fn().mockResolvedValue({ results: rows })
  const bind = vi.fn((...args: unknown[]) => ({ all, run, args }))
  const prepare = vi.fn((sql: string) => ({ bind, sql }))
  return {
    env: {
      D1_01: { prepare } as unknown as D1Database,
      AUTH013_QUEUE: { send } as unknown as Queue,
    },
    prepare,
    bind,
    run,
    all,
    send,
  }
}

const event = {
  eventId: 'evt-1',
  eventType: 'identity.account_state_changed',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'User',
  resourceId: 'user-1',
  occurredAt: '2026-09-24T08:30:00.000Z',
  publishedAt: '2026-09-24T08:30:00.000Z',
  correlationId: 'corr-1',
  causationId: 'cause-1',
  idempotencyKey: 'auth013-user-1-1',
  attempt: 1,
  sourceVersion: 2,
  actor: { actorId: 'operator-1', actorType: 'user', operationalRole: 'PLATFORM_OPERATOR' },
  before: { accountState: 'ACTIVE', accountStateVersion: 1 },
  after: { accountState: 'RESTRICTED', accountStateVersion: 2 },
  reason: 'restriction',
}

describe('AUTH-013 durable journal publisher', () => {
  it('publishes pending event and marks the journal row published', async () => {
    const { env, send, prepare } = createEnv([
      { journalId: 'journal-1', payload: JSON.stringify(event), attempt: 1 },
    ])

    await expect(
      publishPendingAccountStateEvents(env, '2026-09-24T08:31:00.000Z'),
    ).resolves.toEqual({ selected: 1, published: 1, failed: 0 })

    expect(send).toHaveBeenCalledWith(event)
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('leaves the journal pending with backoff when queue send fails', async () => {
    const { env, send, prepare } = createEnv(
      [{ journalId: 'journal-1', payload: JSON.stringify(event), attempt: 1 }],
      vi.fn().mockRejectedValue(new Error('queue unavailable')),
    )

    await expect(
      publishPendingAccountStateEvents(env, '2026-09-24T08:31:00.000Z'),
    ).resolves.toEqual({ selected: 1, published: 0, failed: 1 })

    expect(send).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('fails malformed journal payload without publishing', async () => {
    const { env, send } = createEnv([
      { journalId: 'journal-1', payload: '{bad', attempt: 1 },
    ])

    await expect(
      publishPendingAccountStateEvents(env, '2026-09-24T08:31:00.000Z'),
    ).resolves.toEqual({ selected: 1, published: 0, failed: 1 })

    expect(send).not.toHaveBeenCalled()
  })
})
