import { describe, expect, it } from 'vitest'

import { resolveW01PayloadDatabaseDriver } from '../../src/payload-database-driver.js'

describe('W01 Payload database driver selection', () => {
  it('requires an explicit Neon provider', () => {
    expect(() => resolveW01PayloadDatabaseDriver({}))
      .toThrow('W01_UNSUPPORTED_PAYLOAD_DATABASE_DRIVER')
    expect(() => resolveW01PayloadDatabaseDriver({ PAYLOAD_DATABASE_DRIVER: 'd1' }))
      .toThrow('W01_UNSUPPORTED_PAYLOAD_DATABASE_DRIVER')
  })

  it('selects Neon only with a PostgreSQL Hyperdrive binding', () => {
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

  it('rejects unsupported database modes', () => {
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
