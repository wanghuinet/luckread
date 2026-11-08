import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')

const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000 })
const syntheticUserId = 'auth015-lifecycle-' + randomUUID().replaceAll('-', '').slice(0, 20)
const createdAt = new Date('2026-01-01T00:00:00.000Z')
const deletionRequestedAt = new Date('2026-02-01T12:30:00.000Z')
const deletedAt = new Date('2026-02-16T12:30:00.000Z')

const assert = (condition, message) => {
  if (!condition) throw new Error('W02_AUTH015_PG_ASSERTION_FAILED: ' + message)
}

let client
let primaryError
let successReport
try {
  client = await pool.connect()
  const identity = await client.query(
    "SELECT current_setting('server_version_num')::integer AS version_num, current_database() AS database_name",
  )
  const postgresMajor = Math.floor(Number(identity.rows[0].version_num) / 10000)
  assert(postgresMajor === 18, 'PostgreSQL 18 required')
  assert(identity.rows[0].database_name === 'luckread_schema', 'unexpected database target')

  const columns = await client.query(
    "SELECT column_name, data_type, is_nullable, column_default " +
      "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user'",
  )
  const map = new Map(columns.rows.map((row) => [row.column_name, row]))
  for (const name of ['deletion_requested_at', 'deleted_at']) {
    const column = map.get(name)
    assert(column, name + ' column is missing')
    assert(column.data_type === 'timestamp with time zone', name + ' must use TIMESTAMPTZ')
    assert(column.is_nullable === 'YES', name + ' must remain nullable')
    assert(column.column_default === null, name + ' must have no inferred timestamp default')
  }

  const beforeRows = await client.query('SELECT COUNT(*)::int AS count FROM "user"')
  assert(Number(beforeRows.rows[0].count) === 0, 'Better Auth user table must remain empty before probe')

  // Exercise both fields on a synthetic Better Auth user inside a transaction.
  // The transaction is always rolled back; it is not a backfill or import.
  await client.query('BEGIN')
  try {
    await client.query(
      'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) ' +
        'VALUES ($1, $2, $3, FALSE, $4, $4)',
      [syntheticUserId, 'AUTH-015 schema probe', syntheticUserId + '@example.invalid', createdAt],
    )
    await client.query(
      'UPDATE "user" SET deletion_requested_at = $1, deleted_at = $2 WHERE id = $3',
      [deletionRequestedAt, deletedAt, syntheticUserId],
    )
    const roundTrip = await client.query(
      'SELECT deletion_requested_at, deleted_at FROM "user" WHERE id = $1',
      [syntheticUserId],
    )
    assert(roundTrip.rows.length === 1, 'synthetic lifecycle row must round-trip')
    assert(roundTrip.rows[0].deletion_requested_at instanceof Date &&
      roundTrip.rows[0].deletion_requested_at.toISOString() === deletionRequestedAt.toISOString(),
    'deletion_requested_at UTC timestamp round-trip mismatch')
    assert(roundTrip.rows[0].deleted_at instanceof Date &&
      roundTrip.rows[0].deleted_at.toISOString() === deletedAt.toISOString(),
    'deleted_at UTC timestamp round-trip mismatch')
  } finally {
    await client.query('ROLLBACK')
  }

  const afterRows = await client.query('SELECT COUNT(*)::int AS count FROM "user"')
  assert(Number(afterRows.rows[0].count) === 0, 'synthetic user was not rolled back')

  const tableCount = await client.query(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables " +
      "WHERE table_schema = 'public' AND table_name LIKE 'auth_015%'",
  )
  assert(Number(tableCount.rows[0].count) === 0, 'AUTH-015 lifecycle schema must not create a separate table')

  successReport = {
    status: 'W02_AUTH015_LIFECYCLE_WINDOWS_POSTGRES_SCHEMA_PASS',
    postgresMajor,
    assertionsPassed: 8,
    checks: {
      bothCanonicalFieldsExistOnBetterAuthUser: true,
      bothFieldsUseNativeTimestamptz: true,
      bothFieldsRemainNullable: true,
      noTimestampDefaultsOrInferredHistory: true,
      canonicalUtcTimestampsRoundTrip: true,
      syntheticUserProbeRolledBack: true,
      betterAuthUserTableRemainsEmpty: true,
      noAdditionalAuth015TableCreated: true,
    },
    productionDatabaseTouched: false,
    businessRowsImported: false,
  }
} catch (error) {
  primaryError = error
} finally {
  if (client) client.release()
  await pool.end()
}

if (primaryError) throw primaryError
if (!successReport) throw new Error('W02_AUTH015_POSTFLIGHT_EVIDENCE_INCOMPLETE')
process.stdout.write(JSON.stringify(successReport, null, 2) + '\n')
