import { describe, expect, it } from 'vitest'
import { handlePermissionCheck } from './handler.js'

type UserFixture = { accountState: string; roles: Array<{ roleId: string; scopeType: string; scopeId: string | null }> }

class FakeStatement {
  values: unknown[] = []
  constructor(private readonly db: FakeD1, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this }
  async first<T>() {
    if (this.sql.includes('FROM "user"')) {
      const user = this.db.users.get(String(this.values[0]))
      return (user ? { accountState: user.accountState } : null) as T | null
    }
    return null as T | null
  }
  async all<T>() {
    const user = this.db.users.get(String(this.values[0]))
    return { results: (user?.roles ?? []).map((role) => ({ ...role })) as T[] }
  }
}
class FakeD1 {
  users = new Map<string, UserFixture>()
  prepare(sql: string) { return new FakeStatement(this, sql) }
}
const post = (body: unknown) => new Request('https://luckread-w08-creator.internal/internal/authz/check-permission', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('W08 internal CASL permission endpoint', () => {
  it('derives L2 application permission from persisted role assignments', async () => {
    const db = new FakeD1()
    db.users.set('verified-1', {
      accountState: 'ACTIVE',
      roles: [{ roleId: 'verified_user', scopeType: 'global', scopeId: null }],
    })
    const response = await handlePermissionCheck(post({
      subjectId: 'verified-1',
      action: 'creator.application.apply',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'verified-1' },
    }), { D1_01: db as unknown as D1Database })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ decision: 'ALLOW', action: 'creator.application.apply' })
  })

  it('fails closed when a caller attempts to submit its own layer or account state', async () => {
    const db = new FakeD1()
    const response = await handlePermissionCheck(post({
      subjectId: 'verified-1',
      layer: 'L7',
      accountState: 'ACTIVE',
      action: 'creator.application.review',
      resourceType: 'CreatorApplication',
    }), { D1_01: db as unknown as D1Database })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ decision: 'DENY', reasonCode: 'CALLER_SUPPLIED_AUTHORIZATION_CONTEXT' })
  })

  it('allows only L7/L8 to review applications', async () => {
    const db = new FakeD1()
    db.users.set('reviewer-7', { accountState: 'ACTIVE', roles: [{ roleId: 'admin', scopeType: 'global', scopeId: null }] })
    db.users.set('reviewer-6', { accountState: 'ACTIVE', roles: [{ roleId: 'moderator', scopeType: 'global', scopeId: null }] })
    for (const [subjectId, expected] of [['reviewer-7', 'ALLOW'], ['reviewer-6', 'DENY']] as const) {
      const response = await handlePermissionCheck(post({
        subjectId, action: 'creator.application.review', resourceType: 'CreatorApplication',
      }), { D1_01: db as unknown as D1Database })
      expect(await response.json()).toMatchObject({ decision: expected })
    }
  })
})
