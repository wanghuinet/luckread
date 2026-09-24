import { describe, expect, it } from 'vitest'
import {
  applyAccountStateTransition,
  type AccountStateTransitionInput,
} from './account-state-transition.js'

function input(overrides: Partial<AccountStateTransitionInput> = {}): AccountStateTransitionInput {
  return {
    userId: '42',
    to: 'RESTRICTED',
    reason: 'moderation action',
    expectedVersion: 7,
    actor: { id: 'operator-1', type: 'operator' },
    permission: 'user.restrict.limited',
    now: '2026-09-24T12:00:00.000Z',
    ...overrides,
  }
}

function fakeDb(
  initial: { state: string; version: number },
  options: { failBatch?: boolean; missingUser?: boolean; forceJournalConflict?: boolean } = {},
) {
  const row = { ...initial }
  let batchCalls = 0
  let lastJournal: Record<string, unknown> | null = null

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async <T>() => {
              if (options.missingUser) return null
              const snapshot = { accountState: row.state, accountStateVersion: row.version } as T
              if (options.forceJournalConflict) {
                row.state = 'RESTRICTED'
                row.version += 1
              }
              return snapshot
            },
            sql,
            args,
          }
        },
      }
    },
    async batch(statements: Array<{ sql: string; args: unknown[] }>) {
      batchCalls += 1
      if (options.failBatch) {
        throw new Error('D1 journal constraint failure')
      }

      const update = statements[0]
      const journal = statements[1]
      const [nextState, , , expectedState, expectedVersion] = update.args as [
        string,
        string,
        string,
        string,
        number,
      ]

      if (row.state !== expectedState || row.version !== expectedVersion) {
        throw new Error('UNIQUE constraint failed: auth_013_publication_journal.resource_id, event_type, source_version')
      }

      row.state = nextState
      row.version += 1

      const journalArgs = journal.args as unknown[]
      lastJournal = {
        journalId: journalArgs[0],
        eventId: journalArgs[1],
        eventType: journalArgs[2],
        schemaVersion: journalArgs[3],
        resourceId: journalArgs[4],
        sourceVersion: journalArgs[5],
        payload: journalArgs[6],
        status: journalArgs[7],
        attempt: journalArgs[8],
        nextAttemptAt: journalArgs[9],
        createdAt: journalArgs[10],
        publishedAt: journalArgs[11],
        lastErrorCode: journalArgs[12],
      }

      return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }]
    },
  }

  return {
    db: db as unknown as D1Database,
    row,
    batchCalls: () => batchCalls,
    journal: () => lastJournal,
  }
}

describe('AUTH-013 account-state transition kernel', () => {
  it('atomically advances Account State and creates the durable publication journal', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })
    const result = await applyAccountStateTransition(fake.db, input())

    expect(result.from).toBe('ACTIVE')
    expect(result.to).toBe('RESTRICTED')
    expect(result.accountStateVersion).toBe(8)
    expect(result.eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.journalId).toMatch(/^[0-9a-f-]{36}$/)
    expect(fake.row).toEqual({ state: 'RESTRICTED', version: 8 })
    expect(fake.batchCalls()).toBe(1)

    const journal = fake.journal()
    expect(journal?.eventType).toBe('identity.account_state_changed')
    expect(journal?.schemaVersion).toBe('1.0')
    expect(journal?.resourceId).toBe('42')
    expect(journal?.sourceVersion).toBe(8)
    expect(journal?.status).toBe('PENDING')
    expect(journal?.attempt).toBe(1)

    const event = JSON.parse(String(journal?.payload))
    expect(event).toMatchObject({
      eventId: journal?.eventId,
      eventType: 'identity.account_state_changed',
      schemaVersion: '1.0',
      producer: 'W02',
      resourceType: 'User',
      resourceId: '42',
      occurredAt: '2026-09-24T12:00:00.000Z',
      publishedAt: '2026-09-24T12:00:00.000Z',
      correlationId: expect.any(String),
      causationId: expect.any(String),
      idempotencyKey: 'auth013-42-7',
      attempt: 1,
      sourceVersion: 8,
      actor: {
        actorId: 'operator-1',
        actorType: 'user',
        operationalRole: 'PLATFORM_OPERATOR',
      },
      before: {
        accountState: 'ACTIVE',
        accountStateVersion: 7,
      },
      after: {
        accountState: 'RESTRICTED',
        accountStateVersion: 8,
      },
      reason: 'moderation action',
    })
  })

  it('rejects a stale If-Match version without entering the write batch', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 8 })

    await expect(applyAccountStateTransition(fake.db, input({ expectedVersion: 7 }))).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(fake.row).toEqual({ state: 'ACTIVE', version: 8 })
    expect(fake.batchCalls()).toBe(0)
  })

  it('rolls back the in-memory state when the durable journal write fails', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 }, { failBatch: true })

    await expect(applyAccountStateTransition(fake.db, input())).rejects.toMatchObject({
      code: 'JOURNAL_PERSISTENCE_FAILED',
    })

    expect(fake.row).toEqual({ state: 'ACTIVE', version: 7 })
    expect(fake.batchCalls()).toBe(1)
    expect(fake.journal()).toBeNull()
  })

  it('requires the canonical permission for operator enforcement', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await expect(
      applyAccountStateTransition(fake.db, input({ permission: 'user.freeze' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(fake.batchCalls()).toBe(0)
  })

  it('requires L7 approval for ACTIVE -> BANNED', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({
          to: 'BANNED',
          permission: 'user.ban',
          actor: { id: 'admin-1', type: 'admin' },
          approvalLevel: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'BANNED',
        permission: 'user.ban',
        actor: { id: 'admin-1', type: 'admin' },
        approvalLevel: 'L7',
      }),
    )
    expect(result.from).toBe('ACTIVE')
    expect(result.to).toBe('BANNED')
    expect(result.accountStateVersion).toBe(8)
  })

  it('fails closed when a required lifecycle precondition is not proven', async () => {
    const fake = fakeDb({ state: 'PENDING_VERIFICATION', version: 7 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({
          to: 'ACTIVE',
          actor: { id: '42', type: 'user' },
          permission: null,
          preconditionSatisfied: false,
        }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    expect(fake.batchCalls()).toBe(0)
  })

  it('accepts user-owned UNREGISTERED -> PENDING_VERIFICATION without permission', async () => {
    const fake = fakeDb({ state: 'UNREGISTERED', version: 1 })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        userId: '42',
        to: 'PENDING_VERIFICATION',
        expectedVersion: 1,
        actor: { id: '42', type: 'user' },
        permission: null,
      }),
    )

    expect(result.accountStateVersion).toBe(2)
    expect(fake.row).toEqual({ state: 'PENDING_VERIFICATION', version: 2 })
  })

  it('accepts PENDING_VERIFICATION -> ACTIVE only when the verification precondition is proven', async () => {
    const fake = fakeDb({ state: 'PENDING_VERIFICATION', version: 7 })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'ACTIVE',
        actor: { id: '42', type: 'user' },
        permission: null,
        preconditionSatisfied: true,
      }),
    )

    expect(result.accountStateVersion).toBe(8)
  })

  it('accepts system-owned timeout deletion through the canonical system.job permission', async () => {
    const fake = fakeDb({ state: 'PENDING_VERIFICATION', version: 2 })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'DELETED',
        expectedVersion: 2,
        actor: { id: 'job:account-lifecycle', type: 'job' },
        permission: 'system.job',
        preconditionSatisfied: true,
      }),
    )

    expect(result.accountStateVersion).toBe(3)
    expect(fake.row).toEqual({ state: 'DELETED', version: 3 })
  })

  it('accepts BANNED -> RESTORED only with admin actor, user.restore permission and L7 approval', async () => {
    const fake = fakeDb({ state: 'BANNED', version: 4 })

    const result = await applyAccountStateTransition(
      fake.db,
      input({
        to: 'RESTORED',
        expectedVersion: 4,
        actor: { id: 'admin-1', type: 'admin' },
        permission: 'user.restore',
        approvalLevel: 'L7',
      }),
    )

    expect(result.accountStateVersion).toBe(5)
  })

  it('rejects a concurrent compare-and-set race through the journal uniqueness boundary', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 }, { forceJournalConflict: true })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({ expectedVersion: 7 }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(fake.row).toEqual({ state: 'RESTRICTED', version: 8 })
    expect(fake.batchCalls()).toBe(1)
  })

  it('rejects an operator transition when the actor type is not authorized', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({ actor: { id: 'admin-1', type: 'admin' } }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(fake.batchCalls()).toBe(0)
  })

  it('rejects missing users without attempting a write', async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => null,
            }
          },
        }
      },
    } as unknown as D1Database

    await expect(applyAccountStateTransition(db, input())).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('propagates a supplied correlation and causation id', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await applyAccountStateTransition(
      fake.db,
      input({
        correlationId: 'corr-123456789012',
        causationId: 'cause-123456789012',
      }),
    )

    const event = JSON.parse(String(fake.journal()?.payload))
    expect(event.correlationId).toBe('corr-123456789012')
    expect(event.causationId).toBe('cause-123456789012')
  })
})
