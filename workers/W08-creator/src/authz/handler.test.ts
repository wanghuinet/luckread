import { describe, expect, it } from 'vitest'
import { handlePermissionCheck } from './handler.js'

type UserFixture = {
  accountState: string
  roles: Array<{ roleId: string; scopeType: string; scopeId: string | null }>
}
type TestPrincipal = { userId: string; accountState: string; layer: string }

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
function fakeW02(principal: TestPrincipal | null): Fetcher {
  return {
    async fetch(request: Request): Promise<Response> {
      if (new URL(request.url).pathname !== '/internal/auth/principal') return new Response(null, { status: 404 })
      return principal
        ? Response.json({ active: true, ...principal })
        : Response.json({ active: false }, { status: 401 })
    },
  } as unknown as Fetcher
}
const post = (body: unknown, withSession = true) => new Request('https://luckread-w08-creator.internal/internal/authz/check-permission', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(withSession ? { cookie: 'better-auth.session_token=test-session' } : {}),
  },
  body: JSON.stringify(body),
})
const env = (db: FakeD1, principal: TestPrincipal | null) => ({
  D1_01: db as unknown as D1Database,
  W02_AUTH: fakeW02(principal),
})

describe('W08 internal CASL permission endpoint', () => {
  it('derives L2 application permission from W02 session and persisted role assignments', async () => {
    const db = new FakeD1()
    db.users.set('verified-1', {
      accountState: 'ACTIVE',
      roles: [{ roleId: 'verified_user', scopeType: 'global', scopeId: null }],
    })
    const response = await handlePermissionCheck(post({
      action: 'creator.application.apply',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'verified-1' },
    }), env(db, { userId: 'verified-1', accountState: 'ACTIVE', layer: 'L2' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ decision: 'ALLOW', action: 'creator.application.apply' })
  })

  it('fails closed when a caller attempts to submit subjectId, layer, or account state', async () => {
    const db = new FakeD1()
    for (const forgedContext of [
      { subjectId: 'reviewer-7' },
      { layer: 'L7' },
      { accountState: 'ACTIVE' },
    ]) {
      const response = await handlePermissionCheck(post({
        ...forgedContext,
        action: 'creator.application.review',
        resourceType: 'CreatorApplication',
      }), env(db, { userId: 'regular-1', accountState: 'ACTIVE', layer: 'L2' }))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        decision: 'DENY',
        reasonCode: 'CALLER_SUPPLIED_AUTHORIZATION_CONTEXT',
      })
    }
  })

  it('allows only L7/L8 to review applications, based on the actor session and D1 role facts', async () => {
    const db = new FakeD1()
    db.users.set('reviewer-7', {
      accountState: 'ACTIVE',
      roles: [{ roleId: 'admin', scopeType: 'global', scopeId: null }],
    })
    db.users.set('reviewer-6', {
      accountState: 'ACTIVE',
      roles: [{ roleId: 'moderator', scopeType: 'global', scopeId: null }],
    })
    for (const [userId, layer, expected] of [
      ['reviewer-7', 'L7', 'ALLOW'],
      ['reviewer-6', 'L6', 'DENY'],
    ] as const) {
      const response = await handlePermissionCheck(post({
        action: 'creator.application.review',
        resourceType: 'CreatorApplication',
      }), env(db, { userId, accountState: 'ACTIVE', layer }))
      expect(await response.json()).toMatchObject({ decision: expected })
    }
  })

  it('limits no-session requests to anonymous public-read policy', async () => {
    const db = new FakeD1()
    const response = await handlePermissionCheck(post({
      action: 'content.read.public',
      resourceType: 'Content',
      resourceAttributes: { visibility: 'public', state: 'published' },
    }, false), env(db, null))
    expect(await response.json()).toMatchObject({ decision: 'ALLOW' })
  })
})
