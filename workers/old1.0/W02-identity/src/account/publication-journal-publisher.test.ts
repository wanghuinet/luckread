import { describe, expect, it, vi } from 'vitest'
import { publishPendingAccountStateEvents } from './publication-journal-publisher'

function createEnv(
  rows: Array<{ journalId: string; payload: string; attempt: number }>,
  auditSend = vi.fn().mockResolvedValue(undefined),
  projectionSend = vi.fn().mockResolvedValue(undefined),
) {
  const run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
  const all = vi.fn().mockResolvedValue({ results: rows })
  const bind = vi.fn((...args: unknown[]) => ({ all, run, args }))
  const prepare = vi.fn((sql: string) => ({ bind, sql }))
  return {
    env: {
      D1_01: { prepare } as unknown as D1Database,
      AUTH013_QUEUE: { send: auditSend } as unknown as Queue,
      AUTH013_PROJECTION_QUEUE: { send: projectionSend } as unknown as Queue,
    },
    prepare,
    bind,
    run,
    all,
    auditSend,
    projectionSend,
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
  it('publishes the same canonical event to audit and W04 projection destinations', async () => {
    const { env, auditSend, projectionSend, prepare } = createEnv([
      { journalId: 'journal-1', payload: JSON.stringify(event), attempt: 1 },
    ])

    await expect(
      publishPendingAccountStateEvents(env, '2026-09-24T08:31:00.000Z'),
    ).resolves.toEqual({ selected: 1, published: 1, failed: 0 })

    expect(auditSend).toHaveBeenCalledWith(event)
    expect(projectionSend).toHaveBeenCalledWith(event)
    expect(auditSend).toHaveBeenCalledTimes(1)
    expect(projectionSend).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('keeps the journal pending when only one destination fails', async () => {
    const { env, auditSend, projectionSend, prepare } = createEnv(
      [{ journalId: 'journal-1', payload: JSON.stringify(event), attempt: 1 }],
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockRejectedValue(new Error('projection queue unavailable')),
    )

    await expect(
      publishPendingAccountStateEvents(env, '2026-09-24T08:31:00.000Z'),
    ).resolves.toEqual({ selected: 1, published: 0, failed: 1 })

    expect(auditSend).toHaveBeenCalledWith(event)
    expect(projectionSend).toHaveBeenCalledWith(event)
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('keeps the journal pending when audit delivery fails', async () => {
    const { env, auditSend, projectionSend, prepare } = createEnv(
      [{ journalId: 'journal-1', payload: JSON.stringify(event), attempt: 1 }],
      vi.fn().mockRejectedValue(new Error('audit queue unavailable')),
      vi.fn().mockResolvedValue(undefined),
    )

    await expect(
      publishPendingAccountStateEvents(env, '2026-09-24T08:31:00.000Z'),
    ).resolves.toEqual({ selected: 1, published: 0, failed: 1 })

    expect(auditSend).toHaveBeenCalledWith(event)
    expect(projectionSend).toHaveBeenCalledWith(event)
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('leaves the journal pending with backoff when both destinations fail', async () => {
    const { env, auditSend, projectionSend, prepare } = createEnv(
      [{ journalId: 'journal-1', payload: JSON.stringify(event), attempt: 1 }],
      vi.fn().mockRejectedValue(new Error('audit queue unavailable')),
      vi.fn().mockRejectedValue(new Error('projection queue unavailable')),
    )

    await expect(
      publishPendingAccountStateEvents(env, '2026-09-24T08:31:00.000Z'),
    ).resolves.toEqual({ selected: 1, published: 0, failed: 1 })

    expect(auditSend).toHaveBeenCalledTimes(1)
    expect(projectionSend).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledTimes(2)
  })

  it('fails malformed journal payload without publishing', async () => {
    const { env, auditSend, projectionSend } = createEnv([
      { journalId: 'journal-1', payload: '{bad', attempt: 1 },
    ])

    await expect(
      publishPendingAccountStateEvents(env, '2026-09-24T08:31:00.000Z'),
    ).resolves.toEqual({ selected: 1, published: 0, failed: 1 })

    expect(auditSend).not.toHaveBeenCalled()
    expect(projectionSend).not.toHaveBeenCalled()
  })
})
