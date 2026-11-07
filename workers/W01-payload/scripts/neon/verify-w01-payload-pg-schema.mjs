import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, '../..')
const databaseUrl = process.env.PAYLOAD_SCHEMA_DATABASE_URL
const neonMode = process.env.PAYLOAD_SCHEMA_NEON_VERIFY === 'true'

if (!databaseUrl) throw new Error('PAYLOAD_SCHEMA_DATABASE_URL is required')

const parsedUrl = new URL(databaseUrl)
const allowedLocalHosts = new Set(['127.0.0.1', 'localhost', 'postgres'])
const localMode =
  allowedLocalHosts.has(parsedUrl.hostname) &&
  parsedUrl.port === '5432' &&
  parsedUrl.pathname === '/luckread_schema'
const approvedNeonMode =
  neonMode &&
  ['postgres:', 'postgresql:'].includes(parsedUrl.protocol) &&
  parsedUrl.hostname.endsWith('.neon.tech') &&
  parsedUrl.pathname === '/luckread' &&
  ['require', 'verify-ca', 'verify-full'].includes(parsedUrl.searchParams.get('sslmode')) &&
  parsedUrl.searchParams.get('channel_binding') === 'require'

if (!localMode && !approvedNeonMode) {
  throw new Error('Refusing to verify a database outside the local schema test or explicit D1-01 Neon target')
}

const expectedDatabase = neonMode ? 'luckread' : 'luckread_schema'
const snapshotPath = path.join(
  packageRoot,
  'src/migrations/20261101_163928_username_redirects.json',
)
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
const expectedTables = Object.keys(snapshot.tables).sort()
const expectedColumnsByTable = Object.fromEntries(
  Object.entries(snapshot.tables).map(([tableName, definition]) => [
    tableName,
    Object.keys(definition.columns ?? {}).sort(),
  ]),
)
const expectedIndexNames = Object.values(snapshot.tables)
  .flatMap((definition) => Object.keys(definition.indexes ?? {}))
  .sort()
const expectedForeignKeys = Object.values(snapshot.tables)
  .flatMap((definition) => Object.values(definition.foreignKeys ?? {}))
  .map((foreignKey) => ({
    constraintName: foreignKey.name,
    tableName: foreignKey.tableFrom,
    referencedTable: foreignKey.tableTo,
    columnsFrom: foreignKey.columnsFrom,
    columnsTo: foreignKey.columnsTo,
    onDelete: foreignKey.onDelete,
    onUpdate: foreignKey.onUpdate,
  }))
  .sort((a, b) => a.constraintName.localeCompare(b.constraintName))

const requiredColumns = {
  users: ['username', 'display_name', 'identity_id', 'reset_password_requested_at'],
  media: ['alt', 'owner_user_id', 'upload_idempotency_key', 'upload_fingerprint', 'prefix', '_objectkey'],
  redirects: [
    'from',
    'redirect_scope',
    'identity_id',
    'source_username',
    'destination_username',
    'expires_at',
  ],
  redirects_rels: ['parent_id', 'path', 'users_id'],
  payload_locked_documents_rels: ['redirects_id'],
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 1_000,
  enableChannelBinding: true,
})
const failures = []
const report = {
  reportVersion: 1,
  scope: neonMode
    ? 'W01 Payload PostgreSQL schema postflight against the explicitly approved Neon D1-01 target; no business data import or production Worker switch.'
    : 'W01 Payload PostgreSQL schema-only bootstrap against disposable local PostgreSQL; no Neon or D1 production access.',
  target: { host: parsedUrl.hostname, database: parsedUrl.pathname.slice(1) },
  productionAuthorityChanged: false,
  neonConnectionAttempted: neonMode,
  businessDataImported: false,
}

try {
  if (neonMode) {
    const tlsClient = await pool.connect()
    try {
      const tlsSocket = tlsClient.connection?.stream
      if (tlsSocket?.encrypted !== true || tlsSocket?.authorized !== true) {
        throw new Error('Neon client TLS verification failed')
      }
      await tlsClient.query('SELECT 1')
    } finally {
      tlsClient.release()
    }
    report.tlsVerified = true
  }

  const server = await pool.query(
    "SELECT current_database() AS database, current_setting('server_version') AS version",
  )
  report.server = server.rows[0]
  if (report.server.database !== expectedDatabase || !String(report.server.version).startsWith('18.')) {
    throw new Error('Expected PostgreSQL 18 at the exact approved database name')
  }

  const tableResult = await pool.query(
    `SELECT tablename
       FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT LIKE 'pg_%'
      ORDER BY tablename`,
  )
  const actualTables = tableResult.rows.map((row) => row.tablename).sort()
  report.expectedTableNames = expectedTables
  report.actualTableNames = actualTables

  const missingTables = expectedTables.filter((table) => !actualTables.includes(table))
  const unexpectedTables = actualTables.filter((table) => !expectedTables.includes(table))
  if (missingTables.length || unexpectedTables.length) {
    failures.push({ kind: 'table-catalog-drift', missingTables, unexpectedTables })
  }

  const columnResult = await pool.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  )
  const columnsByTable = {}
  for (const column of columnResult.rows) {
    columnsByTable[column.table_name] ??= []
    columnsByTable[column.table_name].push({
      name: column.column_name,
      dataType: column.data_type,
      nullable: column.is_nullable === 'YES',
      default: column.column_default,
    })
  }
  report.columnsByTable = columnsByTable

  for (const [table, expected] of Object.entries(expectedColumnsByTable)) {
    const actual = (columnsByTable[table] ?? []).map((column) => column.name).sort()
    const missing = expected.filter((column) => !actual.includes(column))
    const unexpected = actual.filter((column) => !expected.includes(column))
    if (missing.length || unexpected.length) {
      failures.push({ kind: 'column-catalog-drift', table, missing, unexpected })
    }
  }

  for (const [table, required] of Object.entries(requiredColumns)) {
    const actual = new Set((columnsByTable[table] ?? []).map((column) => column.name))
    const missing = required.filter((column) => !actual.has(column))
    if (missing.length) failures.push({ kind: 'required-column-missing', table, missing })
  }

  const indexResult = await pool.query(
    `SELECT tablename AS table_name, indexname AS index_name, indexdef
       FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname`,
  )
  report.indexes = indexResult.rows
  const actualIndexNames = new Set(indexResult.rows.map((row) => row.index_name))
  const missingIndexes = expectedIndexNames.filter((name) => !actualIndexNames.has(name))
  if (missingIndexes.length) failures.push({ kind: 'source-index-missing', missingIndexes })

  const fkResult = await pool.query(
    `SELECT source_table.relname AS table_name,
            constraint_row.conname AS constraint_name,
            target_table.relname AS referenced_table,
            ARRAY(
              SELECT source_column.attname
                FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinal)
                JOIN pg_catalog.pg_attribute source_column
                  ON source_column.attrelid = constraint_row.conrelid
                 AND source_column.attnum = key_column.attnum
               ORDER BY key_column.ordinal
            ) AS columns_from,
            ARRAY(
              SELECT target_column.attname
                FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinal)
                JOIN pg_catalog.pg_attribute target_column
                  ON target_column.attrelid = constraint_row.confrelid
                 AND target_column.attnum = key_column.attnum
               ORDER BY key_column.ordinal
            ) AS columns_to,
            CASE constraint_row.confdeltype
              WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict'
              WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null'
              WHEN 'd' THEN 'set default'
            END AS on_delete,
            CASE constraint_row.confupdtype
              WHEN 'a' THEN 'no action' WHEN 'r' THEN 'restrict'
              WHEN 'c' THEN 'cascade' WHEN 'n' THEN 'set null'
              WHEN 'd' THEN 'set default'
            END AS on_update
       FROM pg_catalog.pg_constraint constraint_row
       JOIN pg_catalog.pg_class source_table ON source_table.oid = constraint_row.conrelid
       JOIN pg_catalog.pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
       JOIN pg_catalog.pg_class target_table ON target_table.oid = constraint_row.confrelid
      WHERE constraint_row.contype = 'f'
        AND source_namespace.nspname = 'public'
      ORDER BY constraint_row.conname`,
  )
  const actualForeignKeys = fkResult.rows.map((row) => ({
    constraintName: row.constraint_name,
    tableName: row.table_name,
    referencedTable: row.referenced_table,
    columnsFrom: row.columns_from,
    columnsTo: row.columns_to,
    onDelete: row.on_delete,
    onUpdate: row.on_update,
  }))
  report.foreignKeys = actualForeignKeys
  if (JSON.stringify(actualForeignKeys) !== JSON.stringify(expectedForeignKeys)) {
    failures.push({
      kind: 'foreign-key-catalog-drift',
      expected: expectedForeignKeys,
      actual: actualForeignKeys,
    })
  }

  const businessTables = expectedTables.filter((table) => table !== 'payload_migrations')
  const rowCounts = {}
  for (const table of businessTables) {
    const result = await pool.query(`SELECT COUNT(*)::bigint AS count FROM public."${table}"`)
    rowCounts[table] = Number(result.rows[0].count)
    if (rowCounts[table] !== 0) {
      failures.push({ kind: 'unexpected-business-data', table, count: rowCounts[table] })
    }
  }
  report.businessTableRowCounts = rowCounts

  const ledger = await pool.query('SELECT COUNT(*)::bigint AS count FROM public.payload_migrations')
  report.payloadMigrationLedgerRows = Number(ledger.rows[0].count)
  if (report.payloadMigrationLedgerRows !== 1) {
    failures.push({ kind: 'payload-migration-ledger-count', expected: 1, actual: report.payloadMigrationLedgerRows })
  }

  report.failures = failures
  report.status = failures.length === 0
    ? (neonMode ? 'W01_PAYLOAD_NEON_SCHEMA_PASS' : 'W01_PAYLOAD_POSTGRES_SCHEMA_PASS')
    : (neonMode ? 'W01_PAYLOAD_NEON_SCHEMA_FAIL' : 'W01_PAYLOAD_POSTGRES_SCHEMA_FAIL')
  const outputPath = process.env.PAYLOAD_SCHEMA_REPORT ?? 'artifacts/neon/w01-payload-postgres-schema.json'
  const absoluteOutput = path.resolve(packageRoot, outputPath)
  mkdirSync(path.dirname(absoluteOutput), { recursive: true })
  writeFileSync(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (failures.length > 0) process.exitCode = 1
} finally {
  await pool.end()
}
