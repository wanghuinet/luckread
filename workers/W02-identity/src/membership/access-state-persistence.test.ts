import { describe, expect, it } from 'vitest'
import { createSubscription } from './access-state-persistence.js'

type Row = {
  subscriberId: string
  planId: string
  planVersion: number
  startedAt: string
  currentPeriodStart: string
  currentPeriodEnd: string
}

class FakeStatement {
  private values: unknown[] = []
  constructor(private readonly db: FakeDB, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this }
  async run() {
    if (!this.sql.includes('INSERT OR IGNORE')) return { meta: { changes: 0 } }
    const id = String(this.values[0])
    if (this.db.rows.has(id)) return { meta: { changes: 0 } }
    this.db.rows.set(id, {
      subscriberId: String(this.values[1]),
      planId: String(this.values[2]),
      planVersion: Number(this.values[3]),
      startedAt: String(this.values[4]),
      currentPeriodStart: String(this.values[5]),
      currentPeriodEnd: String(this.values[6]),
    })
    return { meta: { changes: 1 } }
  }
  async first<T>() {
    const id = String(this.values[0])
    return (this.db.rows.get(id) ?? null) as T | null
  }
}

class FakeDB {
  readonly rows = new Map<string, Row>()
  prepare(sql: string) { return new FakeStatement(this, sql) as never }
}

const input = {
  caller: 'W07',
  transportVersion: '1.0',
  correlationId: 'corr-create',
  actorUserId: 'user-a',
  idempotencyKey: 'sub-1:create',
  subscriptionId: 'sub-1',
  subscriberId: 'user-a',
  planId: 'plan-1',
  planVersion: 1,
  startedAt: '2026-10-01T00:00:00.000Z',
  currentPeriodStart: '2026-10-01T00:00:00.000Z',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
}

describe('W02 membership subscription persistence', () => {
  it('converges an identical create replay', async () => {
    const db = new FakeDB()
    expect(await createSubscription(db as never, input)).toEqual({
      subscriptionId: 'sub-1',
      created: true,
      version: 1,
    })
    expect(await createSubscription(db as never, input)).toEqual({
      subscriptionId: 'sub-1',
      created: false,
      version: 1,
    })
  })

  it('rejects a create replay that changes canonical subscription fields', async () => {
    const db = new FakeDB()
    await createSubscription(db as never, input)
    await expect(createSubscription(db as never, {
      ...input,
      planId: 'plan-forged',
    })).rejects.toThrow('SUBSCRIPTION_ID_CONFLICT')
  })
})
