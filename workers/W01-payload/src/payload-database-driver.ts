export type W01PayloadDatabaseEnvironment = Readonly<{
  PAYLOAD_DATABASE_DRIVER?: string
  HYPERDRIVE?: Readonly<{ connectionString?: string }>
  D1?: unknown
}>

/**
 * @deprecated-next-version
 * Reason: The D1/SQLite Payload provider remains available for local/test and legacy migration workflows.
 * Replacement: W01 Neon PostgreSQL adapter selected by the production Wrangler config.
 * Removal: Next release.
 * Condition: Payload CLI/schema generation and every supported test fixture use Neon or isolated schema-source tooling; no D1 binding is required.
 */
export type W01PayloadDatabaseSelection =
  | Readonly<{ kind: 'd1' }>
  | Readonly<{ kind: 'neon'; connectionString: string }>

/**
 * Neon is selected explicitly in the production Wrangler config and requires
 * its Hyperdrive binding. The legacy D1 adapter is available only when the
 * provider flag is omitted or set to "d1" AND a real local/test D1 binding
 * exists. A D1-free production config can never fall back to SQLite/D1.
 */
export function resolveW01PayloadDatabaseDriver(
  env: W01PayloadDatabaseEnvironment,
): W01PayloadDatabaseSelection {
  const configured = env.PAYLOAD_DATABASE_DRIVER?.trim().toLowerCase()

  if (!configured || configured === 'd1') {
    if (!env.D1) throw new Error('W01_D1_BINDING_REQUIRED')
    return Object.freeze({ kind: 'd1' })
  }
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
