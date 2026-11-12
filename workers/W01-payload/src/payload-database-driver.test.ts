import { describe, expect, it } from 'vitest'

import { resolveW01PayloadDatabaseDriver } from './payload-database-driver.js'

describe('W01 Payload database driver selection', () => {
  it('keeps D1 as the default when no migration flag is configured', () => {
    expect(resolveW01PayloadDatabaseDriver({})).toEqual({ kind: 'd1' })
  })

  it('keeps D1 when the deployed compatibility flag is explicitly d1', () => {
    expect(resolveW01PayloadDatabaseDriver({ PAYLOAD_DATABASE_DRIVER: 'd1' }))
      .toEqual({ kind: 'd1' })
  })

  it('selects Neon only when explicitly requested with a PostgreSQL Hyperdrive binding', () => {
    const connectionString = 'postgres://hyperdrive-user:secret@hyperdrive.local:5432/luckread'
    expect(resolveW01PayloadDatabaseDriver({
      PAYLOAD_DATABASE_DRIVER: 'neon',
      HYPERDRIVE: { connectionString },
    })).toEqual({ kind: 'neon', connectionString })
  })

  it('fails closed when Neon is requested without its Hyperdrive binding', () => {
    expect(() => resolveW01PayloadDatabaseDriver({ PAYLOAD_DATABASE_DRIVER: 'neon' }))
      .toThrow('W01_NEON_HYPERDRIVE_BINDING_MISSING')
  })

  it('rejects unsupported database modes instead of falling back to D1', () => {
    expect(() => resolveW01PayloadDatabaseDriver({ PAYLOAD_DATABASE_DRIVER: 'sqlite' }))
      .toThrow('W01_UNSUPPORTED_PAYLOAD_DATABASE_DRIVER')
  })

  it('rejects non-PostgreSQL Hyperdrive URLs', () => {
    expect(() => resolveW01PayloadDatabaseDriver({
      PAYLOAD_DATABASE_DRIVER: 'neon',
      HYPERDRIVE: { connectionString: 'https://hyperdrive.invalid/luckread' },
    })).toThrow('W01_NEON_HYPERDRIVE_CONNECTION_STRING_INVALID')
  })
})
