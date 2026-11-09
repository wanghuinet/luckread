import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import { ensureBaseUserRolePostgres } from '../../src/neon/role-assignment-postgres.js'
import {
  AccountLifecyclePostgresError,
  advanceAccountDeletionToPendingPostgres,
  cancelAccountDeletionPostgres,
  completeAccountDeletionPostgres,
  completeAccountReactivationPostgres,
  reactivateDeletedAccountPostgres,
  requestAccountDeletionPostgres,
} from '../../src/neon/auth015-account-lifecycle-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing AUTH-015 runtime rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({
  connectionString,
  max: 8,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(workerRoot, 'artifacts/neon/w02-auth015-account-lifecycle-postgres-runtime-rehearsal.json')
const suffix = randomUUID().replaceAll('-', '').slice(0, 16).toLowerCase()
const createdAt = new Date('2026-01-01T00:00:00.000Z')
const baseRoleTime = '2026-01-01T00:00:00.000Z'
const userCancel = 'auth015-cancel-' + suffix
const userBoundary = 'auth015-boundary-' + suffix
const userReactivate = 'auth015-reactivate-' + suffix
const userReactivateBoundary = 'auth015-reactivate-boundary-' + suffix
const userMissingTimestamp = 'auth015-missing-time-' + suffix
const userFutureTimestamp = 'auth015-future-time-' + suffix
const userNoPermission = 'auth015-no-permission-' + suffix
const userConcurrent = 'auth015-concurrent-' + suffix
const userJournalRollback = 'auth015-journal-rollback-' + suffix
const subjectIds = [
  userCancel,
  userBoundary,
  userReactivate,
  userReactivateBoundary,
  userMissingTimestamp,
  userFutureTimestamp,
  userNoPermission,
  userConcurrent,
  userJournalRollback,
]
const jobActor = 'auth015-lifecycle-job-' + suffix
let primaryError: unknown
let cleanupVerified = false
let report: Record<string, unknown> | undefined

const insertUser = async (
  id: string,
  state: string,
  requestedAt: Date | null = null,
  deletedAt: Date | null = null,
): Promise<void> => {
  await pool.query(
    'INSERT INTO "user" (id, name, email, email_verified, account_state, account_state_version, ' +
      'created_at, updated_at, deletion_requested_at, deleted_at) ' +
      'VALUES ($1, $2, $3, TRUE, $4, 1, $5, $5, $6, $7)',
    [
      id,
      'AUTH-015 PostgreSQL Runtime Probe',
      id + '@example.test',
      state,
      createdAt,
      requestedAt,
      deletedAt,
    ],
  )
}

const clock = (instant: string) => () => new Date(instant)

const expectCode = async (
  code: string,
  operation: () => Promise<unknown>,
): Promise<void> => {
  let caught: unknown
  try {
    await operation()
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof AccountLifecyclePostgresError, 'expected AccountLifecyclePostgresError')
  assert.equal(caught.code, code)
}

const readAccount = async (id: string) => {
  const result = await pool.query<{
    accountState: string
    accountStateVersion: number
    deletionRequestedAt: Date | null
    deletedAt: Date | null
  }>(
    'SELECT account_state AS "accountState", account_state_version AS "accountStateVersion", ' +
      'deletion_requested_at AS "deletionRequestedAt", deleted_at AS "deletedAt" FROM "user" WHERE id = $1',
    [id],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

const countJournal = async (id: string) => {
  const result = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::integer AS count FROM auth_013_publication_journal ' +
      "WHERE resource_id = $1 AND event_type = 'identity.account_state_changed'",
    [id],
  )
  return Number(result.rows[0]?.count ?? 0)
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  const requestAt = new Date('2026-10-01T00:00:00.000Z')
  const coolingBoundary = new Date(requestAt.getTime() + 15 * 24 * 60 * 60 * 1000)
  const deletedAt = new Date('2026-10-01T00:00:00.000Z')
  const requestedAtForDeleted = new Date(deletedAt.getTime() - 15 * 24 * 60 * 60 * 1000)

  await insertUser(userCancel, 'ACTIVE')
  await insertUser(userBoundary, 'ACTIVE')
  await insertUser(userReactivate, 'DELETED', requestedAtForDeleted, deletedAt)
  await insertUser(userReactivateBoundary, 'DELETED', requestedAtForDeleted, deletedAt)
  await insertUser(userMissingTimestamp, 'DELETION_REQUESTED')
  await insertUser(userFutureTimestamp, 'DELETION_REQUESTED', new Date('2026-12-01T00:00:00.000Z'))
  await insertUser(userNoPermission, 'DELETED', requestedAtForDeleted, deletedAt)
  await insertUser(userConcurrent, 'ACTIVE')
  await insertUser(userJournalRollback, 'ACTIVE')

  for (const id of [
    userCancel,
    userBoundary,
    userReactivate,
    userReactivateBoundary,
    userMissingTimestamp,
    userFutureTimestamp,
    userConcurrent,
    userJournalRollback,
  ]) {
    await ensureBaseUserRolePostgres(pool, id, baseRoleTime)
  }

  // ACTIVE -> DELETION_REQUESTED sets both the canonical server timestamp and
  // the account-state version in the same transaction as the publication row.
  const requestResult = await requestAccountDeletionPostgres(
    pool,
    { userId: userCancel, subjectUserId: userCancel, expectedVersion: 1 },
    clock(requestAt.toISOString()),
  )
  assert.equal(requestResult.to, 'DELETION_REQUESTED')
  assert.equal(requestResult.accountStateVersion, 2)
  const requested = await readAccount(userCancel)
  assert.equal(requested.accountState, 'DELETION_REQUESTED')
  assert.equal(requested.deletionRequestedAt?.toISOString(), requestAt.toISOString())
  assert.equal(requested.deletedAt, null)
  assert.equal(await countJournal(userCancel), 1)

  // Cancellation is allowed one millisecond before the 15-day deadline.
  const cancelResult = await cancelAccountDeletionPostgres(
    pool,
    { userId: userCancel, subjectUserId: userCancel, expectedVersion: 2 },
    clock(new Date(coolingBoundary.getTime() - 1).toISOString()),
  )
  assert.equal(cancelResult.to, 'ACTIVE')
  const cancelled = await readAccount(userCancel)
  assert.equal(cancelled.accountState, 'ACTIVE')
  assert.equal(cancelled.deletionRequestedAt, null)
  assert.equal(cancelled.deletedAt, null)
  assert.equal(cancelled.accountStateVersion, 3)

  // The exact 15-day boundary denies cancellation and admits system progress.
  await requestAccountDeletionPostgres(
    pool,
    { userId: userBoundary, subjectUserId: userBoundary, expectedVersion: 1 },
    clock(requestAt.toISOString()),
  )
  const boundarySession = 'auth015-session-' + suffix
  await pool.query(
    'INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id) ' +
      'VALUES ($1, $2, $3, $4, $4, $5)',
    [boundarySession, new Date('2027-01-01T00:00:00.000Z'), 'auth015-token-' + suffix, createdAt, userBoundary],
  )
  await expectCode('PRECONDITION_FAILED', () =>
    cancelAccountDeletionPostgres(
      pool,
      { userId: userBoundary, subjectUserId: userBoundary, expectedVersion: 2 },
      clock(coolingBoundary.toISOString()),
    ),
  )
  const stillRequested = await readAccount(userBoundary)
  assert.equal(stillRequested.accountState, 'DELETION_REQUESTED')
  assert.equal(stillRequested.accountStateVersion, 2)
  assert.equal(stillRequested.deletionRequestedAt?.toISOString(), requestAt.toISOString())

  const pendingResult = await advanceAccountDeletionToPendingPostgres(
    pool,
    { userId: userBoundary, actorId: jobActor, expectedVersion: 2 },
    clock(coolingBoundary.toISOString()),
  )
  assert.equal(pendingResult.to, 'DELETION_PENDING')
  const pendingSessionCount = await pool.query(
    'SELECT COUNT(*)::integer AS count FROM "session" WHERE user_id = $1',
    [userBoundary],
  )
  assert.equal(Number(pendingSessionCount.rows[0]?.count), 0)

  const completedResult = await completeAccountDeletionPostgres(
    pool,
    { userId: userBoundary, actorId: jobActor, expectedVersion: 3 },
    clock(coolingBoundary.toISOString()),
  )
  assert.equal(completedResult.to, 'DELETED')
  const deleted = await readAccount(userBoundary)
  assert.equal(deleted.accountState, 'DELETED')
  assert.equal(deleted.deletionRequestedAt?.toISOString(), requestAt.toISOString())
  assert.equal(deleted.deletedAt?.toISOString(), coolingBoundary.toISOString())
  assert.equal(deleted.accountStateVersion, 4)
  assert.equal(await countJournal(userBoundary), 3)

  // Self-reactivation must have both the server-owned window and an effective
  // global role that explicitly grants user.reactivate; a role name/layer alone
  // is not treated as permission.
  const reactivationAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000 - 1)
  const reactivateResult = await reactivateDeletedAccountPostgres(
    pool,
    { userId: userReactivate, subjectUserId: userReactivate, expectedVersion: 1 },
    clock(reactivationAt.toISOString()),
  )
  assert.equal(reactivateResult.to, 'REACTIVATED')
  const reactivated = await readAccount(userReactivate)
  assert.equal(reactivated.accountState, 'REACTIVATED')
  assert.equal(reactivated.deletionRequestedAt?.toISOString(), requestedAtForDeleted.toISOString())
  assert.equal(reactivated.deletedAt?.toISOString(), deletedAt.toISOString())
  await completeAccountReactivationPostgres(
    pool,
    { userId: userReactivate, actorId: jobActor, expectedVersion: 2 },
    clock(new Date(reactivationAt.getTime() + 1).toISOString()),
  )
  const reactivationCompleted = await readAccount(userReactivate)
  assert.equal(reactivationCompleted.accountState, 'ACTIVE')
  assert.equal(reactivationCompleted.deletionRequestedAt, null)
  assert.equal(reactivationCompleted.deletedAt, null)

  // The 30-day boundary is exclusive: exact boundary denies self-reactivation.
  await expectCode('PRECONDITION_FAILED', () =>
    reactivateDeletedAccountPostgres(
      pool,
      { userId: userReactivateBoundary, subjectUserId: userReactivateBoundary, expectedVersion: 1 },
      clock(new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()),
    ),
  )
  assert.equal((await readAccount(userReactivateBoundary)).accountState, 'DELETED')

  // Missing and future lifecycle timestamps fail closed; the state is untouched.
  await expectCode('PRECONDITION_FAILED', () =>
    cancelAccountDeletionPostgres(
      pool,
      { userId: userMissingTimestamp, subjectUserId: userMissingTimestamp, expectedVersion: 1 },
      clock(coolingBoundary.toISOString()),
    ),
  )
  await expectCode('PRECONDITION_FAILED', () =>
    cancelAccountDeletionPostgres(
      pool,
      { userId: userFutureTimestamp, subjectUserId: userFutureTimestamp, expectedVersion: 1 },
      clock(requestAt.toISOString()),
    ),
  )
  assert.equal((await readAccount(userMissingTimestamp)).accountStateVersion, 1)
  assert.equal((await readAccount(userFutureTimestamp)).accountStateVersion, 1)

  // A DELETED account without an active role grant is not allowed to use the
  // permissionful user.reactivate transition.
  await expectCode('FORBIDDEN', () =>
    reactivateDeletedAccountPostgres(
      pool,
      { userId: userNoPermission, subjectUserId: userNoPermission, expectedVersion: 1 },
      clock(reactivationAt.toISOString()),
    ),
  )
  assert.equal((await readAccount(userNoPermission)).accountState, 'DELETED')

  // Concurrent requests with the same If-Match version produce one winner,
  // one conflict, and exactly one state-change publication.
  const concurrentResults = await Promise.allSettled([
    requestAccountDeletionPostgres(
      pool,
      { userId: userConcurrent, subjectUserId: userConcurrent, expectedVersion: 1 },
      clock(requestAt.toISOString()),
    ),
    requestAccountDeletionPostgres(
      pool,
      { userId: userConcurrent, subjectUserId: userConcurrent, expectedVersion: 1 },
      clock(requestAt.toISOString()),
    ),
  ])
  assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1)
  const concurrentFailures = concurrentResults.filter((result) => result.status === 'rejected')
  assert.equal(concurrentFailures.length, 1)
  assert.ok(concurrentFailures[0]?.status === 'rejected')
  assert.ok(concurrentFailures[0].reason instanceof AccountLifecyclePostgresError)
  assert.equal(concurrentFailures[0].reason.code, 'CONFLICT')
  assert.equal((await readAccount(userConcurrent)).accountStateVersion, 2)
  assert.equal(await countJournal(userConcurrent), 1)

  // Force the AUTH-013 unique resource/version constraint to fail after the
  // account UPDATE. PostgreSQL must roll back both the timestamp and version.
  await pool.query(
    'INSERT INTO auth_013_publication_journal ' +
      '(journal_id, event_id, event_type, schema_version, resource_id, source_version, payload, status, attempt, created_at) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [
      'auth015-seed-journal-' + suffix,
      randomUUID(),
      'identity.account_state_changed',
      '1.0',
      userJournalRollback,
      2,
      '{}',
      'PENDING',
      1,
      createdAt,
    ],
  )
  await expectCode('CONFLICT', () =>
    requestAccountDeletionPostgres(
      pool,
      { userId: userJournalRollback, subjectUserId: userJournalRollback, expectedVersion: 1 },
      clock(requestAt.toISOString()),
    ),
  )
  const rolledBack = await readAccount(userJournalRollback)
  assert.equal(rolledBack.accountState, 'ACTIVE')
  assert.equal(rolledBack.accountStateVersion, 1)
  assert.equal(rolledBack.deletionRequestedAt, null)
  assert.equal(rolledBack.deletedAt, null)

  const checks = {
    activeToDeletionRequestedSetsServerTimestampAndJournalAtomically: true,
    cancellationAllowedBefore15DayBoundaryAndClearsBothTimestamps: true,
    cancellationDeniedAtExact15DayBoundary: true,
    coolingOffExpiryAdvancesToDeletionPending: true,
    deletionPendingInvalidatesSessions: true,
    deletionCompletionSetsDeletedAtAndPreservesRequestTimestamp: true,
    selfReactivationRequiresEffectiveUserReactivatePermission: true,
    selfReactivationAllowedBefore30DayBoundary: true,
    reactivatedToActiveClearsBothLifecycleTimestamps: true,
    selfReactivationDeniedAtExact30DayBoundary: true,
    missingLifecycleTimestampFailsClosed: true,
    futureLifecycleTimestampFailsClosed: true,
    concurrentSameVersionRequestHasOneWinner: true,
    duplicateJournalSourceVersionRollsBackStateAndTimestamp: true,
    syntheticRowsCleaned: true,
  }
  report = {
    reportVersion: 1,
    status: 'W02_AUTH015_ACCOUNT_LIFECYCLE_POSTGRES_RUNTIME_REHEARSAL_PASS',
    scope: 'Test-only W02 AUTH-015 lifecycle adapter against disposable PostgreSQL 18; production Worker remains on D1-01.',
    checks,
    assertionsPassed: Object.values(checks).filter(Boolean).length,
    postgresMajor: 18,
    syntheticUserRowsRemaining: 0,
    productionAuthorityChanged: false,
    neonConnectionAttempted: false,
    cloudflareD1Touched: false,
    workerBindingsChanged: false,
    businessDataImported: false,
    accountDataPurged: false,
  }
} catch (error) {
  primaryError = error
} finally {
  try {
    await pool.query('DELETE FROM "session" WHERE user_id = ANY($1::text[])', [subjectIds])
    await pool.query('DELETE FROM auth_013_publication_journal WHERE resource_id = ANY($1::text[])', [subjectIds])
    await pool.query('DELETE FROM role_assignments WHERE subject_id = ANY($1::text[])', [subjectIds])
    await pool.query('DELETE FROM role_authorization_versions WHERE subject_id = ANY($1::text[])', [subjectIds])
    await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [subjectIds])

    const remaining = await pool.query(
      'SELECT ' +
        '(SELECT COUNT(*) FROM "user" WHERE id = ANY($1::text[])) AS users, ' +
        '(SELECT COUNT(*) FROM "session" WHERE user_id = ANY($1::text[])) AS sessions, ' +
        '(SELECT COUNT(*) FROM role_assignments WHERE subject_id = ANY($1::text[])) AS assignments, ' +
        '(SELECT COUNT(*) FROM role_authorization_versions WHERE subject_id = ANY($1::text[])) AS versions, ' +
        '(SELECT COUNT(*) FROM auth_013_publication_journal WHERE resource_id = ANY($1::text[])) AS journal_rows',
      [subjectIds],
    )
    const counts = Object.values(remaining.rows[0] ?? {}).map(Number)
    if (counts.some((count) => count !== 0)) throw new Error('W02_AUTH015_PG_SYNTHETIC_CLEANUP_FAILED')
    cleanupVerified = true
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError
  }

  try {
    await pool.end()
  } catch (poolError) {
    if (!primaryError) primaryError = poolError
  }
}

if (primaryError) throw primaryError
if (!report) throw new Error('W02_AUTH015_PG_RUNTIME_REPORT_MISSING')
if (!cleanupVerified) throw new Error('W02_AUTH015_PG_CLEANUP_NOT_VERIFIED')

mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
