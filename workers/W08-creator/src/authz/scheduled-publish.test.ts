import { describe, expect, it } from 'vitest'
import worker from '../worker.js'
import { handleScheduledPublishPermission } from './scheduled-publish.js'

type RoleFixture = { roleId: string; scopeType: string; scopeId: string | null }
type UserFixture = { accountState: string; roles: RoleFixture[] }
type CreatorFixture = { creatorId: string; userId: string; status: string }

class FakeStatement {
  values: unknown[] = []

  constructor(private readonly db: FakeD1, readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
    this.db.reads++
    if (this.db.fail) throw new Error('D1 unavailable')

    if (this.sql.includes('FROM creators WHERE creator_id = ?')) {
      const creator = this.db.creators.get(String(this.values[0]))
      if (!creator || creator.status !== 'ACTIVE') return null
      return { creatorId: creator.creatorId, userId: creator.userId } as T
    }

    if (this.sql.includes('FROM "user"')) {
      const user = this.db.users.get(String(this.values[0]))
      return (user ? { accountState: user.accountState } : null) as T | null
    }

    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.reads++
    if (this.db.fail) throw new Error('D1 unavailable')
    if (!this.sql.includes('FROM role_assignments')) return { results: [] }
    const user = this.db.users.get(String(this.values[0]))
    return { results: (user?.roles ?? []).map((role) => ({
      roleId: role.roleId,
      scopeType: role.scopeType,
      scopeId: role.scopeId,
    })) as T[] }
  }
}

class FakeD1 {
  creators = new Map<string, CreatorFixture>()
  users = new Map<string, UserFixture>()
  reads = 0
  fail = false

  prepare(sql: string) {
    return new FakeStatement(this, sql)
  }
}

const baseBody = { creatorId: 'creator-123' }

function setup(layer: 'L2' | 'L3' | 'L4' = 'L3') {
  const db = new FakeD1()
  db.creators.set('creator-123', {
    creatorId: 'creator-123',
    userId: 'creator-user-1',
    status: 'ACTIVE',
  })
  const roleId = layer === 'L2' ? 'verified_user' : layer === 'L3' ? 'creator' : 'ip_principal'
  db.users.set('creator-user-1', {
    accountState: 'ACTIVE',
    roles: [{
      roleId,
      scopeType: 'global',
      scopeId: null,
    }],
  })
  return { db, env: { D1_01: db as unknown as D1Database } }
}

function makeRequest(
  body: unknown = baseBody,
  extraHeaders: Record<string, string> = {},
  path = '/internal/authz/check-scheduled-publish',
) {
  return new Request('https://luckread-w08-creator.internal' + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': 'scheduled-publish-authz-test',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })
}

describe('W08 background scheduled-publish permission', () => {
  it('allows an active L3 Creator using only the canonical creatorId', async () => {
    const { db, env } = setup()
    const response = await handleScheduledPublishPermission(makeRequest(), env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'ALLOW',
      policyVersion: 'casl-l0-l8-v1',
      layer: 'L3',
      action: 'content.publish.own',
      resourceType: 'Content',
      ownerUserId: 'creator-user-1',
      creatorId: 'creator-123',
    })
    expect(db.reads).toBe(3)
  })

  it('routes the existing W01-to-W08 service binding operation without a user session', async () => {
    const { env } = setup()
    const response = await worker.fetch(makeRequest(), env as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'ALLOW',
      ownerUserId: 'creator-user-1',
      creatorId: 'creator-123',
    })
  })

  it('allows an active L4 Creator policy context without accepting a caller-supplied layer', async () => {
    const { env } = setup('L4')
    const response = await handleScheduledPublishPermission(makeRequest(), env)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'ALLOW',
      layer: 'L4',
      ownerUserId: 'creator-user-1',
    })
  })

  it('denies when the Creator identity is missing or no longer ACTIVE', async () => {
    const { db, env } = setup()
    db.creators.set('creator-123', {
      creatorId: 'creator-123',
      userId: 'creator-user-1',
      status: 'SUSPENDED',
    })

    const response = await handleScheduledPublishPermission(makeRequest(), env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'CREATOR_NOT_ACTIVE',
    })
    expect(db.reads).toBe(1)
  })

  it('denies a non-ACTIVE account even when its Creator record is active', async () => {
    const { db, env } = setup()
    db.users.set('creator-user-1', {
      accountState: 'RESTRICTED',
      roles: [{ roleId: 'creator', scopeType: 'global', scopeId: null }],
    })

    const response = await handleScheduledPublishPermission(makeRequest(), env)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'ACCOUNT_NOT_ACTIVE',
    })
  })

  it('denies when the creator role has been revoked or the resolved layer is below L3', async () => {
    const revoked = setup()
    revoked.db.users.set('creator-user-1', { accountState: 'ACTIVE', roles: [] })
    const revokedResponse = await handleScheduledPublishPermission(makeRequest(), revoked.env)
    await expect(revokedResponse.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'LAYER_RESOLUTION_DENIED',
    })

    const l2 = setup('L2')
    const l2Response = await handleScheduledPublishPermission(makeRequest(), l2.env)
    await expect(l2Response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'CREATOR_LAYER_REQUIRED',
    })
  })

  it('rejects caller-supplied owner, subject, layer, account, or role facts', async () => {
    const { db, env } = setup()
    const response = await handleScheduledPublishPermission(makeRequest({
      ...baseBody,
      ownerUserId: 'forged-owner',
      subjectId: 'forged-subject',
      layer: 'L8',
      accountState: 'ACTIVE',
      roles: ['super_admin'],
    }), env)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'CALLER_SUPPLIED_AUTHORIZATION_CONTEXT',
    })
    expect(db.reads).toBe(0)
  })

  it('rejects non-W01, credential-bearing, or malformed transport calls before D1 access', async () => {
    const invalidCalls = [
      makeRequest(baseBody, { 'X-LuckRead-Caller': 'W05' }),
      makeRequest(baseBody, { 'X-LuckRead-Transport-Version': '2.0' }),
      makeRequest(baseBody, { 'X-LuckRead-Correlation-Id': '' }),
      makeRequest(baseBody, { Cookie: 'session=must-not-cross-the-binding' }),
      makeRequest(baseBody, { Authorization: 'Bearer must-not-cross-the-binding' }),
    ]

    for (const request of invalidCalls) {
      const { db, env } = setup()
      const response = await handleScheduledPublishPermission(request, env)
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        decision: 'DENY',
        reasonCode: 'INVALID_SERVICE_CALLER',
      })
      expect(db.reads).toBe(0)
    }
  })

  it('fails closed when D1-01 authorization facts are unavailable', async () => {
    const { db, env } = setup()
    db.fail = true
    const response = await handleScheduledPublishPermission(makeRequest(), env)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'AUTHORIZATION_INPUT_UNAVAILABLE',
    })
  })
})
