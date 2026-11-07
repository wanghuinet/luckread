import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const databaseUrl = process.env.PAYLOAD_SCHEMA_DATABASE_URL

if (!databaseUrl) throw new Error('PAYLOAD_SCHEMA_DATABASE_URL is required')
const parsedUrl = new URL(databaseUrl)
if (
  !new Set(['127.0.0.1', 'localhost', 'postgres']).has(parsedUrl.hostname) ||
  parsedUrl.port !== '5432' ||
  parsedUrl.pathname !== '/luckread_schema_rollback'
) {
  throw new Error('Refusing to inspect a non-disposable rollback test database')
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 1_000,
})
const failures = []
const expectedTables = Object.keys(
  JSON.parse(readFileSync(path.join(root, 'src/migrations/20261101_163928_username_redirects.json'), 'utf8')).tables,
).sort()
const fixtureKey = 'neon-payload-rollback-guard-fixture'

try {
  const server = await pool.query(
    "SELECT current_database() AS database, current_setting('server_version') AS version",
  )
  if (server.rows[0].database !== 'luckread_schema_rollback' || !String(server.rows[0].version).startsWith('18.')) {
    throw new Error('Expected disposable PostgreSQL 18 rollback database')
  }

  const tables = await pool.query(
    `SELECT tablename
       FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT LIKE 'pg_%'
      ORDER BY tablename`,
  )
  const actualTables = tables.rows.map((row) => row.tablename).sort()
  const missingTables = expectedTables.filter((name) => !actualTables.includes(name))
  const unexpectedTables = actualTables.filter((name) => !expectedTables.includes(name))
  if (missingTables.length || unexpectedTables.length) {
    failures.push({ kind: 'rollback-schema-was-dropped-or-drifted', missingTables, unexpectedTables })
  }

  const fixture = await pool.query(
    'SELECT COUNT(*)::bigint AS count FROM public.payload_kv WHERE key = $1',
    [fixtureKey],
  )
  if (Number(fixture.rows[0].count) !== 1) {
    failures.push({
      kind: 'rollback-guard-fixture-not-preserved',
      expected: 1,
      actual: Number(fixture.rows[0].count),
    })
  }

  const businessTables = expectedTables.filter((table) => table !== 'payload_migrations')
  const rowCounts = {}
  for (const table of businessTables) {
    const result = await pool.query(`SELECT COUNT(*)::bigint AS count FROM public."${table}"`)
    rowCounts[table] = Number(result.rows[0].count)
  }
  if (rowCounts.payload_kv !== 1) {
    failures.push({ kind: 'rollback-guard-payload-kv-count-mismatch', actual: rowCounts.payload_kv })
  }
  for (const [table, count] of Object.entries(rowCounts)) {
    if (table !== 'payload_kv' && count !== 0) {
      failures.push({ kind: 'unexpected-rollback-fixture-data', table, count })
    }
  }

  const ledger = await pool.query('SELECT COUNT(*)::bigint AS count FROM public.payload_migrations')
  if (Number(ledger.rows[0].count) !== 1) {
    failures.push({ kind: 'rollback-guard-migration-ledger-not-preserved', actual: Number(ledger.rows[0].count) })
  }

  const report = {
    status: failures.length === 0 ? 'W01_PAYLOAD_ROLLBACK_GUARD_PASS' : 'W01_PAYLOAD_ROLLBACK_GUARD_FAIL',
    scope: 'Disposable PostgreSQL 18 only. Confirms Payload migrate:down refuses to drop the W01 baseline when business rows exist.',
    target: { host: parsedUrl.hostname, database: parsedUrl.pathname.slice(1) },
    expectedDownOutcome: 'W01_PAYLOAD_BASELINE_ROLLBACK_REFUSED',
    fixtureKey,
    actualTableNames: actualTables,
    businessTableRowCounts: rowCounts,
    migrationLedgerRows: Number(ledger.rows[0].count),
    failures,
  }
  const output = process.env.PAYLOAD_SCHEMA_ROLLBACK_REPORT ?? 'artifacts/neon/w01-payload-rollback-guard.json'
  const absolute = path.resolve(root, output)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (failures.length) process.exitCode = 1
} finally {
  await pool.end()
}
