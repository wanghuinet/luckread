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
    const fake = fakeDb({ state: 'ACTIVE', version: 1 })

    await expect(applyAccountStateTransition(fake.db, input({ permission: 'user.freeze' }))).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(fake.writes()).toBe(0)
  })

  it('requires L7 approval for ACTIVE -> BANNED', async () => {
    const fake = fakeDb({ state: 'ACTIVE', version: 3 })

    await expect(applyAccountStateTransition(fake.db, input({ to: 'BANNED', permission: 'user.ban', approvalLevel: null }))).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const result = await applyAccountStateTransition(fake.db, input({ to: 'BANNED', permission: 'user.ban', approvalLevel: 'L7' }))
    expect(result).toEqual({ from: 'ACTIVE', to: 'BANNED', accountStateVersion: 4 })
  })

  it('fails closed when a required lifecycle precondition is not proven', async () => {
    const fake = fakeDb({ state: 'PENDING_VERIFICATION', version: 1 })

    await expect(
      applyAccountStateTransition(
        fake.db,
        input({ to: 'ACTIVE', actor: { id: '42', type: 'user' }, permission: null, preconditionSatisfied: false }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })

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