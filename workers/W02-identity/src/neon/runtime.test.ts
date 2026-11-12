import { afterAll, describe, expect, it } from 'vitest'

import {
  getW02PostgresPool,
  isW02NeonRuntime,
  resolveW02DatabaseDriver,
} from './runtime.js'

describe('W02 database driver selection', () => {
  it('keeps D1 as the default and does not require a Hyperdrive binding', () => {
    expect(resolveW02DatabaseDriver({})).toBe('d1')
    expect(resolveW02DatabaseDriver({ W02_DATABASE_DRIVER: 'd1' })).toBe('d1')
    expect(isW02NeonRuntime({})).toBe(false)
  })

  it('rejects unknown drivers instead of silently selecting D1', () => {
    expect(() => resolveW02DatabaseDriver({ W02_DATABASE_DRIVER: 'postgres' })).toThrow(
      'W02_DATABASE_DRIVER_UNSUPPORTED',
    )
  })

  it('requires an explicit PostgreSQL Hyperdrive binding for Neon mode', () => {
    expect(isW02NeonRuntime({ W02_DATABASE_DRIVER: 'neon' })).toBe(true)
    expect(() => getW02PostgresPool({ W02_DATABASE_DRIVER: 'neon' })).toThrow(
      'W02_HYPERDRIVE_BINDING_REQUIRED',
    )
    expect(() => getW02PostgresPool({
      W02_DATABASE_DRIVER: 'neon',
      HYPERDRIVE: { connectionString: 'https://example.test/database' },
    })).toThrow('W02_HYPERDRIVE_CONNECTION_STRING_INVALID')
  })

  it('reuses one lazy Pool for the same Hyperdrive binding', async () => {
    const binding = { connectionString: 'postgresql://user:password@localhost:5432/luckread' }
    const env = { W02_DATABASE_DRIVER: 'neon', HYPERDRIVE: binding }
    const first = getW02PostgresPool(env)
    const second = getW02PostgresPool(env)
    expect(first).toBe(second)
    await first.end()
  })
})
