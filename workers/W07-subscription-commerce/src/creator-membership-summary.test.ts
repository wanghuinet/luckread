import { describe, expect, it } from 'vitest'
import { getCreatorMembershipSummary, SubscriptionRuntimeError } from './subscription-runtime.js'

type SummaryRow = Record<string, unknown>

function fakeDb(options: {
  plans?: SummaryRow
  subscriptions?: SummaryRow
  invalidPlanQuery?: boolean
} = {}): D1Database {
  const queries: Array<{ sql: string; values: unknown[] }> = []
  return {
    prepare(sql: string) {
      let values: unknown[] = []
      return {
        bind(...bound: unknown[]) {
          values = bound
          return this
        },
        async first() {
          queries.push({ sql, values })
          if (values.length !== 1 || values[0] !== 'creator_1') {
            throw new Error('summary must be scoped to the trusted creator identity')
          }
          if (sql.includes('FROM membership_plans')) {
            if (options.invalidPlanQuery) return { total: -1, draft: 0, active: 0, paused: 0, retired: 0 }
            return options.plans ?? { total: 3, draft: 1, active: 1, paused: 1, retired: 0 }
          }
          if (sql.includes('FROM membership_subscriptions')) {
            return options.subscriptions ?? {
              total: 5, pending: 1, active: 2, pastDue: 0, paused: 1,
              canceled: 1, expired: 0, activeSubscribers: 2,
            }
          }
          throw new Error('unexpected SQL')
        },
      } as unknown as D1PreparedStatement
    },
  } as unknown as D1Database
}

describe('creator membership summary', () => {
  it('aggregates only creator-owned plans and subscriptions without returning subscriber identifiers or money', async () => {
    const summary = await getCreatorMembershipSummary(fakeDb(), 'creator_1')
    expect(summary).toEqual({
      plans: { total: 3, draft: 1, active: 1, paused: 1, retired: 0 },
      subscriptions: {
        total: 5, pending: 1, active: 2, pastDue: 0, paused: 1,
        canceled: 1, expired: 0, activeSubscribers: 2,
      },
    })
    expect(JSON.stringify(summary)).not.toContain('subscriberId')
    expect(JSON.stringify(summary)).not.toContain('priceMinor')
    expect(JSON.stringify(summary)).not.toContain('revenue')
  })

  it('reports zero counts from authoritative aggregate rows without inventing activity', async () => {
    const summary = await getCreatorMembershipSummary(fakeDb({
      plans: { total: 0, draft: 0, active: 0, paused: 0, retired: 0 },
      subscriptions: {
        total: 0, pending: 0, active: 0, pastDue: 0, paused: 0,
        canceled: 0, expired: 0, activeSubscribers: 0,
      },
    }), 'creator_1')
    expect(summary.plans.total).toBe(0)
    expect(summary.subscriptions.total).toBe(0)
    expect(summary.subscriptions.activeSubscribers).toBe(0)
  })

  it('fails closed on malformed or internally inconsistent aggregate counts', async () => {
    await expect(getCreatorMembershipSummary(fakeDb({ invalidPlanQuery: true }), 'creator_1'))
      .rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 })
    await expect(getCreatorMembershipSummary(fakeDb({
      plans: { total: 2, draft: 1, active: 1, paused: 1, retired: 0 },
    }), 'creator_1')).rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 })
  })

  it('does not accept an empty or malformed creator identity', async () => {
    await expect(getCreatorMembershipSummary(fakeDb(), '   '))
      .rejects.toBeInstanceOf(SubscriptionRuntimeError)
  })
})
