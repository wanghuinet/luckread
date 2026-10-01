import { describe, expect, it } from 'vitest'
import {
  createSubscription,
  transitionSubscription,
} from './access-state-persistence.js'

type SubscriptionRow = {
  subscriberId: string
  planId: string
  planVersion: number
  startedAt: string
  currentPeriodStart: string
  currentPeriodEnd: string
  status: string
  version: number
}

type IdemRow = {
  ownerUserId: string
  operationId: string
  idempotencyKey: string
  requestHash: string
  status: string
  responseStatus: number
  responseJson: string
  expiresAt: string
}

class FakeDB {
  readonly subscriptions = new Map<string, SubscriptionRow>()
  readonly idempotency = new Map<string, IdemRow>()
  activeGrantCount = 1
  guard = { successful: 1, entitlementChanged: 0 }
  lastChanges = 0

  prepare(sql: string) {
    return new FakeStatement(this, sql)
  }

  async batch(statements: Array<FakeStatement>) {
    const snapshot = {
      subscriptions: new Map(this.subscriptions),
      idempotency: new Map(this.idempotency),
      guard: { ...this.guard },
      lastChanges: this.lastChanges,
      activeGrantCount: this.activeGrantCount,
    }
    const results: Array<{ meta: { changes: number } }> = []
    try {
      for (const statement of statements) results.push(await statement.run())
      return results
    } catch (error) {
      this.subscriptions.clear()
      for (const [key, value] of snapshot.subscriptions) this.subscriptions.set(key, value)
      this.idempotency.clear()
      for (const [key, value] of snapshot.idempotency) this.idempotency.set(key, value)
      this.guard = snapshot.guard
      this.lastChanges = snapshot.lastChanges
      this.activeGrantCount = snapshot.activeGrantCount
      throw error
    }
  }
}

class FakeStatement {
  private values: unknown[] = []
  constructor(private readonly db: FakeDB, private readonly sql: string) {}
  bind(...values: unknown[]) {
    this.values = values
    return this
  }

  async first<T>() {
    if (this.sql.includes('FROM membership_mutation_idempotency')) {
      const key = [this.values[0], this.values[1], this.values[2]].map(String).join(':')
      return (this.db.idempotency.get(key) ?? null) as T | null
    }
    return null
  }

  async run() {
    if (this.sql.includes('INSERT OR REPLACE INTO membership_txn_guard')) {
      this.db.guard = { successful: Number(this.db.lastChanges), entitlementChanged: 0 }
      if (this.db.guard.successful !== 1) throw new Error('CHECK constraint failed: membership_txn_guard')
      this.db.lastChanges = 1
      return { meta: { changes: 1 } }
    }

    if (this.sql.includes('UPDATE membership_txn_guard')) {
      this.db.guard.entitlementChanged = Number(this.db.lastChanges)
      this.db.lastChanges = 1
      return { meta: { changes: 1 } }
    }

    if (this.sql.includes('DELETE FROM membership_mutation_idempotency')) {
      this.lastChanges = 0
      return { meta: { changes: 0 } }
    }

    if (this.sql.includes('INSERT INTO membership_mutation_idempotency')) {
      const key = [this.values[1], this.values[2], this.values[3]].map(String).join(':')
      if (this.db.idempotency.has(key)) throw new Error('UNIQUE constraint failed')
      const fromSelect = this.sql.includes('FROM membership_txn_guard')
      const responseJson = fromSelect
        ? JSON.stringify({
            subscriptionId: this.values[6],
            status: this.values[7],
            version: this.values[8],
            entitlementChanged: this.db.guard.entitlementChanged === 1,
          })
        : String(this.values[7])
      this.db.idempotency.set(key, {
        ownerUserId: String(this.values[1]),
        operationId: String(this.values[2]),
        idempotencyKey: String(this.values[3]),
        requestHash: String(this.values[4]),
        status: 'COMPLETED',
        responseStatus: Number(this.values[5]),
        responseJson,
        expiresAt: String(this.values.at(-1)),
      })
      this.db.lastChanges = 1
      return { meta: { changes: 1 } }
    }

    if (this.sql.includes('INSERT INTO membership_subscriptions')) {
      const id = String(this.values[0])
      if (this.db.subscriptions.has(id)) throw new Error('UNIQUE constraint failed')
      this.db.subscriptions.set(id, {
        subscriberId: String(this.values[1]),
        planId: String(this.values[2]),
        planVersion: Number(this.values[3]),
        startedAt: String(this.values[4]),
        currentPeriodStart: String(this.values[5]),
        currentPeriodEnd: String(this.values[6]),
        status: 'PENDING',
        version: 1,
      })
      this.db.lastChanges = 1
      return { meta: { changes: 1 } }
    }

    if (this.sql.includes('UPDATE membership_subscriptions')) {
      const id = String(this.values[4])
      const row = this.db.subscriptions.get(id)
      const from = String(this.values[5])
      const expected = Number(this.values[6])
      const actor = String(this.values[7])
      const actorUserId = String(this.values[8])
      if (!row || row.status !== from || row.version !== expected || (actor === 'user' && row.subscriberId !== actorUserId)) {
        this.db.lastChanges = 0
        return { meta: { changes: 0 } }
      }
      row.status = String(this.values[0])
      row.version += 1
      this.db.lastChanges = 1
      return { meta: { changes: 1 } }
    }

    if (this.sql.includes('UPDATE membership_entitlement_grants')) {
      const changed = this.db.activeGrantCount
      this.db.activeGrantCount = 0
      this.db.lastChanges = changed
      return { meta: { changes: changed } }
    }

    this.db.lastChanges = 0
    return { meta: { changes: 0 } }
  }
}

const createInput = {
  caller: 'W07',
  transportVersion: '1.0',
  correlationId: 'corr-create',
  actorUserId: 'user-a',
  idempotencyKey: 'idem-create-1',
  subscriptionId: 'sub-1',
  subscriberId: 'user-a',
  planId: 'plan-1',
  planVersion: 1,
  startedAt: '2026-10-01T00:00:00.000Z',
  currentPeriodStart: '2026-10-01T00:00:00.000Z',
  currentPeriodEnd: '2026-11-01T00:00:00.000Z',
}

describe('Membership transactional idempotency', () => {
  it('replays the completed create result and rejects same-key changed input', async () => {
    const db = new FakeDB()
    expect(await createSubscription(db as never, createInput)).toEqual({
      subscriptionId: 'sub-1',
      created: true,
      version: 1,
    })
    expect(await createSubscription(db as never, createInput)).toEqual({
      subscriptionId: 'sub-1',
      created: true,
      version: 1,
    })
    await expect(createSubscription(db as never, {
      ...createInput,
      subscriptionId: 'sub-2',
    })).rejects.toThrow('IDEMPOTENCY_KEY_REUSE_CONFLICT')
    expect(db.subscriptions.size).toBe(1)
  })

  it('replays a cancellation without applying the state transition twice', async () => {
    const db = new FakeDB()
    db.subscriptions.set('sub-1', {
      subscriberId: 'user-a',
      planId: 'plan-1',
      planVersion: 1,
      startedAt: '2026-10-01T00:00:00.000Z',
      currentPeriodStart: '2026-10-01T00:00:00.000Z',
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
      status: 'ACTIVE',
      version: 3,
    })
    const input = {
      caller: 'W07',
      transportVersion: '1.0',
      correlationId: 'corr-cancel',
      actorUserId: 'user-a',
      idempotencyKey: 'idem-cancel-1',
      subscriptionId: 'sub-1',
      from: 'ACTIVE' as const,
      to: 'CANCELED' as const,
      expectedVersion: 3,
      actor: 'user' as const,
      entitlementAction: 'REVOKE' as const,
    }
    expect(await transitionSubscription(db as never, input)).toEqual({
      subscriptionId: 'sub-1',
      status: 'CANCELED',
      version: 4,
      entitlementChanged: true,
    })
    expect(await transitionSubscription(db as never, input)).toEqual({
      subscriptionId: 'sub-1',
      status: 'CANCELED',
      version: 4,
      entitlementChanged: true,
    })
    expect(db.subscriptions.get('sub-1')?.version).toBe(4)
    expect(db.activeGrantCount).toBe(0)
  })

  it('returns a CAS conflict for a different key at the stale version', async () => {
    const db = new FakeDB()
    db.subscriptions.set('sub-1', {
      subscriberId: 'user-a',
      planId: 'plan-1',
      planVersion: 1,
      startedAt: '2026-10-01T00:00:00.000Z',
      currentPeriodStart: '2026-10-01T00:00:00.000Z',
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
      status: 'ACTIVE',
      version: 4,
    })
    await expect(transitionSubscription(db as never, {
      caller: 'W07',
      transportVersion: '1.0',
      correlationId: 'corr-cancel-2',
      actorUserId: 'user-a',
      idempotencyKey: 'different-key',
      subscriptionId: 'sub-1',
      from: 'ACTIVE',
      to: 'CANCELED',
      expectedVersion: 3,
      actor: 'user',
      entitlementAction: 'REVOKE',
    })).rejects.toThrow('VERSION_CONFLICT')
  })
})
