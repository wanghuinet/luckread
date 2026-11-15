import { describe, expect, it } from 'vitest'

import {
  getW06ModerationDatabase,
  getW06ModerationPostgresPool,
  getW06ModerationQueueReadStore,
  resolveW06ModerationDatabaseDriver,
} from './moderation-database-runtime.js'

describe('W06 moderation database runtime admission', () => {
  it('keeps D1 as the default and selects the existing D1 moderation database', () => {
    const d1 = { prepare() {}, batch() {} } as unknown as D1Database
    const env = { D1_03: d1 }

    expect(resolveW06ModerationDatabaseDriver(env)).toBe('d1')
    expect(getW06ModerationDatabase(env)).toBe(d1)
    expect(getW06ModerationQueueReadStore(env)).toBeUndefined()
  })

  it('rejects unknown drivers instead of silently falling back to D1', () => {
    expect(() => resolveW06ModerationDatabaseDriver({
      D1_03: {} as D1Database,
      W06_MODERATION_DATABASE_DRIVER: 'postgres',
    })).toThrow('W06_MODERATION_DATABASE_DRIVER_UNSUPPORTED')
  })

  it('requires the existing D1-03 Hyperdrive binding for an explicit Neon selection', () => {
    expect(() => getW06ModerationDatabase({
      D1_03: {} as D1Database,
      W06_MODERATION_DATABASE_DRIVER: 'neon',
    })).toThrow('W06_HYPERDRIVE_D1_03_BINDING_REQUIRED')
  })

  it('rejects a Hyperdrive connection string for a different database', () => {
    expect(() => getW06ModerationPostgresPool({
      D1_03: {} as D1Database,
      W06_MODERATION_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_03: {
        connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckreadpro',
      },
    })).toThrow('W06_HYPERDRIVE_D1_03_CONNECTION_STRING_INVALID')
  })

  it('caches one PostgreSQL pool, D1 bridge and keyset read store per Hyperdrive binding', async () => {
    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread_governance',
    }
    const env = {
      D1_03: {} as D1Database,
      W06_MODERATION_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_03: binding,
    }

    const pool = getW06ModerationPostgresPool(env)
    expect(getW06ModerationPostgresPool(env)).toBe(pool)
    expect(getW06ModerationDatabase(env)).toBe(getW06ModerationDatabase(env))
    expect(getW06ModerationQueueReadStore(env)).toBe(getW06ModerationQueueReadStore(env))
    expect(getW06ModerationQueueReadStore(env)).toBeDefined()
    await pool.end()
  })
})
