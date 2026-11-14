import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolConfig } from 'pg'
import {
  getW05SocialWorkerDependencies,
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
      'commentCreateStore',
      'commentListReadStore',
      'commentMutationStore',
      'commentNotificationContextStore',
      'contentLikerReadStore',
      'favoriteListReadStore',
      'favoriteMutationStore',
      'favoriteStatusReadStore',
      'favoriteMutationStore',
      'favoriteStatusReadStore',
      'followListReadStore',
      'followStore',
      'followingAuthorIdsReadStore',
      'likeMutationStore',
      'likeStatusReadStore',
      'likeTargetContextReadStore',
      'notificationEnqueueStore',
      'profileChannelReadStore',
      'relationshipGraphReadStore',
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
