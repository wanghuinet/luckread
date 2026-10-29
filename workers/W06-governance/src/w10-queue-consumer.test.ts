import { describe, expect, it, vi } from 'vitest'
import worker from './index'
import type { IdentityAccountStateChangedEvent } from './auth-013-queue-consumer'
import type { MfaAuditQueueEvent } from './mfa-audit-queue-consumer'

const identityEvent: IdentityAccountStateChangedEvent = {
  eventId: 'evt-auth013-w10-1',
  eventType: 'identity.account_state_changed',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'User',
  resourceId: 'user-001',
  occurredAt: '2026-10-29T00:00:00.000Z',
  publishedAt: '2026-10-29T00:00:00.000Z',
  correlationId: 'corr-auth013-w10-1',
  causationId: 'cause-auth013-w10-1',
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

const mfaEvent: MfaAuditQueueEvent = {
  eventId: 'evt_01234567890123456789012345678901',
  eventType: 'auth.mfa.enrollment_started',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'User',
  resourceId: 'user-001',
  occurredAt: '2026-10-29T00:00:00.000Z',
  publishedAt: '2026-10-29T00:00:00.000Z',
  correlationId: 'corr-mfa-w10-1',
  causationId: 'cause-mfa-w10-1',
  idempotencyKey: 'mfa-evt_01234567890123456789012345678901',
  attempt: 1,
  sourceVersion: 1,
  actor: { actorId: 'user-001', actorType: 'user' },
  payload: {
    operationId: 'authMfaEnrollmentStart',
    result: 'started',
    factorState: 'PENDING_VERIFICATION',
  },
}

type TestMessage = {
  body: unknown
  attempts?: number
  ack: ReturnType<typeof vi.fn>
  retry: ReturnType<typeof vi.fn>
}

function message(body: unknown, attempts = 1): TestMessage {
  return { body, attempts, ack: vi.fn(), retry: vi.fn() }
}

function createDb() {
  const prepare = vi.fn((_sql: string) => {
    const statement = {
      bind: vi.fn(() => statement),
      first: vi.fn(async () => null),
      run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
    }
    return statement
  })
  return { db: { prepare } as unknown as D1Database, prepare }
}

const queueRuntime = worker as unknown as {
  queue(batch: MessageBatch<unknown>, env: { D1_03: D1Database }): Promise<void>
}

async function invokeQueue(messages: TestMessage[], db: D1Database): Promise<void> {
  await queueRuntime.queue(
    { messages } as unknown as MessageBatch<unknown>,
    { D1_03: db },
  )
}

describe('W06 audit queue reuse of W10 batch executor', () => {
  it('routes valid AUTH-013 and MFA events through existing consumers and ACKs both', async () => {
    const { db } = createDb()
    const auth = message(identityEvent)
    const mfa = message(mfaEvent)

    await invokeQueue([auth, mfa], db)

    expect(auth.ack).toHaveBeenCalledOnce()
    expect(auth.retry).not.toHaveBeenCalled()
    expect(mfa.ack).toHaveBeenCalledOnce()
    expect(mfa.retry).not.toHaveBeenCalled()
  })

  it('classifies malformed envelopes as poison and continues processing the batch', async () => {
    const { db } = createDb()
    const poison = message({ eventType: 'identity.account_state_changed', producer: 'untrusted' })
    const valid = message(mfaEvent)

    await invokeQueue([poison, valid], db)

    expect(poison.ack).not.toHaveBeenCalled()
    expect(poison.retry).toHaveBeenCalledWith({ delaySeconds: 1 })
    expect(valid.ack).toHaveBeenCalledOnce()
    expect(valid.retry).not.toHaveBeenCalled()
  })

  it('uses W10 bounded transient backoff for D1 failures without logging exception details', async () => {
    const db = {
      prepare: vi.fn(() => { throw new Error('sensitive database exception detail') }),
    } as unknown as D1Database
    const failed = message(identityEvent, 4)

    await invokeQueue([failed], db)

    expect(failed.ack).not.toHaveBeenCalled()
    expect(failed.retry).toHaveBeenCalledOnce()
    const delaySeconds = failed.retry.mock.calls[0]?.[0]?.delaySeconds as number
    expect(Number.isInteger(delaySeconds)).toBe(true)
    expect(delaySeconds).toBeGreaterThanOrEqual(1)
    expect(delaySeconds).toBeLessThanOrEqual(40)
  })
})
