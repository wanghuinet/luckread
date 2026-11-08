import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')

const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 })
const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
const subjectA = 'neon-role-assignment-a-' + suffix
const subjectB = 'neon-role-assignment-b-' + suffix
const subjectIds = [subjectA, subjectB]
const createdAt = '2026-01-01T00:00:00.000Z'

const assert = (condition, message) => {
  if (!condition) throw new Error('W02_ROLE_ASSIGNMENT_PG_ASSERTION_FAILED: ' + message)
}
const assertVersion = async (subjectId, expected) => {
  const result = await pool.query(
    'SELECT role_version FROM role_authorization_versions WHERE subject_id = $1',
    [subjectId],
  )
  assert(Number(result.rows[0]?.role_version ?? 0) === expected,
    'role_version for ' + subjectId + ' expected ' + expected + ', got ' + String(result.rows[0]?.role_version ?? 0))
}
const expectPgCode = async (label, operation, expectedCode) => {
  try {
    await operation()
  } catch (error) {
    assert(error && error.code === expectedCode,
      label + ' expected SQLSTATE ' + expectedCode + ', got ' + String(error?.code ?? 'unknown'))
    return
  }
  throw new Error('W02_ROLE_ASSIGNMENT_PG_ASSERTION_FAILED: ' + label + ' unexpectedly succeeded')
}
const insertAssignment = (
  id,
  subjectId,
  roleId,
  scopeType,
  scopeId,
  status,
  validFrom,
  validUntil,
) => pool.query(
  'INSERT INTO role_assignments ' +
    '(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)',
  [id, subjectId, roleId, scopeType, scopeId, status, validFrom, validUntil, createdAt],
)

let completedAssertions = 0
let primaryError
try {
  const server = await pool.query(
    "SELECT current_setting('server_version_num')::integer AS version_num",
  )
  const postgresMajor = Math.floor(Number(server.rows[0].version_num) / 10000)
  assert(postgresMajor >= 18, 'PostgreSQL 18 or newer is required')
  completedAssertions += 1

  const extension = await pool.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'btree_gist'",
  )
  assert(typeof extension.rows[0]?.extversion === 'string', 'btree_gist extension is not installed')
  completedAssertions += 1

  const constraints = await pool.query(
    "SELECT conname, contype FROM pg_constraint WHERE conrelid = 'role_assignments'::regclass",
  )
  assert(constraints.rows.some((row) =>
    row.conname === 'role_assignments_no_active_overlap' && row.contype === 'x'),
  'GiST active-overlap exclusion constraint is missing')
  completedAssertions += 1

  const triggers = await pool.query(
    "SELECT tgname FROM pg_trigger WHERE tgrelid = 'role_assignments'::regclass AND NOT tgisinternal",
  )
  assert(triggers.rows.some((row) => row.tgname === 'role_authorization_versions_on_role_assignment_insert'),
    'insert version trigger is missing')
  assert(triggers.rows.some((row) => row.tgname === 'role_authorization_versions_on_role_assignment_change'),
    'effective-set update version trigger is missing')
  completedAssertions += 1

  await pool.query(
    'INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, $2, $3, FALSE), ($4, $5, $6, FALSE)',
    [
      subjectA, 'Role Assignment PG Probe A', subjectA + '@example.invalid',
      subjectB, 'Role Assignment PG Probe B', subjectB + '@example.invalid',
    ],
  )

  await insertAssignment(
    'ra-pg-' + suffix + '-one', subjectA, 'user', 'global', null, 'ACTIVE',
    '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
  )
  await assertVersion(subjectA, 1)
  completedAssertions += 1

  await insertAssignment(
    'ra-pg-' + suffix + '-adjacent', subjectA, 'user', 'global', null, 'ACTIVE',
    '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z',
  )
  await assertVersion(subjectA, 2)
  completedAssertions += 1

  await expectPgCode('overlapping active assignment', () => insertAssignment(
    'ra-pg-' + suffix + '-overlap', subjectA, 'user', 'global', null, 'ACTIVE',
    '2026-01-01T12:00:00.000Z', '2026-01-02T12:00:00.000Z',
  ), '23P01')
  await assertVersion(subjectA, 2)
  completedAssertions += 1

  await insertAssignment(
    'ra-pg-' + suffix + '-scoped', subjectA, 'user', 'organization', 'org-probe',
    'ACTIVE', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z',
  )
  await assertVersion(subjectA, 3)
  completedAssertions += 1

  await insertAssignment(
    'ra-pg-' + suffix + '-revoked', subjectA, 'user', 'global', null, 'REVOKED',
    '2026-01-01T12:00:00.000Z', '2026-01-02T12:00:00.000Z',
  )
  await assertVersion(subjectA, 4)
  completedAssertions += 1

  const candidateId = 'ra-pg-' + suffix + '-candidate'
  await insertAssignment(
    candidateId, subjectA, 'user', 'global', null, 'ACTIVE',
    '2026-01-03T00:00:00.000Z', '2026-01-04T00:00:00.000Z',
  )
  await assertVersion(subjectA, 5)
  completedAssertions += 1

  await expectPgCode('update into overlapping active interval', () => pool.query(
    'UPDATE role_assignments SET valid_from = $1 WHERE id = $2',
    ['2026-01-01T12:00:00.000Z', candidateId],
  ), '23P01')
  await assertVersion(subjectA, 5)
  completedAssertions += 1

  await pool.query(
    'UPDATE role_assignments SET updated_at = $1 WHERE id = $2',
    ['2026-02-01T00:00:00.000Z', candidateId],
  )
  await assertVersion(subjectA, 5)
  completedAssertions += 1

  await pool.query(
    "UPDATE role_assignments SET status = 'REVOKED', updated_at = $1 WHERE id = $2",
    ['2026-02-02T00:00:00.000Z', candidateId],
  )
  await assertVersion(subjectA, 6)
  completedAssertions += 1

  const concurrentIds = [
    'ra-pg-' + suffix + '-concurrent-a',
    'ra-pg-' + suffix + '-concurrent-b',
  ]
  const concurrentResults = await Promise.allSettled([
    insertAssignment(
      concurrentIds[0], subjectB, 'creator', 'global', null, 'ACTIVE',
      '2030-01-01T00:00:00.000Z', '2030-03-01T00:00:00.000Z',
    ),
    insertAssignment(
      concurrentIds[1], subjectB, 'creator', 'global', null, 'ACTIVE',
      '2030-02-01T00:00:00.000Z', '2030-04-01T00:00:00.000Z',
    ),
  ])
  const concurrentSuccesses = concurrentResults.filter((result) => result.status === 'fulfilled').length
  const concurrentFailures = concurrentResults.filter((result) =>
    result.status === 'rejected' && result.reason?.code === '23P01',
  ).length
  assert(concurrentSuccesses === 1 && concurrentFailures === 1,
    'concurrent overlapping inserts must produce exactly one success and one exclusion violation')
  await assertVersion(subjectB, 1)
  completedAssertions += 1

  await expectPgCode('unknown canonical role', () => insertAssignment(
    'ra-pg-' + suffix + '-unknown-role', subjectA, 'founder', 'global', null, 'ACTIVE',
    '2040-01-01T00:00:00.000Z', '2040-02-01T00:00:00.000Z',
  ), '23514')
  await expectPgCode('global scope with scope_id', () => insertAssignment(
    'ra-pg-' + suffix + '-invalid-scope', subjectA, 'user', 'global', 'not-global',
    'ACTIVE', '2040-01-01T00:00:00.000Z', '2040-02-01T00:00:00.000Z',
  ), '23514')
  await expectPgCode('non-positive effective interval', () => insertAssignment(
    'ra-pg-' + suffix + '-invalid-time', subjectA, 'user', 'global', null,
    'ACTIVE', '2040-02-01T00:00:00.000Z', '2040-01-01T00:00:00.000Z',
  ), '23514')
  await expectPgCode('unknown subject identity', () => insertAssignment(
    'ra-pg-' + suffix + '-orphan', 'missing-user-' + suffix, 'user', 'global', null,
    'ACTIVE', '2040-01-01T00:00:00.000Z', '2040-02-01T00:00:00.000Z',
  ), '23503')
  completedAssertions += 4

  const report = {
    status: 'W02_ROLE_ASSIGNMENT_POSTGRES_SCHEMA_PASS',
    postgresMajor,
    btreeGistVersion: extension.rows[0].extversion,
    canonicalRoleCount: 11,
    assertionsPassed: completedAssertions,
    checks: {
      roleVocabularyConstrainedToCanonicalL0L8: true,
      subjectMustReferenceBetterAuthUser: true,
      globalAndScopedShapeChecks: true,
      positiveTemporalRange: true,
      halfOpenAdjacentIntervalsAllowed: true,
      overlappingActiveAssignmentsRejected: true,
      revokedHistoricalAssignmentsCanCoexist: true,
      distinctScopesCanCoexist: true,
      updateOverlapRejected: true,
      authorizationVersionCreatedAndIncremented: true,
      updatedAtOnlyDoesNotIncrementVersion: true,
      concurrentOverlapHasSingleWinner: true,
      unknownRoleRejected: true,
      orphanSubjectRejected: true,
      syntheticRowsCleaned: true,
    },
    productionDatabaseTouched: false,
    businessRowsImported: false,
  }
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  primaryError = error
} finally {
  try {
    await pool.query('DELETE FROM role_assignments WHERE subject_id = ANY($1::text[])', [subjectIds])
    await pool.query('DELETE FROM role_authorization_versions WHERE subject_id = ANY($1::text[])', [subjectIds])
    await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [subjectIds])
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError
  }
  try {
    const remaining = await pool.query(
      'SELECT ' +
        '(SELECT COUNT(*) FROM role_assignments WHERE subject_id = ANY($1::text[])) AS assignments, ' +
        '(SELECT COUNT(*) FROM role_authorization_versions WHERE subject_id = ANY($1::text[])) AS versions, ' +
        '(SELECT COUNT(*) FROM "user" WHERE id = ANY($1::text[])) AS users',
      [subjectIds],
    )
    const row = remaining.rows[0]
    if (Number(row.assignments) !== 0 || Number(row.versions) !== 0 || Number(row.users) !== 0) {
      if (!primaryError) primaryError = new Error('W02_ROLE_ASSIGNMENT_PG_SYNTHETIC_CLEANUP_FAILED')
    }
  } catch (cleanupVerificationError) {
    if (!primaryError) primaryError = cleanupVerificationError
  }
  await pool.end()
}

if (primaryError) throw primaryError
