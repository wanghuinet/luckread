import { describe, expect, it, vi } from 'vitest'
import { consumeAccountStateChanged, type IdentityAccountStateChangedEvent } from './auth-013-queue-consumer'

const event: IdentityAccountStateChangedEvent = {
  eventId: 'evt-auth013-1',
  eventType: 'identity.account_state_changed',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'User',
  resourceId: 'user-001',
  occurredAt: '2026-09-24T08:30:00.000Z',
  publishedAt: '2026-09-24T08:30:00.000Z',
  correlationId: 'corr-1',
  causationId: 'cause-1',
  idempotencyKey: 'auth013-user-001-1',
  attempt: 1,
  sourceVersion: 2,
  actor: {
    actorId: 'operator-1',
    actorType: 'user',
    operationalRole: 'PLATFORM_OPERATOR',
  },
  before: { accountState: 'ACTIVE', accountStateVersion: 1 },
  after: { accountState: 'RESTRICTED', accountStateVersion: 2 },
  reason: 'policy restriction',
}

function createDb(existing: boolean) {
  const first = vi.fn().mockResolvedValue(existing ? { eventId: event.eventId } : null)
  const run = vi.fn().mockResolvedValue({ success: true })
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('SELECT event_id')) {
      return { bind: vi.fn().mockReturnValue({ first }) }
    }
    return { bind: vi.fn().mockReturnValue({ run }) }
  })
  return { db: { prepare } as unknown as D1Database, prepare, first, run }
}

describe('AUTH-013 W06 queue consumer', () => {
  it('persists a canonical event and retains PLATFORM_OPERATOR role', async () => {
    const { db, prepare, run } = createDb(false)

    await expect(consumeAccountStateChanged(db, event)).resolves.toBe('persisted')

    expect(prepare).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('acknowledges duplicates by eventId without a second write', async () => {
    const { db, prepare, run } = createDb(true)

    await expect(consumeAccountStateChanged(db, event)).resolves.toBe('duplicate')

    expect(prepare).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a non-canonical producer envelope', async () => {
    const { db, prepare } = createDb(false)

    await expect(
      consumeAccountStateChanged(db, { ...event, producer: 'W06' }),
    ).rejects.toThrow('INVALID_AUTH_013_EVENT')

    expect(prepare).not.toHaveBeenCalled()
  })
})
