import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import { buildSessionRevokedEvent } from '../../src/auth/session-revocation-events.js'
import { revokeUserSessionPostgres } from '../../src/neon/session-revocation-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing AUTH-010 runtime rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({
  connectionString,
  max: 6,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(workerRoot, 'artifacts/neon/w02-auth010-session-revocation-postgres-runtime-rehearsal.json')
const suffix = randomUUID().replaceAll('-', '').slice(0, 20).toLowerCase()
const now = new Date().toISOString()
const validFrom = new Date(Date.parse(now) - 60_000).toISOString()
const expiresAt = new Date(Date.parse(now) + 60 * 60_000).toISOString()

const userIds = {
  primary: 'user-auth010-primary-' + suffix,
  other: 'user-auth010-other-' + suffix,
  noRole: 'user-auth010-no-role-' + suffix,
  concurrent: 'user-auth010-concurrent-' + suffix,
  rollback: 'user-auth010-rollback-' + suffix,
}
const sessionIds = {
  current: 'session-auth010-current-' + suffix,
  primary: 'session-auth010-target-' + suffix,
  other: 'session-auth010-other-' + suffix,
  noRole: 'session-auth010-no-role-' + suffix,
  concurrent: 'session-auth010-concurrent-' + suffix,
  rollback: 'session-auth010-rollback-' + suffix,
}
const triggerName = 'auth010_rollback_test_' + suffix
const functionName = 'auth010_rollback_test_fn_' + suffix
let triggerCreated = false
let functionCreated = false
let primaryError: unknown
let cleanupError: unknown
let cleanupVerified = false

const insertUser = async (userId: string): Promise<void> => {
  await pool.query(
    'INSERT INTO "user" (id, name, email, email_verified, account_state, account_state_version) ' +
      "VALUES ($1, 'AUTH-010 PostgreSQL runtime probe', $2, TRUE, 'ACTIVE', 1)",
    [userId, userId + '@example.test'],
  )
}

const insertBaseRole = async (userId: string): Promise<void> => {
  await pool.query(
    'INSERT INTO role_assignments ' +
      '(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) ' +
      "VALUES ($1, $2, 'user', 'global', NULL, 'ACTIVE', $3, NULL, $4, $4)",
    ['auth010-role-' + userId, userId, validFrom, now],
  )
}

const insertSession = async (sessionId: string, userId: string): Promise<void> => {
  await pool.query(
    'INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id) ' +
      'VALUES ($1, $2, $3, $4, $4, $5)',
    [sessionId, expiresAt, 'synthetic-session-token-' + sessionId, now, userId],
  )
}

const makeEvent = async (sessionId: string, userId: string) =>
  buildSessionRevokedEvent({
    sessionId,
    userId,
    occurredAt: now,
    correlationId: 'req_auth010_' + suffix,
    causationId: 'trace-auth010:' + suffix,
  })

const sessionExists = async (sessionId: string, userId: string): Promise<boolean> => {
  const result = await pool.query(
    'SELECT id FROM "session" WHERE id = $1 AND user_id = $2',
    [sessionId, userId],
  )
  return result.rowCount === 1
}

const journalCount = async (sessionId: string): Promise<number> => {
  const result = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::integer AS count FROM auth_010_session_revocation_journal WHERE resource_id = $1',
    [sessionId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

const checks: Record<string, boolean> = {
  authorizedSessionRevocationAndOutboxCommitAtomically: false,
  currentSessionUnaffected: false,
  eventContainsNoSessionCredentialOrNetworkData: false,
  unauthorizedAccountCannotRevoke: false,
  crossAccountAndMissingTargetAreIndistinguishable: false,
  concurrentDuplicateRevocationProducesOneEvent: false,
  outboxFailureRollsBackSessionDeletion: false,
  syntheticRowsCleaned: false,
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  for (const userId of Object.values(userIds)) await insertUser(userId)
  for (const userId of [userIds.primary, userIds.other, userIds.concurrent, userIds.rollback]) {
    await insertBaseRole(userId)
  }

  await insertSession(sessionIds.current, userIds.primary)
  await insertSession(sessionIds.primary, userIds.primary)
  await insertSession(sessionIds.other, userIds.other)
  await insertSession(sessionIds.noRole, userIds.noRole)
  await insertSession(sessionIds.concurrent, userIds.concurrent)
  await insertSession(sessionIds.rollback, userIds.rollback)

  const primaryEvent = await makeEvent(sessionIds.primary, userIds.primary)
  const primaryResult = await revokeUserSessionPostgres(pool, {
    userId: userIds.primary,
    sessionId: sessionIds.primary,
    now,
    event: primaryEvent,
  })
  assert.deepEqual(primaryResult, { status: 'REVOKED' })
  assert.equal(await sessionExists(sessionIds.primary, userIds.primary), false)
  assert.equal(await sessionExists(sessionIds.current, userIds.primary), true)
  assert.equal(await journalCount(sessionIds.primary), 1)

  const persisted = await pool.query<{ payload: string; status: string; attempt: number }>(
    'SELECT payload, status, attempt FROM auth_010_session_revocation_journal WHERE resource_id = $1',
    [sessionIds.primary],
  )
  assert.equal(persisted.rows.length, 1)
  assert.equal(persisted.rows[0]?.status, 'PENDING')
  assert.equal(Number(persisted.rows[0]?.attempt), 1)
  assert.deepEqual(JSON.parse(persisted.rows[0]!.payload), primaryEvent)
  assert.doesNotMatch(
    persisted.rows[0]!.payload,
    /synthetic-session-token|sessionToken|cookie|deviceFingerprint|ipAddress|userAgent|refreshCredentialHash/i,
  )
  checks.authorizedSessionRevocationAndOutboxCommitAtomically = true
  checks.currentSessionUnaffected = true
  checks.eventContainsNoSessionCredentialOrNetworkData = true

  const noRoleEvent = await makeEvent(sessionIds.noRole, userIds.noRole)
  const noRoleResult = await revokeUserSessionPostgres(pool, {
    userId: userIds.noRole,
    sessionId: sessionIds.noRole,
    now,
    event: noRoleEvent,
  })
  assert.deepEqual(noRoleResult, { status: 'PERMISSION_DENIED' })
  assert.equal(await sessionExists(sessionIds.noRole, userIds.noRole), true)
  assert.equal(await journalCount(sessionIds.noRole), 0)
  checks.unauthorizedAccountCannotRevoke = true

  const crossAccountEvent = await makeEvent(sessionIds.other, userIds.primary)
  const crossAccountResult = await revokeUserSessionPostgres(pool, {
    userId: userIds.primary,
    sessionId: sessionIds.other,
    now,
    event: crossAccountEvent,
  })
  assert.deepEqual(crossAccountResult, { status: 'NOT_FOUND_OR_NOT_OWNED' })
  assert.equal(await sessionExists(sessionIds.other, userIds.other), true)
  assert.equal(await journalCount(sessionIds.other), 0)
  checks.crossAccountAndMissingTargetAreIndistinguishable = true

  const concurrentEvent = await makeEvent(sessionIds.concurrent, userIds.concurrent)
  const concurrentResults = await Promise.all([
    revokeUserSessionPostgres(pool, {
      userId: userIds.concurrent,
      sessionId: sessionIds.concurrent,
      now,
      event: concurrentEvent,
    }),
    revokeUserSessionPostgres(pool, {
      userId: userIds.concurrent,
      sessionId: sessionIds.concurrent,
      now,
      event: concurrentEvent,
    }),
  ])
  assert.equal(concurrentResults.filter((item) => item.status === 'REVOKED').length, 1)
  assert.equal(concurrentResults.filter((item) => item.status === 'NOT_FOUND_OR_NOT_OWNED').length, 1)
  assert.equal(await journalCount(sessionIds.concurrent), 1)
  checks.concurrentDuplicateRevocationProducesOneEvent = true

  await pool.query(
    'CREATE FUNCTION public.' + functionName + '() RETURNS trigger LANGUAGE plpgsql AS $body$ ' +
      "BEGIN IF NEW.resource_id = '" + sessionIds.rollback + "' THEN " +
      "RAISE EXCEPTION 'synthetic AUTH-010 outbox failure' USING ERRCODE = 'P0001'; " +
      'END IF; RETURN NEW; END; $body$',
  )
  functionCreated = true
  await pool.query(
    'CREATE TRIGGER ' + triggerName +
      ' BEFORE INSERT ON auth_010_session_revocation_journal FOR EACH ROW ' +
      'EXECUTE FUNCTION public.' + functionName + '()',
  )
  triggerCreated = true

  const rollbackEvent = await makeEvent(sessionIds.rollback, userIds.rollback)
  await assert.rejects(
    revokeUserSessionPostgres(pool, {
      userId: userIds.rollback,
      sessionId: sessionIds.rollback,
      now,
      event: rollbackEvent,
    }),
    /synthetic AUTH-010 outbox failure/,
  )
  assert.equal(await sessionExists(sessionIds.rollback, userIds.rollback), true)
  assert.equal(await journalCount(sessionIds.rollback), 0)
  checks.outboxFailureRollsBackSessionDeletion = true
} catch (error) {
  primaryError = error
} finally {
  try {
    if (triggerCreated) {
      await pool.query('DROP TRIGGER IF EXISTS ' + triggerName + ' ON auth_010_session_revocation_journal')
      triggerCreated = false
    }
    if (functionCreated) {
      await pool.query('DROP FUNCTION IF EXISTS public.' + functionName + '()')
      functionCreated = false
    }

    const fixtureUsers = Object.values(userIds)
    await pool.query(
      'DELETE FROM auth_010_session_revocation_journal WHERE resource_id = ANY($1::text[])',
      [Object.values(sessionIds)],
    )
    await pool.query('DELETE FROM "session" WHERE user_id = ANY($1::text[])', [fixtureUsers])
    await pool.query('DELETE FROM role_assignments WHERE subject_id = ANY($1::text[])', [fixtureUsers])
    await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [fixtureUsers])

    const residual = await pool.query<{ users: number; sessions: number; assignments: number; journal: number }>(
      'SELECT ' +
        '(SELECT COUNT(*)::integer FROM "user" WHERE id = ANY($1::text[])) AS users, ' +
        '(SELECT COUNT(*)::integer FROM "session" WHERE user_id = ANY($1::text[])) AS sessions, ' +
        '(SELECT COUNT(*)::integer FROM role_assignments WHERE subject_id = ANY($1::text[])) AS assignments, ' +
        '(SELECT COUNT(*)::integer FROM auth_010_session_revocation_journal WHERE resource_id = ANY($2::text[])) AS journal',
      [fixtureUsers, Object.values(sessionIds)],
    )
    const row = residual.rows[0]
    cleanupVerified =
      !triggerCreated &&
      !functionCreated &&
      Number(row?.users) === 0 &&
      Number(row?.sessions) === 0 &&
      Number(row?.assignments) === 0 &&
      Number(row?.journal) === 0
    checks.syntheticRowsCleaned = cleanupVerified
    assert.equal(cleanupVerified, true, 'all synthetic users, sessions, role assignments and journal rows must be removed')
  } catch (error) {
    cleanupError = error
  }

  await pool.end()
}

const failure = primaryError ?? cleanupError
const report = {
  reportVersion: 1,
  status: failure ? 'W02_AUTH010_SESSION_REVOCATION_POSTGRES_RUNTIME_REHEARSAL_FAILED' :
    'W02_AUTH010_SESSION_REVOCATION_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only AUTH-010 PostgreSQL repository against disposable PostgreSQL 18; production W02 remains on D1-01.',
  postgresMajor: 18,
  database: 'luckread_schema',
  checks,
  assertionsPassed: Object.values(checks).filter(Boolean).length,
  cleanupVerified,
  productionWorkerChanged: false,
  productionD1Touched: false,
  neonRemoteTouched: false,
  businessDataImported: false,
  productionCutoverAuthorized: false,
  error: failure instanceof Error ? failure.message.slice(0, 240) : null,
}
mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')

if (failure) {
  console.error('W02_AUTH010_SESSION_REVOCATION_POSTGRES_RUNTIME_REHEARSAL_FAILED ' + report.error)
  process.exitCode = 1
} else {
  console.log('W02_AUTH010_SESSION_REVOCATION_POSTGRES_RUNTIME_REHEARSAL_PASS ' + JSON.stringify(report))
}
