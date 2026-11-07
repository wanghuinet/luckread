import { Client } from 'pg'

const connectionString = process.env.NEON_DATABASE_URL_LUCKREAD
if (!connectionString) throw new Error('NEON_DATABASE_URL_LUCKREAD is required')

const url = new URL(connectionString)
if (
  !['postgres:', 'postgresql:'].includes(url.protocol) ||
  !url.hostname.endsWith('.neon.tech') ||
  url.pathname !== '/luckread' ||
  !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode')) ||
  url.searchParams.get('channel_binding') !== 'require'
) {
  throw new Error('Connection target must be the approved Neon database luckread with TLS and channel binding required')
}

const client = new Client({
  connectionString,
  connectionTimeoutMillis: 15_000,
  query_timeout: 15_000,
  enableChannelBinding: true,
})

let connected = false
let transactionOpen = false

try {
  await client.connect()
  connected = true

  const tlsSocket = client.connection?.stream
  if (tlsSocket?.encrypted !== true || tlsSocket?.authorized !== true) {
    throw new Error('NEON_TLS_VERIFICATION_FAILED')
  }

  await client.query('BEGIN READ ONLY')
  transactionOpen = true

  const identity = await client.query(
    "SELECT current_database() AS database_name, current_setting('server_version') AS server_version",
  )
  const actualDatabase = identity.rows[0]?.database_name
  if (actualDatabase !== 'luckread') {
    throw new Error('NEON_DATABASE_NAME_MISMATCH')
  }
  if (!String(identity.rows[0]?.server_version ?? '').startsWith('18.')) {
    throw new Error('NEON_POSTGRESQL_VERSION_MISMATCH')
  }

  const schemas = await client.query(
    "SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%' ORDER BY nspname",
  )
  const schemaNames = schemas.rows.map((row) => row.nspname)
  const publicSchemaExists = schemaNames.includes('public')
  const extraSchemas = schemaNames.filter((name) => name !== 'public')

  const relations = await client.query(
    "SELECT COUNT(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
    "AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')",
  )
  const customTypes = await client.query(
    "SELECT COUNT(*)::int AS count FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'",
  )
  const routines = await client.query(
    "SELECT COUNT(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'",
  )
  const otherObjects = await client.query(
    "SELECT COUNT(*)::int AS count FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
    "UNION ALL " +
    "SELECT COUNT(*)::int FROM pg_collation c JOIN pg_namespace n ON n.oid = c.collnamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
    "UNION ALL " +
    "SELECT COUNT(*)::int FROM pg_conversion c JOIN pg_namespace n ON n.oid = c.connamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
    "UNION ALL " +
    "SELECT COUNT(*)::int FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
    "UNION ALL " +
    "SELECT COUNT(*)::int FROM pg_ts_dict d JOIN pg_namespace n ON n.oid = d.dictnamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
    "UNION ALL " +
    "SELECT COUNT(*)::int FROM pg_ts_parser p JOIN pg_namespace n ON n.oid = p.prsnamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
    "UNION ALL " +
    "SELECT COUNT(*)::int FROM pg_ts_template t JOIN pg_namespace n ON n.oid = t.tmplnamespace " +
    "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
    "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'",
  )
  const extensions = await client.query(
    "SELECT COUNT(*)::int AS count FROM pg_extension WHERE extname <> 'plpgsql'",
  )
  const globalObjects = await client.query(
    "SELECT COUNT(*)::int AS count FROM pg_event_trigger " +
    "UNION ALL SELECT COUNT(*)::int FROM pg_publication " +
    "UNION ALL SELECT COUNT(*)::int FROM pg_foreign_data_wrapper " +
    "UNION ALL SELECT COUNT(*)::int FROM pg_foreign_server",
  )

  const counts = {
    extraSchemas: extraSchemas.length,
    relations: relations.rows[0].count,
    customTypes: customTypes.rows[0].count,
    routines: routines.rows[0].count,
    otherObjects: otherObjects.rows.reduce((sum, row) => sum + row.count, 0),
    nonDefaultExtensions: extensions.rows[0].count,
    globalObjects: globalObjects.rows.reduce((sum, row) => sum + row.count, 0),
  }
  const clean =
    publicSchemaExists &&
    counts.extraSchemas === 0 &&
    counts.relations === 0 &&
    counts.customTypes === 0 &&
    counts.routines === 0 &&
    counts.otherObjects === 0 &&
    counts.nonDefaultExtensions === 0 &&
    counts.globalObjects === 0

  await client.query('ROLLBACK')
  transactionOpen = false

  const report = {
    status: clean ? 'PASS_EMPTY' : 'BLOCKED_NOT_EMPTY',
    targetDatabase: actualDatabase,
    serverVersion: identity.rows[0].server_version,
    tlsVerified: true,
    channelBindingRequired: true,
    readOnlyTransactionRolledBack: true,
    objects: counts,
    businessDataImport: false,
    ddlExecuted: false,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!clean) process.exitCode = 1
} catch (error) {
  if (transactionOpen) {
    try { await client.query('ROLLBACK') } catch { /* keep credentials and driver details out of logs */ }
  }
  const code = typeof error?.code === 'string' ? error.code : 'NEON_D1_01_PREFLIGHT_FAILED'
  process.stderr.write(`D1-01 Neon read-only preflight failed: ${code}\n`)
  process.exitCode = 1
} finally {
  if (connected) {
    try { await client.end() } catch { /* do not emit raw driver details */ }
  }
}
