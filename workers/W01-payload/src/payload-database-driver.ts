export type W01PayloadDatabaseEnvironment = Readonly<{
  PAYLOAD_DATABASE_DRIVER?: string
  HYPERDRIVE?: Readonly<{ connectionString?: string }>
}>

export type W01PayloadDatabaseSelection = Readonly<{
  kind: 'neon'
  connectionString: string
}>

/**
 * W01 is Neon-only in local, CI and production environments.
 * Missing/unsupported providers and non-PostgreSQL bindings fail closed.
 */
export function resolveW01PayloadDatabaseDriver(
  env: W01PayloadDatabaseEnvironment,
): W01PayloadDatabaseSelection {
  const configured = env.PAYLOAD_DATABASE_DRIVER?.trim().toLowerCase()
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
