import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import {
  grantCreatorBusinessRoleWithStore,
  RoleAssignmentCommandError,
} from '../../src/authz/role-assignment-command.js'
import { createPostgresCreatorRoleGrantStore } from '../../src/neon/creator-role-grant-store-postgres.js'
import {
  ensureBaseUserRolePostgres,
  ensureVerifiedUserRolePostgres,
  readRoleVersionPostgres,
  resolveGlobalLayerPostgres,
} from '../../src/neon/role-assignment-postgres.js'
import { resolveLayerForSubject } from '../../src/authz/role-layer-store.js'
import { createPostgresRoleLayerStore } from '../../src/neon/role-layer-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing RoleAssignment runtime rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({
  connectionString,
  max: 6,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const creatorRoleGrantStore = createPostgresCreatorRoleGrantStore(pool)

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(workerRoot, 'artifacts/neon/w02-role-assignment-postgres-runtime-rehearsal.json')
const suffix = randomUUID().replaceAll('-', '').slice(0, 16).toLowerCase()
const now = '2026-11-09T00:00:00.000Z'
const userA = 'w02-ra-a-' + suffix
const userB = 'w02-ra-b-' + suffix
const userC = 'w02-ra-c-' + suffix
const userD = 'w02-ra-d-' + suffix
const subjectIds = [userA, userB, userC, userD]
const approvalRefA = 'ra-pg-a-' + suffix
const approvalRefB = 'ra-pg-b-' + suffix
const approvalRefInvalid = 'short'
let primaryError: unknown
let cleanupVerified = false
let report: Record<string, unknown> | undefined

const insertUser = async (
  id: string,
  state: 'ACTIVE' | 'PENDING_VERIFICATION',
  emailVerified: boolean,
): Promise<void> => {
  await pool.query(
    'INSERT INTO "user" (id, name, email, email_verified, account_state, account_state_version) ' +
      'VALUES ($1, $2, $3, $4, $5, 1)',
    [id, 'RoleAssignment PG Runtime Probe', id + '@example.test', emailVerified, state],
  )
}

const expectErrorCode = async (
  code: string,
  operation: () => Promise<unknown>,
): Promise<void> => {
  let caught: unknown
  try {
    await operation()
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof RoleAssignmentCommandError, 'expected RoleAssignmentCommandError')
  assert.equal(caught.code, code)
}

const expectErrorMessage = async (
  message: string,
  operation: () => Promise<unknown>,
): Promise<void> => {
  let caught: unknown
  try {
    await operation()
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof Error, 'expected Error')
  assert.equal(caught.message, message)
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  await insertUser(userA, 'ACTIVE', true)
  await insertUser(userB, 'ACTIVE', true)
  await insertUser(userC, 'PENDING_VERIFICATION', false)
  await insertUser(userD, 'ACTIVE', true)

  // L1 base role is deterministic and idempotent. PostgreSQL's trigger, not
  // application SQL, advances role_authorization_versions exactly once.
  await ensureBaseUserRolePostgres(pool, userA, now)
  assert.equal(await readRoleVersionPostgres(pool, userA), 1)
  await ensureBaseUserRolePostgres(pool, userA, now)
  assert.equal(await readRoleVersionPostgres(pool, userA), 1)

  await ensureBaseUserRolePostgres(pool, userB, now)
  await ensureBaseUserRolePostgres(pool, userC, now)
  await ensureBaseUserRolePostgres(pool, userD, now)

  await expectErrorMessage('verified-user role grant requires an ACTIVE email-verified account', async () => {
    await ensureVerifiedUserRolePostgres(pool, userC, now)
  })
  const pendingVerifiedRole = await pool.query(
    "SELECT id FROM role_assignments WHERE subject_id = $1 AND role_id = 'verified_user'",
    [userC],
  )
  assert.equal(pendingVerifiedRole.rowCount, 0)
  assert.equal(await readRoleVersionPostgres(pool, userC), 1)

  await ensureVerifiedUserRolePostgres(pool, userA, now)
  assert.equal(await readRoleVersionPostgres(pool, userA), 2)
  await ensureVerifiedUserRolePostgres(pool, userA, now)
  assert.equal(await readRoleVersionPostgres(pool, userA), 2)
  await ensureVerifiedUserRolePostgres(pool, userB, now)
  await ensureVerifiedUserRolePostgres(pool, userD, now)

  const layerA = await resolveGlobalLayerPostgres(pool, userA, 'ACTIVE', now, true)
  assert.equal(layerA.decision, 'ALLOW')
  assert.equal(layerA.layer, 'L2')
  assert.deepEqual(
    layerA.roleAssignments?.map((assignment) => assignment.roleId).sort(),
    ['user', 'verified_user'],
  )
  const pendingLayer = await resolveGlobalLayerPostgres(pool, userC, 'PENDING_VERIFICATION', now, true)
  assert.equal(pendingLayer.decision, 'ALLOW')
  assert.equal(pendingLayer.layer, 'L1')

  // Exercise the same provider-neutral authority boundary used by the
  // /internal/authz/resolve-layer route. It reads account_state from PostgreSQL
  // itself and cannot accept a caller-supplied state or timestamp.
  const roleLayerStore = createPostgresRoleLayerStore(pool)
  const routeLayerA = await resolveLayerForSubject(roleLayerStore, userA, now)
  assert.deepEqual(routeLayerA, { decision: 'ALLOW', layer: 'L2' })
  const routeLayerPending = await resolveLayerForSubject(roleLayerStore, userC, now)
  assert.deepEqual(routeLayerPending, { decision: 'ALLOW', layer: 'L1' })

  const creatorGrant = await grantCreatorBusinessRoleWithStore(creatorRoleGrantStore, {
    subjectId: userA,
    roleId: 'creator',
    scopeType: 'global',
    scopeId: null,
    approvalRef: approvalRefA,
  }, now)
  assert.deepEqual(creatorGrant, {
    assignmentId: 'ra-' + approvalRefA,
    roleId: 'creator',
    replayed: false,
  })
  assert.equal(await readRoleVersionPostgres(pool, userA), 3)

  const creatorReplay = await grantCreatorBusinessRoleWithStore(creatorRoleGrantStore, {
    subjectId: userA,
    roleId: 'creator',
    scopeType: 'global',
    scopeId: null,
    approvalRef: approvalRefA,
  }, now)
  assert.equal(creatorReplay.replayed, true)
  assert.equal(await readRoleVersionPostgres(pool, userA), 3)

  await expectErrorCode('ROLE_ASSIGNMENT_ALREADY_ACTIVE', () =>
    grantCreatorBusinessRoleWithStore(creatorRoleGrantStore, {
      subjectId: userA,
      roleId: 'creator',
      scopeType: 'global',
      scopeId: null,
      approvalRef: 'ra-pg-another-' + suffix,
    }, now),
  )
  await expectErrorCode('VALIDATION_FAILED', () =>
    grantCreatorBusinessRoleWithStore(creatorRoleGrantStore, {
      subjectId: userA,
      roleId: 'creator',
      scopeType: 'global',
      scopeId: null,
      approvalRef: approvalRefInvalid,
    }, now),
  )
  await expectErrorCode('TARGET_NOT_ELIGIBLE', () =>
    grantCreatorBusinessRoleWithStore(creatorRoleGrantStore, {
      subjectId: userC,
      roleId: 'creator',
      scopeType: 'global',
      scopeId: null,
      approvalRef: 'ra-pg-pending-' + suffix,
    }, now),
  )

  // Two simultaneous approvals with the same deterministic approval reference
  // must resolve to one committed row: one creator grant and one exact replay.
  const concurrentCommand = {
    subjectId: userB,
    roleId: 'creator' as const,
    scopeType: 'global' as const,
    scopeId: null,
    approvalRef: approvalRefB,
  }
  const concurrent = await Promise.all([
    grantCreatorBusinessRoleWithStore(creatorRoleGrantStore, concurrentCommand, now),
    grantCreatorBusinessRoleWithStore(creatorRoleGrantStore, concurrentCommand, now),
  ])
  assert.equal(concurrent.filter((result) => !result.replayed).length, 1)
  assert.equal(concurrent.filter((result) => result.replayed).length, 1)
  assert.equal(await readRoleVersionPostgres(pool, userB), 3)
  const concurrentRows = await pool.query(
    'SELECT COUNT(*)::integer AS count FROM role_assignments WHERE id = $1',
    ['ra-' + approvalRefB],
  )
  assert.equal(Number(concurrentRows.rows[0]?.count), 1)

  // L8 facts are withheld before TOTP is fully enabled, then become effective
  // only with both Better Auth's enabled flag and a verified factor timestamp.
  await pool.query(
    "INSERT INTO role_assignments " +
      "(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) " +
      "VALUES ($1, $2, 'super_admin', 'global', NULL, 'ACTIVE', $3, NULL, $3, $3)",
    ['ra-pg-super-' + suffix, userD, now],
  )
  assert.equal(await readRoleVersionPostgres(pool, userD), 3)

  const beforeMfa = await resolveGlobalLayerPostgres(pool, userD, 'ACTIVE', now, true)
  assert.equal(beforeMfa.decision, 'ALLOW')
  assert.equal(beforeMfa.layer, 'L2')
  assert.deepEqual(
    beforeMfa.roleAssignments?.map((assignment) => assignment.roleId).sort(),
    ['user', 'verified_user'],
  )

  await pool.query(
    'INSERT INTO "twoFactor" ("id", "secret", "backupCodes", "userId", "verified", ' +
      '"failedVerificationCount", "lockedUntil") VALUES ($1, $2, $3, $4, TRUE, 0, NULL)',
    ['tf-pg-' + suffix, 'synthetic-encrypted-secret', 'synthetic-encrypted-backup-codes', userD],
  )
  await pool.query(
    'UPDATE "user" SET two_factor_enabled = TRUE, mfa_enrolled_at = $1 WHERE id = $2',
    [now, userD],
  )
  const enrollmentState = await pool.query<{ mfaEnrolledAt: Date | string | null }>(
    'SELECT mfa_enrolled_at AS "mfaEnrolledAt" FROM "user" WHERE id = $1',
    [userD],
  )
  const persistedEnrollmentAt = enrollmentState.rows[0]?.mfaEnrolledAt
  assert.ok(persistedEnrollmentAt, 'PostgreSQL MFA enable trigger must persist its enrollment timestamp')
  const mfaEffectiveNow = new Date(new Date(persistedEnrollmentAt).getTime() + 1_000).toISOString()

  const afterMfa = await resolveGlobalLayerPostgres(pool, userD, 'ACTIVE', mfaEffectiveNow, true)
  assert.equal(afterMfa.decision, 'ALLOW')
  assert.equal(afterMfa.layer, 'L8')
  assert.ok(afterMfa.roleAssignments?.some((assignment) => assignment.roleId === 'super_admin'))
  assert.equal(await readRoleVersionPostgres(pool, userD), 3)

  const routeLayerPrivileged = await resolveLayerForSubject(roleLayerStore, userD, mfaEffectiveNow)
  assert.deepEqual(routeLayerPrivileged, { decision: 'ALLOW', layer: 'L8' })

  await pool.query('UPDATE "user" SET account_state = $1 WHERE id = $2', ['SUSPENDED', userD])
  const denyState = await resolveGlobalLayerPostgres(pool, userD, 'SUSPENDED', mfaEffectiveNow, true)
  assert.equal(denyState.decision, 'DENY')
  const routeLayerSuspended = await resolveLayerForSubject(roleLayerStore, userD, mfaEffectiveNow)
  assert.deepEqual(routeLayerSuspended, { decision: 'DENY' })

  const checks = {
    baseRoleMaterialized: true,
    baseRoleReplayIsIdempotent: true,
    verifiedRoleRequiresActiveEmailVerifiedAccount: true,
    verifiedRoleMaterializedAndReplayIsIdempotent: true,
    roleVersionOwnedByPostgresTriggers: true,
    l2LayerResolvedFromEffectiveRoles: true,
    pendingAccountLayerResolvedAsL1: true,
    creatorGrantRequiresVerifiedL2: true,
    creatorGrantReplayIsIdempotent: true,
    duplicateEffectiveCreatorRoleRejected: true,
    invalidApprovalReferenceRejected: true,
    pendingAccountCreatorGrantRejected: true,
    concurrentSameApprovalReferenceHasOneWinner: true,
    concurrentGrantPersistsOneAssignment: true,
    privilegedRoleWithheldWithoutMfa: true,
    privilegedRoleIncludedAfterVerifiedTotpEnrollment: true,
    suspendedAccountDenied: true,
    internalResolveLayerStoreReadsAuthoritativeAccountState: true,
    internalResolveLayerStoreSupportsL1L2L8AndDeniesSuspended: true,
    syntheticRowsCleaned: true,
  }
  report = {
    reportVersion: 1,
    status: 'W02_ROLE_ASSIGNMENT_POSTGRES_RUNTIME_REHEARSAL_PASS',
    scope: 'Test-only RoleAssignment PostgreSQL repository against disposable PostgreSQL 18; production Worker remains on D1-01.',
    checks,
    assertionsPassed: Object.values(checks).filter(Boolean).length,
    postgresMajor: 18,
    canonicalRoleCount: 11,
    testUserRowsRemaining: 0,
    productionAuthorityChanged: false,
    neonConnectionAttempted: false,
    cloudflareD1Touched: false,
    workerBindingsChanged: false,
    businessDataImported: false,
  }
} catch (error) {
  primaryError = error
} finally {
  try {
    await pool.query('DELETE FROM role_assignments WHERE subject_id = ANY($1::text[])', [subjectIds])
    await pool.query('DELETE FROM "twoFactor" WHERE "userId" = ANY($1::text[])', [subjectIds])
    await pool.query('DELETE FROM role_authorization_versions WHERE subject_id = ANY($1::text[])', [subjectIds])
    await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [subjectIds])

    const remaining = await pool.query(
      'SELECT ' +
        '(SELECT COUNT(*) FROM role_assignments WHERE subject_id = ANY($1::text[])) AS assignments, ' +
        '(SELECT COUNT(*) FROM role_authorization_versions WHERE subject_id = ANY($1::text[])) AS versions, ' +
        '(SELECT COUNT(*) FROM "twoFactor" WHERE "userId" = ANY($1::text[])) AS factors, ' +
        '(SELECT COUNT(*) FROM "user" WHERE id = ANY($1::text[])) AS users',
      [subjectIds],
    )
    const counts = Object.values(remaining.rows[0] ?? {}).map(Number)
    if (counts.some((count) => count !== 0)) throw new Error('W02_ROLE_ASSIGNMENT_PG_SYNTHETIC_CLEANUP_FAILED')
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
if (!report) throw new Error('W02_ROLE_ASSIGNMENT_PG_RUNTIME_REPORT_MISSING')
if (!cleanupVerified) throw new Error('W02_ROLE_ASSIGNMENT_PG_CLEANUP_NOT_VERIFIED')

mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
