import { Pool } from 'pg'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
})

const expectedColumns = {
  user: [
    'id', 'name', 'email', 'email_verified', 'image', 'username', 'bio',
    'locale', 'timezone', 'account_state', 'account_state_version',
    'created_at', 'updated_at', 'two_factor_enabled',
  ],
  session: [
    'id', 'expires_at', 'token', 'created_at', 'updated_at',
    'ip_address', 'user_agent', 'user_id',
  ],
  account: [
    'id', 'account_id', 'provider_id', 'user_id', 'access_token',
    'refresh_token', 'id_token', 'access_token_expires_at',
    'refresh_token_expires_at', 'scope', 'password', 'created_at', 'updated_at',
  ],
  verification: [
    'id', 'identifier', 'value', 'expires_at', 'created_at', 'updated_at',
  ],
  twoFactor: [
    'id', 'userId', 'secret', 'backupCodes', 'verified',
    'failedVerificationCount', 'lockedUntil',
  ],
}

try {
  const identity = await pool.query(
    "SELECT current_setting('server_version_num')::int AS version_num, current_database() AS database_name",
  )
  const versionMajor = Math.floor(identity.rows[0].version_num / 10_000)
  if (versionMajor !== 18) throw new Error('Expected PostgreSQL 18, got ' + versionMajor)
  if (identity.rows[0].database_name !== 'luckread_schema') {
    throw new Error('Refusing to verify an unexpected database target')
  }

  const tableResult = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  )
  const actualTables = tableResult.rows.map((row) => row.table_name).sort()
  const expectedTables = Object.keys(expectedColumns).sort()
  const missingTables = expectedTables.filter((table) => !actualTables.includes(table))
  const unexpectedTables = actualTables.filter((table) => !expectedTables.includes(table))
  if (missingTables.length || unexpectedTables.length) {
    throw new Error('Better Auth table catalog mismatch: ' + JSON.stringify({ missingTables, unexpectedTables }))
  }

  const actualColumns = {}
  for (const table of expectedTables) {
    const result = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY column_name',
      ['public', table],
    )
    const names = result.rows.map((row) => row.column_name)
    actualColumns[table] = names
    const missing = expectedColumns[table].filter((name) => !names.includes(name))
    if (missing.length) {
      throw new Error('Required Better Auth columns missing from ' + table + ': ' + missing.join(', '))
    }
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM "' + table.replace(/"/g, '""') + '"')
    if (count.rows[0].count !== 0) {
      throw new Error('Schema-only verification found business rows in ' + table)
    }
  }

  const report = {
    status: 'W02_BETTER_AUTH_POSTGRES_SCHEMA_PASS',
    database: identity.rows[0].database_name,
    postgresMajor: versionMajor,
    generatedTables: actualTables,
    requiredColumns: expectedColumns,
    actualColumns,
    businessRowsImported: false,
    businessTableRows: Object.fromEntries(expectedTables.map((table) => [table, 0])),
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
} catch (error) {
  const message = error instanceof Error ? error.message : 'W02_SCHEMA_VERIFY_FAILED'
  process.stderr.write('W02 Better Auth PostgreSQL schema verification failed: ' + message + '\n')
  process.exitCode = 1
} finally {
  await pool.end()
}
