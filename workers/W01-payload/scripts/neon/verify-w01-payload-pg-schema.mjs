import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, '../..')
const databaseUrl = process.env.PAYLOAD_SCHEMA_DATABASE_URL

if (!databaseUrl) throw new Error('PAYLOAD_SCHEMA_DATABASE_URL is required')

const parsedUrl = new URL(databaseUrl)
const allowedHosts = new Set(['127.0.0.1', 'localhost', 'postgres'])
if (
  !allowedHosts.has(parsedUrl.hostname) ||
  parsedUrl.port !== '5432' ||
  parsedUrl.pathname !== '/luckread_schema'
) {
  throw new Error('Refusing to verify a non-disposable database target')
}

const snapshotPath = path.join(
  packageRoot,
  'src/migrations/20261101_163928_username_redirects.json',
)
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
const expectedTables = Object.keys(snapshot.tables).sort()

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
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 1_000,
})
const failures = []
const report = {
  reportVersion: 1,
  scope: 'W01 Payload PostgreSQL schema-only bootstrap against disposable local PostgreSQL; no Neon or D1 production access.',
  target: { host: parsedUrl.hostname, database: parsedUrl.pathname.slice(1) },
  productionAuthorityChanged: false,
  neonConnectionAttempted: false,
  businessDataImported: false,
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database, current_setting('server_version') AS version",
  )
  report.server = server.rows[0]
  if (report.server.database !== 'luckread_schema' || !String(report.server.version).startsWith('18.')) {
    throw new Error('Expected disposable PostgreSQL 18 database luckread_schema')
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
  const requiredIndexes = [
    'users_username_idx',
    'users_email_idx',
    'users_identity_id_idx',
    'media_upload_idempotency_key_idx',
    'redirects_from_idx',
    'redirects_expires_at_idx',
  ]
  const actualIndexNames = new Set(indexResult.rows.map((row) => row.index_name))
  const missingIndexes = requiredIndexes.filter((name) => !actualIndexNames.has(name))
  if (missingIndexes.length) failures.push({ kind: 'required-index-missing', missingIndexes })

  const fkResult = await pool.query(
    `SELECT conrelid::regclass::text AS table_name, conname AS constraint_name,
            confrelid::regclass::text AS referenced_table
       FROM pg_catalog.pg_constraint
      WHERE contype = 'f'
      ORDER BY table_name, constraint_name`,
  )
  report.foreignKeys = fkResult.rows

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
  if (report.payloadMigrationLedgerRows < 1) failures.push({ kind: 'payload-migration-ledger-empty' })

  report.failures = failures
  report.status = failures.length === 0 ? 'W01_PAYLOAD_POSTGRES_SCHEMA_PASS' : 'W01_PAYLOAD_POSTGRES_SCHEMA_FAIL'
  const outputPath = process.env.PAYLOAD_SCHEMA_REPORT ?? 'artifacts/neon/w01-payload-postgres-schema.json'
  const absoluteOutput = path.resolve(packageRoot, outputPath)
  mkdirSync(path.dirname(absoluteOutput), { recursive: true })
  writeFileSync(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (failures.length > 0) process.exitCode = 1
} finally {
  await pool.end()
}
