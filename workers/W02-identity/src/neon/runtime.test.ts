import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  getW02PostgresPool,
  isW02NeonRuntime,
  resolveW02DatabaseDriver,
} from './runtime.js'

describe('W02 database driver selection', () => {
  it('requires explicit Neon selection and rejects missing or legacy D1 configuration', () => {
    expect(() => resolveW02DatabaseDriver({})).toThrow('W02_DATABASE_DRIVER_UNSUPPORTED')
    expect(() => resolveW02DatabaseDriver({ W02_DATABASE_DRIVER: 'd1' })).toThrow('W02_DATABASE_DRIVER_UNSUPPORTED')
    expect(resolveW02DatabaseDriver({ W02_DATABASE_DRIVER: 'neon' })).toBe('neon')
    expect(isW02NeonRuntime({ W02_DATABASE_DRIVER: 'neon' })).toBe(true)
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


describe('W02 production Neon Wrangler config', () => {
  it('declares zero production D1 bindings and retains the existing D1-01 Hyperdrive', () => {
    const config = JSON.parse(readFileSync(new URL('../../wrangler.neon.jsonc', import.meta.url), 'utf8'))
    expect(config.name).toBe('luckread-w02')
    expect(config.vars?.W02_DATABASE_DRIVER).toBe('neon')
    expect(config.d1_databases ?? []).toEqual([])
    expect(config.hyperdrive).toContainEqual({
      binding: 'HYPERDRIVE',
      id: '0c53a1bb9bc0484bac146e8ae2d3158b',
    })
    expect(config.queues?.producers).toEqual(expect.arrayContaining([
      { binding: 'AUTH013_QUEUE', queue: 'luckread-auth013-account-state' },
      { binding: 'AUTH013_PROJECTION_QUEUE', queue: 'luckread-auth013-account-state-projection' },
    ]))
  })
})
