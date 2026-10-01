import { describe, expect, it } from 'vitest'
import { transitionSubscription } from './access-state-persistence.js'

class FakeStatement {
  constructor(private readonly sqlText: string, private readonly db: FakeDb) {}
  private args: unknown[] = []
  bind(...args: unknown[]) {
    this.args = args
    this.db.statements.push({ sql: this.sqlText, args })
    return this
  }
}

class FakeDb {
  readonly statements: Array<{ sql: string; args: unknown[] }> = []
  prepare(sql: string) { return new FakeStatement(sql, this) as never }
  async batch(statements: unknown[]) {
    return statements.map((_, index) => ({ meta: { changes: index === 0 ? 1 : 3 } }))
  }
}

const input = {
  caller: 'W07' as const,
  transportVersion: '1.0' as const,
  correlationId: 'corr-revoke',
  actorUserId: 'user-a',
  idempotencyKey: 'sub-1:cancel',
  subscriptionId: 'sub-1',
  from: 'ACTIVE' as const,
  to: 'CANCELED' as const,
  expectedVersion: 7,
  actor: 'user' as const,
  entitlementAction: 'REVOKE' as const,
}

describe('W02 membership terminal entitlement persistence', () => {
  it('revoke targets every active grant owned by the subscription', async () => {
    const db = new FakeDb()
    const result = await transitionSubscription(db as never, input)

    expect(result).toMatchObject({
      subscriptionId: 'sub-1',
      status: 'CANCELED',
      version: 8,
      entitlementChanged: true,
    })

    const revoke = db.statements.find(statement => statement.sql.includes('UPDATE membership_entitlement_grants'))
    expect(revoke?.sql).toContain("WHERE subscription_id = ?")
    expect(revoke?.sql).toContain("AND status = 'ACTIVE'")
    expect(revoke?.args).toEqual(['sub-1', 'sub-1', 'CANCELED', 8])
    expect(revoke?.sql).not.toContain('WHERE entitlement_id = ?')
  })

  it('does not require a client entitlement identifier for terminal revoke', async () => {
    const db = new FakeDb()
    await expect(transitionSubscription(db as never, input)).resolves.toMatchObject({
      entitlementChanged: true,
    })
  })
})
