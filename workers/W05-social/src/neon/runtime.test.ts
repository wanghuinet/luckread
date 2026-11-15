import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolConfig } from 'pg'
import {
  getW05SocialWorkerDependencies,
  getW05NotificationPushDeliveryDependencies,
  getW05PushEndpointPostgresDatabase,
  resolveW05PushEndpointDatabaseDriver,
  resolveW05SocialDatabaseDriver,
} from './runtime.js'

function fakePool(): Pool {
  return {
    query: vi.fn(async () => ({ rows: [] })),
    on: vi.fn(),
  } as unknown as Pool
}

describe('W05 Neon runtime composition', () => {
  it('keeps D1 as the safe default without creating a PostgreSQL pool', () => {
    const poolFactory = vi.fn(() => fakePool())

    expect(resolveW05SocialDatabaseDriver({})).toBe('d1')
    expect(getW05SocialWorkerDependencies({}, poolFactory)).toEqual({})
    expect(poolFactory).not.toHaveBeenCalled()
  })

  it('rejects unsupported driver values and missing or invalid Hyperdrive connection strings', () => {
    expect(() => resolveW05SocialDatabaseDriver({ W05_DATABASE_DRIVER: 'mysql' }))
      .toThrow('W05_DATABASE_DRIVER_UNSUPPORTED')
    expect(() => getW05SocialWorkerDependencies({ W05_DATABASE_DRIVER: 'neon' }))
      .toThrow('W05_HYPERDRIVE_D1_02_BINDING_REQUIRED')
    expect(() => getW05SocialWorkerDependencies({
      W05_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_02: { connectionString: 'https://example.invalid/database' },
    })).toThrow('W05_HYPERDRIVE_D1_02_CONNECTION_STRING_INVALID')
  })

  it('composes all existing injection-ready PostgreSQL stores over one cached Hyperdrive pool', () => {
    const binding = { connectionString: 'postgresql://user:secret@hyperdrive.example/db?sslmode=require' }
    const pool = fakePool()
    let capturedConfig: PoolConfig | undefined
    const poolFactory = (config: PoolConfig): Pool => {
      capturedConfig = config
      return pool
    }
    const env = { W05_DATABASE_DRIVER: 'neon', HYPERDRIVE_D1_02: binding }

    const first = getW05SocialWorkerDependencies(env, poolFactory)
    const second = getW05SocialWorkerDependencies(env, poolFactory)

    expect(first).toBe(second)
    expect(Object.keys(first).sort()).toEqual([
      'blockMuteListReadStore',
      'blockMuteRelationStore',
      'commentCreateStore',
      'commentListReadStore',
      'commentMutationStore',
      'commentNotificationContextStore',
      'contentLikerReadStore',
      'favoriteListReadStore',
      'favoriteMutationStore',
      'favoriteStatusReadStore',
      'followListReadStore',
      'followStore',
      'followingAuthorIdsReadStore',
      'likeMutationStore',
      'likeStatusReadStore',
      'likeTargetContextReadStore',
      'notificationEnqueueStore',
      'notificationPreferencesStore',
      'pollConfigurationStore',
      'pollDeleteStore',
      'pollReadStore',
      'pollVoteStore',
      'profileChannelReadStore',
      'profilePinStore',
      'relationshipGraphReadStore',
      'replyAudienceStore',
      'repostStore',
      'shareStore',
      'socialClosureReadStore',
      'socialTargetsReadStore',
      'socialTokenSyncStore',
    ])
    expect(capturedConfig).toMatchObject({
      connectionString: binding.connectionString,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    })
  })
})

describe('W05 Neon notification push composition', () => {
  it('composes only W05-owned push stores on the shared D1-02 pool and caches them', () => {
    const binding = { connectionString: 'postgresql://user:secret@hyperdrive.example/db?sslmode=require' }
    const pool = fakePool()
    const poolFactory = vi.fn(() => pool)
    const env = { W05_DATABASE_DRIVER: 'neon', HYPERDRIVE_D1_02: binding }

    const first = getW05NotificationPushDeliveryDependencies(env, poolFactory)
    const second = getW05NotificationPushDeliveryDependencies(env, poolFactory)

    expect(first).toBe(second)
    expect(Object.keys(first).sort()).toEqual([
      'deliveryClaimStore',
      'fanoutStore',
      'receiptStore',
      'sendResultStore',
    ])
    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveProperty('endpointAccessStore')
  })

  it('uses a separate D1-03 Neon Hyperdrive only for W09-owned push endpoint access', async () => {
    const socialBinding = { connectionString: 'postgresql://user:secret@social.example/db?sslmode=require' }
    const endpointBinding = {
      connectionString: 'postgresql://user:secret@governance.example:5432/luckread_governance?sslmode=require',
    }
    const pool = fakePool()
    const poolFactory = vi.fn(() => pool)
    const env = {
      W05_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_02: socialBinding,
      W05_PUSH_ENDPOINT_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_03: endpointBinding,
    }

    expect(resolveW05PushEndpointDatabaseDriver(env)).toBe('neon')
    expect(getW05PushEndpointPostgresDatabase(env, poolFactory)).toBe(pool)
    const dependencies = getW05NotificationPushDeliveryDependencies(env, poolFactory)

    expect(dependencies.endpointAccessStore).toBeDefined()
    await expect(dependencies.endpointAccessStore?.listActiveForRecipient('recipient-1', 10))
      .resolves.toEqual([])
    expect(poolFactory).toHaveBeenCalledTimes(2)
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM notification_push_endpoints'),
      ['recipient-1', 10],
    )
  })

  it('fails closed when Neon is selected for D1-03 but its binding or database identity is invalid', () => {
    expect(() => resolveW05PushEndpointDatabaseDriver({
      W05_PUSH_ENDPOINT_DATABASE_DRIVER: 'postgres',
    })).toThrow('W05_PUSH_ENDPOINT_DATABASE_DRIVER_UNSUPPORTED')
    expect(() => getW05PushEndpointPostgresDatabase({
      W05_PUSH_ENDPOINT_DATABASE_DRIVER: 'neon',
    })).toThrow('W05_HYPERDRIVE_D1_03_BINDING_REQUIRED')
    expect(() => getW05PushEndpointPostgresDatabase({
      W05_PUSH_ENDPOINT_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_03: {
        connectionString: 'postgresql://user:secret@governance.example:5432/luckread?sslmode=require',
      },
    })).toThrow('W05_HYPERDRIVE_D1_03_CONNECTION_STRING_INVALID')
  })

  it('keeps D1 as the safe default for scheduled push delivery', () => {
    const poolFactory = vi.fn(() => fakePool())
    expect(getW05NotificationPushDeliveryDependencies({}, poolFactory)).toEqual({})
    expect(poolFactory).not.toHaveBeenCalled()
  })
})
