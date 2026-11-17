import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'

import { handlePermissionCheck } from './handler.js'

type UserFixture = {
  accountState: string
  roles: Array<{ roleId: string; scopeType: string; scopeId: string | null }>
}
type TestPrincipal = { userId: string; accountState: string; layer: string }

class FakePostgresPool {
  constructor(private readonly users: Map<string, UserFixture>) {}

  async query(sql: string, values: unknown[] = []) {
    if (sql.includes('FROM "user"')) {
      const user = this.users.get(String(values[0]))
      return { rows: user ? [{ accountState: user.accountState }] : [], rowCount: user ? 1 : 0 }
    }
    if (sql.includes('FROM role_assignments')) {
      const user = this.users.get(String(values[0]))
      return { rows: (user?.roles ?? []).map((role) => ({ ...role })), rowCount: user?.roles.length ?? 0 }
    }
    throw new Error('Unexpected PostgreSQL authorization query')
  }
}

function fakeW02(principal: TestPrincipal | null, forwardedAuthorizations: Array<string | null> = []): Fetcher {
  return {
    async fetch(request: Request): Promise<Response> {
      if (new URL(request.url).pathname !== '/internal/auth/principal') return new Response(null, { status: 404 })
      forwardedAuthorizations.push(request.headers.get('authorization'))
      return principal
        ? Response.json({ active: true, ...principal })
        : Response.json({ active: false }, { status: 401 })
    },
  } as unknown as Fetcher
}

const post = (body: unknown, withSession = true, authorization?: string) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (withSession) headers.set('cookie', 'better-auth.session_token=test-session')
  if (authorization) headers.set('authorization', authorization)
  return new Request('https://luckread-w08-creator.internal/internal/authz/check-permission', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function setup(principal: TestPrincipal | null, users: Map<string, UserFixture> = new Map(), forwarded: Array<string | null> = []) {
  const pool = new FakePostgresPool(users) as unknown as Pool
  const env = {
    W08_DATABASE_DRIVER: 'neon',
    HYPERDRIVE: { connectionString: 'postgresql://user:secret@hyperdrive.local:5432/luckread' },
    W02_AUTH: fakeW02(principal, forwarded),
  }
  return { env, dependencies: { getPostgresPool: () => pool }, forwarded }
}

describe('W08 internal CASL permission endpoint on Neon', () => {
  it('derives L2 application permission from W02 session and persisted PostgreSQL role assignments', async () => {
    const users = new Map<string, UserFixture>([['verified-1', {
      accountState: 'ACTIVE',
      roles: [{ roleId: 'verified_user', scopeType: 'global', scopeId: null }],
    }]])
    const state = setup({ userId: 'verified-1', accountState: 'ACTIVE', layer: 'L2' }, users)
    const response = await handlePermissionCheck(post({
      action: 'creator.application.apply',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'verified-1' },
    }), state.env, state.dependencies)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ decision: 'ALLOW', action: 'creator.application.apply' })
  })

  it('forwards native Bearer credentials to W02 for canonical session validation', async () => {
    const users = new Map<string, UserFixture>([['verified-bearer', {
      accountState: 'ACTIVE',
      roles: [{ roleId: 'verified_user', scopeType: 'global', scopeId: null }],
    }]])
    const state = setup({ userId: 'verified-bearer', accountState: 'ACTIVE', layer: 'L2' }, users)
    const forwarded: Array<string | null> = []
    const requestState = setup({ userId: 'verified-bearer', accountState: 'ACTIVE', layer: 'L2' }, users, forwarded)
    const response = await handlePermissionCheck(post({
      action: 'creator.application.apply',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'verified-bearer' },
    }, false, 'Bearer native-session-token'), requestState.env, requestState.dependencies)

    expect(response.status).toBe(200)
    expect(forwarded).toEqual(['Bearer native-session-token'])
    expect(await response.json()).toMatchObject({ decision: 'ALLOW', action: 'creator.application.apply' })
    expect(state.forwarded).toEqual([])
  })

  it('fails closed when a caller attempts to submit subjectId, layer, or account state', async () => {
    const state = setup({ userId: 'regular-1', accountState: 'ACTIVE', layer: 'L2' })
    for (const forgedContext of [
      { subjectId: 'reviewer-7' },
      { layer: 'L7' },
      { accountState: 'ACTIVE' },
    ]) {
      const response = await handlePermissionCheck(post({
        ...forgedContext,
        action: 'creator.application.review',
        resourceType: 'CreatorApplication',
      }), state.env, state.dependencies)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        decision: 'DENY',
        reasonCode: 'CALLER_SUPPLIED_AUTHORIZATION_CONTEXT',
      })
    }
  })

  it('allows only L7/L8 to review applications based on authoritative PostgreSQL role facts', async () => {
    const users = new Map<string, UserFixture>([
      ['reviewer-7', { accountState: 'ACTIVE', roles: [{ roleId: 'admin', scopeType: 'global', scopeId: null }] }],
      ['reviewer-6', { accountState: 'ACTIVE', roles: [{ roleId: 'moderator', scopeType: 'global', scopeId: null }] }],
    ])
    for (const [userId, layer, expected] of [
      ['reviewer-7', 'L7', 'ALLOW'],
      ['reviewer-6', 'L6', 'DENY'],
    ] as const) {
      const state = setup({ userId, accountState: 'ACTIVE', layer }, users)
      const response = await handlePermissionCheck(post({
        action: 'creator.application.review',
        resourceType: 'CreatorApplication',
      }), state.env, state.dependencies)
      expect(await response.json()).toMatchObject({ decision: expected })
    }
  })

  it('limits no-session requests to anonymous public-read policy without querying PostgreSQL', async () => {
    const state = setup(null)
    const response = await handlePermissionCheck(post({
      action: 'content.read.public',
      resourceType: 'Content',
      resourceAttributes: { visibility: 'public', state: 'published' },
    }, false), state.env, state.dependencies)
    expect(await response.json()).toMatchObject({ decision: 'ALLOW' })
  })

  it('loads account and effective role facts from the existing Neon database', async () => {
    const users = new Map<string, UserFixture>([['verified-neon', {
      accountState: 'ACTIVE',
      roles: [{ roleId: 'verified_user', scopeType: 'global', scopeId: null }],
    }]])
    const state = setup({ userId: 'verified-neon', accountState: 'ACTIVE', layer: 'L2' }, users)
    const response = await handlePermissionCheck(post({
      action: 'creator.application.apply',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'verified-neon' },
    }), state.env, state.dependencies)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ decision: 'ALLOW', action: 'creator.application.apply' })
  })
})
