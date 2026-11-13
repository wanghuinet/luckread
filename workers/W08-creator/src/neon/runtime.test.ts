import { describe, expect, it } from 'vitest'

import {
  getW08CreatorStore,
  getW08PostgresPool,
  resolveW08DatabaseDriver,
} from './runtime.js'

describe('W08 database driver selection', () => {
  it('keeps explicit D1 rollback and resolves the configured Neon runtime', () => {
    expect(resolveW08DatabaseDriver({})).toBe('d1')
    expect(resolveW08DatabaseDriver({ W08_DATABASE_DRIVER: 'd1' })).toBe('d1')
    expect(resolveW08DatabaseDriver({ W08_DATABASE_DRIVER: 'neon' })).toBe('neon')
    expect(() => getW08CreatorStore({})).toThrow('W08_D1_01_BINDING_REQUIRED')
  })

  it('rejects unknown drivers rather than silently falling back to D1', () => {
    expect(() => resolveW08DatabaseDriver({ W08_DATABASE_DRIVER: 'postgres' }))
      .toThrow('W08_DATABASE_DRIVER_UNSUPPORTED')
  })

  it('requires the existing Hyperdrive binding in explicit Neon mode', () => {
    const env = { W08_DATABASE_DRIVER: 'neon' }
    expect(() => getW08CreatorStore(env)).toThrow('W08_HYPERDRIVE_BINDING_REQUIRED')
    expect(() => getW08PostgresPool(env)).toThrow('W08_HYPERDRIVE_BINDING_REQUIRED')
  })

  it('rejects non-PostgreSQL Hyperdrive connection strings', () => {
    expect(() => getW08PostgresPool({
      W08_DATABASE_DRIVER: 'neon',
      HYPERDRIVE: { connectionString: 'https://example.invalid/database' },
    })).toThrow('W08_HYPERDRIVE_CONNECTION_STRING_INVALID')
  })

  it('reuses one lazy Pool and creator store for the same binding', async () => {
    const binding = { connectionString: 'postgresql://user:password@localhost:5432/luckread' }
    const env = { W08_DATABASE_DRIVER: 'neon', HYPERDRIVE: binding }

    const firstPool = getW08PostgresPool(env)
    const secondPool = getW08PostgresPool(env)
    const firstStore = getW08CreatorStore(env)
    const secondStore = getW08CreatorStore(env)

    expect(firstPool).toBe(secondPool)
    expect(firstStore).toBe(secondStore)
    await firstPool.end()
  })
})
