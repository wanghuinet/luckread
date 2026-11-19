import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  getW06ModerationDatabase,
  getW06ModerationPostgresPool,
  getW06ModerationQueueReadStore,
  getW06ModerationCaseDetailReadStore,
  resolveW06ModerationDatabaseDriver,
} from './moderation-database-runtime.js'

describe('W06 moderation database runtime admission', () => {
  it('selects the Neon Hyperdrive with no production D1 binding and preserves existing service/queue bindings', () => {
    const source = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'))
    const config = JSON.parse(readFileSync(new URL('../../wrangler.neon.jsonc', import.meta.url), 'utf8'))
    expect(source.d1_databases).toContainEqual(expect.objectContaining({
      binding: 'D1_03',
      database_name: 'secondary',
      database_id: 'bda1d247-a371-4244-91ae-aef96034db7f',
    }))
    expect(config.d1_databases ?? []).toEqual([])
    const hyperdrive = (config.hyperdrive ?? []).find((binding: { binding?: string }) => binding.binding === 'HYPERDRIVE_D1_03')

    expect(config.vars?.W06_MODERATION_DATABASE_DRIVER).toBe('neon')
    expect(hyperdrive).toEqual({
      binding: 'HYPERDRIVE_D1_03',
      id: '7c8831416c18494faee04b96aa551cb9',
    })
    expect(config.compatibility_flags).toContain('nodejs_compat')
    expect(config.services).toContainEqual({
      binding: 'W03_CONTENT_MODERATION',
      service: 'luckread-w03',
    })
    expect(config.queues?.consumers).toContainEqual(expect.objectContaining({
      queue: 'luckread-auth013-account-state',
      dead_letter_queue: 'luckread-auth013-account-state-dlq',
    }))
  })

  it('does not route moderation queue reads through the legacy D1 provider', () => {
    const d1 = { prepare() {}, batch() {} } as unknown as D1Database
    const env = { D1_03: d1, W06_MODERATION_DATABASE_DRIVER: 'd1' }

    expect(resolveW06ModerationDatabaseDriver(env)).toBe('d1')
    expect(getW06ModerationDatabase(env)).toBe(d1)
    expect(() => getW06ModerationQueueReadStore(env)).toThrow('W06_POSTGRES_POOL_REQUIRES_NEON_DRIVER')
    expect(getW06ModerationCaseDetailReadStore(env)).toBeUndefined()
  })

  it('defaults to Neon when the driver is omitted and never falls back to an available D1 binding', () => {
    const d1 = { prepare() {}, batch() {} } as unknown as D1Database
    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread_governance',
    }
    const env = { D1_03: d1, HYPERDRIVE_D1_03: binding }

    expect(resolveW06ModerationDatabaseDriver(env)).toBe('neon')
    expect(getW06ModerationDatabase(env)).not.toBe(d1)
    expect(getW06ModerationQueueReadStore(env)).toBeDefined()
    expect(getW06ModerationCaseDetailReadStore(env)).toBeDefined()
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

  it('caches one PostgreSQL pool, compatibility bridge and Neon read stores per Hyperdrive binding', async () => {
    const binding = {
      connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread_governance',
    }
    const env = {
      D1_03: {} as D1Database,
      W06_MODERATION_DATABASE_DRIVER: 'neon',
      HYPERDRIVE_D1_03: binding,
    }

    const poolAdapter = getW06ModerationPostgresPool(env)
    expect(getW06ModerationPostgresPool(env)).toBe(poolAdapter)
    expect(getW06ModerationDatabase(env)).toBe(getW06ModerationDatabase(env))
    expect(getW06ModerationQueueReadStore(env)).toBe(getW06ModerationQueueReadStore(env))
    expect(getW06ModerationCaseDetailReadStore(env)).toBe(getW06ModerationCaseDetailReadStore(env))
    expect(getW06ModerationQueueReadStore(env)).toBeDefined()
  })
})
