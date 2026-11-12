export type W01PayloadDatabaseEnvironment = Readonly<{
  PAYLOAD_DATABASE_DRIVER?: string
  HYPERDRIVE?: Readonly<{ connectionString?: string }>
}>

export type W01PayloadDatabaseSelection =
  | Readonly<{ kind: 'd1' }>
  | Readonly<{ kind: 'neon'; connectionString: string }>

/**
 * D1 is the safe default. Neon is selected only by an explicit runtime flag
 * and must have the matching Hyperdrive binding; configuration errors fail
 * closed instead of silently falling back to a different database.
 */
export function resolveW01PayloadDatabaseDriver(
  env: W01PayloadDatabaseEnvironment,
): W01PayloadDatabaseSelection {
  const configured = env.PAYLOAD_DATABASE_DRIVER?.trim().toLowerCase() || 'd1'

  if (configured === 'd1') return Object.freeze({ kind: 'd1' })
  if (configured !== 'neon') {
    throw new Error('W01_UNSUPPORTED_PAYLOAD_DATABASE_DRIVER')
  }

  const connectionString = env.HYPERDRIVE?.connectionString?.trim()
  if (!connectionString) {
    throw new Error('W01_NEON_HYPERDRIVE_BINDING_MISSING')
  }

  let parsed: URL
  try {
    parsed = new URL(connectionString)
  } catch {
    throw new Error('W01_NEON_HYPERDRIVE_CONNECTION_STRING_INVALID')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('W01_NEON_HYPERDRIVE_CONNECTION_STRING_INVALID')
  }

  return Object.freeze({ kind: 'neon', connectionString })
}
