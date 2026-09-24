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
    ...overrides,
  }
}

function fakeDb(initial: { state: string; version: number }, forcedChanges?: number) {
  const row = { ...initial }
  let writes = 0

  const db = {
    prepare() {
      return {
        bind(...args: unknown[]) {
          return {
            first: async <T>() => ({ accountState: row.state, accountStateVersion: row.version }) as T,
            run: async () => {
              writes += 1
              if (forcedChanges !== undefined) return { meta: { changes: forcedChanges } }
              const [nextState, , , expectedState, expectedVersion] = args as [string, string, string, string, number]
              if (row.state !== expectedState || row.version !== expectedVersion) return { meta: { changes: 0 } }
              row.state = nextState
              row.version += 1
              return { meta: { changes: 1 } }
            },
          }
        },
      }
    },
  }

  return { db: db as unknown as D1Database, row, writes: () => writes }
}

describe('AUTH-013 account-state transition kernel', () => {
  it('performs ACTIVE -> RESTRICTED and increments the version exactly once', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })
    const result = await applyAccountStateTransition(fake.db, input())

    expect(result).toEqual({ from: 'ACTIVE', to: 'RESTRICTED', accountStateVersion: 8 })
    expect(fake.row).toEqual({ state: 'RESTRICTED', version: 8 })
    expect(fake.writes()).toBe(1)
  })

  it('rejects a stale If-Match version without writing', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 8 })

    await expect(applyAccountStateTransition(fake.db, input({ expectedVersion: 7 }))).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(fake.row).toEqual({ state: 'ACTIVE', version: 8 })
    expect(fake.writes()).toBe(0)
  })

  it('rejects a forbidden transition before persistence', async () => {
    const fake = fakeDb({ state: 'DELETED', version: 2 })

    await expect(applyAccountStateTransition(fake.db, input({ to: 'ACTIVE' }))).rejects.toMatchObject({ code: 'INVALID_STATE' })
    expect(fake.writes()).toBe(0)
  })

  it('requires the canonical permission for operator enforcement', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await expect(applyAccountStateTransition(fake.db, input({ permission: 'user.freeze' }))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(fake.writes()).toBe(0)
  })

  it('requires L7 approval for ACTIVE -> BANNED', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await expect(applyAccountStateTransition(fake.db, input({ to: 'BANNED', permission: 'user.ban', approvalLevel: null }))).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const result = await applyAccountStateTransition(fake.db, input({ to: 'BANNED', permission: 'user.ban', approvalLevel: 'L7' }))
    expect(result).toEqual({ from: 'ACTIVE', to: 'BANNED', accountStateVersion: 8 })
  })

  it('fails closed when a required lifecycle precondition is not proven', async () => {
    const fake = fakeDb({ state: 'PENDING_VERIFICATION', version: 7 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({ to: 'ACTIVE', actor: { id: '42', type: 'user' }, permission: null, preconditionSatisfied: false }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

    expect(fake.writes()).toBe(0)
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

    expect(result).toEqual({
      from: 'UNREGISTERED',
      to: 'PENDING_VERIFICATION',
      accountStateVersion: 2,
    })
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

    expect(result).toEqual({
      from: 'PENDING_VERIFICATION',
      to: 'ACTIVE',
      accountStateVersion: 8,
    })
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
      }),
    )

    expect(result).toEqual({
      from: 'PENDING_VERIFICATION',
      to: 'DELETED',
      accountStateVersion: 3,
    })
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

    expect(result).toEqual({
      from: 'BANNED',
      to: 'RESTORED',
      accountStateVersion: 5,
    })
  })

  it('rejects a concurrent compare-and-set race without mutating state', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 }, 0)

    await expect(
      applyAccountStateTransition(fake.db, input({ expectedVersion: 7 })),
    ).rejects.toMatchObject({ code: 'CONFLICT' })

    expect(fake.row).toEqual({ state: 'ACTIVE', version: 7 })
    expect(fake.writes()).toBe(1)
  })

  it('rejects an operator transition when the actor type is not authorized', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 7 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({ actor: { id: 'admin-1', type: 'admin' } }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(fake.writes()).toBe(0)
  })

  it('rejects missing users without attempting a write', async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => null,
              run: async () => ({ meta: { changes: 1 } }),
            }
          },
        }
      },
    } as unknown as D1Database

    await expect(applyAccountStateTransition(db, input())).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})