import { describe, expect, it, vi } from 'vitest'

const { getW06AuditEventStoreMock } = vi.hoisted(() => ({
  getW06AuditEventStoreMock: vi.fn(),
}))

vi.mock('./neon/moderation-database-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./neon/moderation-database-runtime.js')>()),
  getW06AuditEventStore: getW06AuditEventStoreMock,
}))

import worker from './index'
import type { IdentityAccountStateChangedEvent } from './auth-013-queue-consumer'
import type { MfaAuditQueueEvent } from './mfa-audit-queue-consumer'
import type { AuditEvent } from './audit-event.js'
import type { AuditEventStore } from './audit-event-store.js'

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

const sessionRevokedEvent = {
  eventId: 'evt_ab6ec6a8de12624389e11427247fc6a9',
  eventType: 'user.session.revoked',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'Session',
  resourceId: 'session-001',
  occurredAt: '2026-11-06T01:00:00.000Z',
  publishedAt: '2026-11-06T01:00:01.000Z',
  correlationId: 'req_session_revoked_001',
  causationId: 'trace-session-revoked-001',
  idempotencyKey: 'AUTH010_SESSION_REVOKE_ab6ec6a8de12624389e11427247fc6a9',
  attempt: 1,
  sourceVersion: 1,
  actor: { actorId: 'user-001', actorType: 'user' },
  payload: { operationId: 'authSessionRevoke', result: 'succeeded', reasonCode: 'USER_INITIATED' },
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

function createStore(findError?: Error) {
  const rows = new Map<string, AuditEvent>()
  const findByEventId = vi.fn(async (eventId: string) => {
    if (findError) throw findError
    return rows.get(eventId) ?? null
  })
  const append = vi.fn(async (event: AuditEvent) => {
    if (rows.has(event.eventId)) throw new Error('duplicate AuditEvent')
    rows.set(event.eventId, event)
  })
  const store: AuditEventStore = { findByEventId, append }
  return { store, findByEventId, append }
}

const queueRuntime = worker as unknown as {
  queue(batch: MessageBatch<unknown>, env: unknown): Promise<void>
}

async function invokeQueue(messages: TestMessage[], store: AuditEventStore): Promise<void> {
  getW06AuditEventStoreMock.mockReturnValue(store)
  await queueRuntime.queue(
    { messages } as unknown as MessageBatch<unknown>,
    {
      HYPERDRIVE_D1_03: {
        connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread_governance',
      },
    },
  )
}

describe('W06 audit queue reuse of W10 batch executor', () => {
  it('routes valid AUTH-013 and MFA events through the native AuditEvent Store and ACKs both', async () => {
    const { store, findByEventId, append } = createStore()
    const auth = message(identityEvent)
    const mfa = message(mfaEvent)

    await invokeQueue([auth, mfa], store)

    expect(auth.ack).toHaveBeenCalledOnce()
    expect(auth.retry).not.toHaveBeenCalled()
    expect(mfa.ack).toHaveBeenCalledOnce()
    expect(mfa.retry).not.toHaveBeenCalled()
    expect(findByEventId).toHaveBeenCalledTimes(2)
    expect(append).toHaveBeenCalledTimes(2)
  })

  it('routes user.session.revoked to the dedicated immutable Session AuditEvent consumer', async () => {
    const { store, findByEventId, append } = createStore()
    const session = message(sessionRevokedEvent)

    await invokeQueue([session], store)

    expect(session.ack).toHaveBeenCalledOnce()
    expect(session.retry).not.toHaveBeenCalled()
    expect(findByEventId).toHaveBeenCalledWith(sessionRevokedEvent.eventId)
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.session.revoked',
      targetType: 'Session',
      targetId: 'session-001',
    }))
  })

  it('classifies malformed envelopes as poison and continues processing the batch', async () => {
    const { store, findByEventId, append } = createStore()
    const poison = message({ eventType: 'identity.account_state_changed', producer: 'untrusted' })
    const valid = message(mfaEvent)

    await invokeQueue([poison, valid], store)

    expect(poison.ack).not.toHaveBeenCalled()
    expect(poison.retry).toHaveBeenCalledWith({ delaySeconds: 1 })
    expect(valid.ack).toHaveBeenCalledOnce()
    expect(valid.retry).not.toHaveBeenCalled()
    expect(findByEventId).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid shared event metadata before audit Store access and keeps valid later messages flowing', async () => {
    const { store, findByEventId, append } = createStore()
    const invalid = message({
      ...identityEvent,
      publishedAt: '2026-02-31T00:00:00.000Z',
    })
    const valid = message(mfaEvent)

    await invokeQueue([invalid, valid], store)

    expect(invalid.ack).not.toHaveBeenCalled()
    expect(invalid.retry).toHaveBeenCalledWith({ delaySeconds: 1 })
    expect(valid.ack).toHaveBeenCalledOnce()
    expect(valid.retry).not.toHaveBeenCalled()
    expect(findByEventId).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledTimes(1)
  })

  it('uses W10 bounded transient backoff for native PostgreSQL Store failures without logging exception details', async () => {
    const { store, append } = createStore(new Error('sensitive database exception detail'))
    const failed = message(identityEvent, 4)

    await invokeQueue([failed], store)

    expect(failed.ack).not.toHaveBeenCalled()
    expect(failed.retry).toHaveBeenCalledOnce()
    expect(append).not.toHaveBeenCalled()
    const delaySeconds = failed.retry.mock.calls[0]?.[0]?.delaySeconds as number
    expect(Number.isInteger(delaySeconds)).toBe(true)
    expect(delaySeconds).toBeGreaterThanOrEqual(1)
    expect(delaySeconds).toBeLessThanOrEqual(40)
  })
})
