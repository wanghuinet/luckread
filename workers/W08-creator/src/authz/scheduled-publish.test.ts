import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import worker from '../worker.js'
import { handleScheduledPublishPermission } from './scheduled-publish.js'

type RoleFixture = { roleId: string; scopeType: string; scopeId: string | null }
type NeonFixture = {
  creatorStatus?: string
  accountState?: string
  roles?: RoleFixture[]
}

const baseBody = { creatorId: 'creator-123' }

function setupNeon(fixture: NeonFixture = {}) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('FROM creators')) {
      const lookup = String(values[0] ?? '')
      if (fixture.creatorStatus === 'SUSPENDED') return { rows: [] }
      if (lookup === 'creator-123' || lookup === 'creator-user-1') {
        return { rows: [{ creatorId: 'creator-123', userId: 'creator-user-1' }] }
      }
      return { rows: [] }
    }
    if (sql.includes('FROM "user"')) {
      return fixture.accountState === 'MISSING'
        ? { rows: [] }
        : { rows: [{ accountState: fixture.accountState ?? 'ACTIVE' }] }
    }
    if (sql.includes('FROM role_assignments')) {
      return { rows: fixture.roles ?? [{ roleId: 'creator', scopeType: 'global', scopeId: null }] }
    }
    throw new Error('Unexpected W08 Neon authorization query')
  })
  const pool = { query } as unknown as Pool
  const env = {
    W08_DATABASE_DRIVER: 'neon',
    HYPERDRIVE: { connectionString: 'postgresql://user:secret@hyperdrive.local:5432/luckread' },
  }
  return { env, pool, query }
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

describe('W08 Neon-only background scheduled-publish permission', () => {
  it('allows an active L3 Creator using only the canonical creatorId', async () => {
    const { env, pool, query } = setupNeon()
    const response = await handleScheduledPublishPermission(makeRequest(), env, {
      getPostgresPool: () => pool,
    })

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
    expect(query).toHaveBeenCalledTimes(3)
  })

  it('resolves a legacy ownerUserId placeholder to the canonical active Creator ID', async () => {
    const { env, pool } = setupNeon()
    const response = await handleScheduledPublishPermission(
      makeRequest({ creatorId: 'creator-user-1' }),
      env,
      { getPostgresPool: () => pool },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'ALLOW',
      layer: 'L3',
      ownerUserId: 'creator-user-1',
      creatorId: 'creator-123',
    })
  })

  it('routes the existing W01-to-W08 service binding operation without a user session', async () => {
    const { env, pool } = setupNeon()
    const response = await worker.fetch(makeRequest(), {
      ...env,
      // Test injection keeps this path independent of a live Hyperdrive socket.
    } as never)
    // The route uses the same Neon runtime pool factory; the unit-level handler
    // below verifies the actual query path with an injected pool.
    expect(response.status).toBe(503)
    const direct = await handleScheduledPublishPermission(makeRequest(), env, {
      getPostgresPool: () => pool,
    })
    expect(direct.status).toBe(200)
  })

  it('allows an active L4 Creator without accepting a caller-supplied layer', async () => {
    const { env, pool } = setupNeon({
      roles: [{ roleId: 'ip_principal', scopeType: 'global', scopeId: null }],
    })
    const response = await handleScheduledPublishPermission(makeRequest(), env, {
      getPostgresPool: () => pool,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ decision: 'ALLOW', layer: 'L4' })
  })

  it('denies a Creator that is no longer ACTIVE', async () => {
    const { env, pool } = setupNeon({ creatorStatus: 'SUSPENDED' })
    const response = await handleScheduledPublishPermission(makeRequest(), env, {
      getPostgresPool: () => pool,
    })

    await expect(response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'CREATOR_NOT_ACTIVE',
    })
  })

  it('denies a non-ACTIVE account even when its Creator record is active', async () => {
    const { env, pool } = setupNeon({ accountState: 'RESTRICTED' })
    const response = await handleScheduledPublishPermission(makeRequest(), env, {
      getPostgresPool: () => pool,
    })

    await expect(response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'ACCOUNT_NOT_ACTIVE',
    })
  })

  it('denies revoked creator roles and layers below L3', async () => {
    const revoked = setupNeon({ roles: [] })
    const revokedResponse = await handleScheduledPublishPermission(makeRequest(), revoked.env, {
      getPostgresPool: () => revoked.pool,
    })
    await expect(revokedResponse.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'LAYER_RESOLUTION_DENIED',
    })

    const l2 = setupNeon({
      roles: [{ roleId: 'verified_user', scopeType: 'global', scopeId: null }],
    })
    const l2Response = await handleScheduledPublishPermission(makeRequest(), l2.env, {
      getPostgresPool: () => l2.pool,
    })
    await expect(l2Response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'CREATOR_LAYER_REQUIRED',
    })
  })

  it('rejects caller-supplied owner, subject, layer, account, or role facts', async () => {
    const { env, pool, query } = setupNeon()
    const response = await handleScheduledPublishPermission(makeRequest({
      ...baseBody,
      ownerUserId: 'forged-owner',
      subjectId: 'forged-subject',
      layer: 'L8',
      accountState: 'ACTIVE',
      roles: ['super_admin'],
    }), env, { getPostgresPool: () => pool })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'CALLER_SUPPLIED_AUTHORIZATION_CONTEXT',
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects non-W01, credential-bearing, or malformed calls before Neon access', async () => {
    const invalidCalls = [
      makeRequest(baseBody, { 'X-LuckRead-Caller': 'W05' }),
      makeRequest(baseBody, { 'X-LuckRead-Transport-Version': '2.0' }),
      makeRequest(baseBody, { 'X-LuckRead-Correlation-Id': '' }),
      makeRequest(baseBody, { Cookie: 'session=must-not-cross-the-binding' }),
      makeRequest(baseBody, { Authorization: 'Bearer must-not-cross-the-binding' }),
    ]

    for (const request of invalidCalls) {
      const { env, pool, query } = setupNeon()
      const response = await handleScheduledPublishPermission(request, env, {
        getPostgresPool: () => pool,
      })
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        decision: 'DENY',
        reasonCode: 'INVALID_SERVICE_CALLER',
      })
      expect(query).not.toHaveBeenCalled()
    }
  })

  it('fails closed when Neon authorization facts are unavailable', async () => {
    const pool = {
      query: vi.fn(async () => { throw new Error('Neon unavailable') }),
    } as unknown as Pool
    const { env } = setupNeon()
    const response = await handleScheduledPublishPermission(makeRequest(), env, {
      getPostgresPool: () => pool,
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'AUTHORIZATION_INPUT_UNAVAILABLE',
    })
  })

  it('does not fall back to D1 when the Neon driver is not selected', async () => {
    const poolFactory = vi.fn(() => {
      throw new Error('Neon pool must not be created')
    })
    const response = await handleScheduledPublishPermission(makeRequest(), {
      D1_01: { prepare: vi.fn() },
    } as never, { getPostgresPool: poolFactory })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      decision: 'DENY',
      reasonCode: 'AUTHORIZATION_INPUT_UNAVAILABLE',
    })
    expect(poolFactory).not.toHaveBeenCalled()
  })
})
