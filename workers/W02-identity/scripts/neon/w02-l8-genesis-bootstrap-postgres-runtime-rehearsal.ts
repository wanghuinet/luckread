import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import type { VerifiedL8BootstrapApproval } from '../../src/authz/l8-genesis-bootstrap-approval.js'
import {
  L8BootstrapCommandError,
} from '../../src/authz/l8-genesis-bootstrap-command.js'
import {
  L8BootstrapReadinessError,
} from '../../src/authz/l8-genesis-bootstrap-readiness.js'
import {
  bootstrapSuperAdminPostgres,
  checkL8BootstrapReadinessPostgres,
} from '../../src/neon/l8-genesis-bootstrap-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const sourceUrl = new URL(connectionString)
if (
  !new Set(['127.0.0.1', 'localhost', 'postgres']).has(sourceUrl.hostname) ||
  sourceUrl.port !== '5432' ||
  sourceUrl.pathname !== '/luckread_schema'
) {
  throw new Error('Refusing L8 bootstrap rehearsal outside disposable local luckread_schema PostgreSQL')
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 16).toLowerCase()
const rehearsalDatabase = 'luckread_l8_' + suffix
const adminUrl = new URL(connectionString)
adminUrl.pathname = '/postgres'
const targetUrl = new URL(connectionString)
targetUrl.pathname = '/' + rehearsalDatabase
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 5_000 })
let pool: Pool | undefined
let databaseCreated = false
let primaryError: unknown

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const artifactDirectory = path.join(workerRoot, 'artifacts/neon')
const reportPath = path.join(artifactDirectory, 'w02-l8-genesis-bootstrap-postgres-runtime-rehearsal.json')

const expectCommandError = async (
  code: string,
  operation: () => Promise<unknown>,
): Promise<void> => {
  let caught: unknown
  try {
    await operation()
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof L8BootstrapCommandError, 'expected L8BootstrapCommandError')
  assert.equal(caught.code, code)
}

const expectReadinessError = async (
  code: string,
  operation: () => Promise<unknown>,
): Promise<void> => {
  let caught: unknown
  try {
    await operation()
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof L8BootstrapReadinessError, 'expected L8BootstrapReadinessError')
  assert.equal(caught.code, code)
}

const buildApproval = (
  targetUserId: string,
  now: string,
  salt: string,
): VerifiedL8BootstrapApproval => {
  const nowMs = Date.parse(now)
  const nonce = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
  return {
    request: {
      version: 1,
      operation: 'INITIAL_L8_BOOTSTRAP',
      targetUserId,
      roleId: 'super_admin',
      scopeType: 'global',
      scopeId: null,
      reason: 'Controlled disposable PostgreSQL 18 rehearsal for L8 bootstrap safety.',
      nonce: nonce.slice(0, 64),
      createdAt: new Date(nowMs - 60_000).toISOString(),
      expiresAt: new Date(nowMs + 3 * 60 * 60 * 1000).toISOString(),
    },
    requestPrNumber: 2_000_000_000 + Number.parseInt(salt.slice(0, 6), 16) % 100_000_000,
    requestHeadSha: 'a'.repeat(40),
    requestMergeSha: 'b'.repeat(40),
    approvedReviewers: ['approved-maintainer'],
    reviewerPermissions: { 'approved-maintainer': 'admin' },
    workflowRunId: String(Date.now()),
  }
}

async function readAuditCount(): Promise<number> {
  const result = await pool!.query('SELECT count(*)::integer AS count FROM l8_genesis_bootstrap_audit')
  return Number(result.rows[0]?.count ?? 0)
}

async function readRoleVersion(subjectId: string): Promise<number> {
  const result = await pool!.query(
    'SELECT role_version AS "roleVersion" FROM role_authorization_versions WHERE subject_id = $1',
    [subjectId],
  )
  return Number(result.rows[0]?.roleVersion ?? 0)
}

try {
  const sourceCheck = await adminPool.query(
    "SELECT current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(Math.floor(Number(sourceCheck.rows[0]?.version_num) / 10000), 18)

  await adminPool.query('CREATE DATABASE "' + rehearsalDatabase + '" TEMPLATE "luckread_schema"')
  databaseCreated = true
  await adminPool.end()
  pool = new Pool({ connectionString: targetUrl.toString(), max: 6, connectionTimeoutMillis: 5_000 })

  const migrationPath = path.join(workerRoot, 'src/neon-postgres-migrations/0011_l8_genesis_bootstrap_audit.sql')
  await pool.query(readFileSync(migrationPath, 'utf8'))

  const triggerResult = await pool.query(
    "SELECT tgname FROM pg_trigger WHERE tgrelid = 'l8_genesis_bootstrap_audit'::regclass AND NOT tgisinternal",
  )
  const triggerNames = new Set(triggerResult.rows.map((row) => row.tgname))
  assert.ok(triggerNames.has('l8_genesis_bootstrap_audit_no_update_or_delete'))
  assert.ok(triggerNames.has('l8_genesis_bootstrap_audit_no_truncate'))

  const userId = 'w02l8rehearsal' + suffix
  const now = new Date().toISOString()
  await pool.query(
    'INSERT INTO "user" ' +
      '(id, name, email, email_verified, two_factor_enabled, account_state, account_state_version, mfa_enrolled_at) ' +
      'VALUES ($1, $2, $3, TRUE, TRUE, \'ACTIVE\', 1, $4)',
    [userId, 'L8 PG Rehearsal', userId + '@example.invalid', now],
  )
  await pool.query(
    'INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId", verified, "failedVerificationCount") ' +
      'VALUES ($1, $2, $3, $4, TRUE, 0)',
    ['l8-factor-' + suffix, 'synthetic-secret-not-a-real-factor', '[]', userId],
  )
  await pool.query(
    'INSERT INTO role_assignments ' +
      '(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) ' +
      "VALUES ($1, $2, 'verified_user', 'global', NULL, 'ACTIVE', $3, NULL, $3, $3)",
    ['l8-l2-' + suffix, userId, new Date(Date.parse(now) - 60_000).toISOString()],
  )

  const approval = buildApproval(userId, now, suffix)
  assert.equal(await readAuditCount(), 0)
  assert.equal(await readRoleVersion(userId), 1)

  const readiness = await checkL8BootstrapReadinessPostgres(pool, approval, now)
  assert.equal(readiness.status, 'READY_FOR_BOOTSTRAP')
  assert.equal(readiness.targetUserId, userId)
  assert.equal(readiness.productionMutationPerformed, false)
  assert.equal(await readAuditCount(), 0, 'readiness must not consume the one-time audit row')
  assert.equal(await readRoleVersion(userId), 1, 'readiness must not mutate role authorization version')

  const concurrent = await Promise.all([
    bootstrapSuperAdminPostgres(pool, approval, now),
    bootstrapSuperAdminPostgres(pool, approval, now),
  ])
  assert.equal(concurrent.length, 2)
  assert.deepEqual(concurrent.map((item) => item.replayed).sort(), [false, true])
  assert.equal(new Set(concurrent.map((item) => item.assignmentId)).size, 1)
  assert.equal(concurrent[0]?.targetUserId, userId)
  assert.equal(concurrent[0]?.roleId, 'super_admin')
  assert.equal(Date.parse(concurrent[0]!.validUntil) - Date.parse(concurrent[0]!.validFrom), 4 * 60 * 60 * 1000)
  assert.equal(await readAuditCount(), 1)
  assert.equal(await readRoleVersion(userId), 2, 'L8 grant must advance role_version exactly once')

  const replay = await bootstrapSuperAdminPostgres(pool, approval, now)
  assert.equal(replay.replayed, true)
  assert.equal(replay.assignmentId, concurrent[0]?.assignmentId)
  assert.equal(await readAuditCount(), 1)
  assert.equal(await readRoleVersion(userId), 2)

  const immutableUpdate = await pool.query(
    'UPDATE l8_genesis_bootstrap_audit SET valid_until = valid_until + INTERVAL \'1 hour\' WHERE bootstrap_key = $1',
    ['first-l8'],
  ).then(() => null, (error) => error)
  assert.equal(immutableUpdate?.code, '55000', 'audit UPDATE must be rejected')
  const immutableDelete = await pool.query(
    'DELETE FROM l8_genesis_bootstrap_audit WHERE bootstrap_key = $1',
    ['first-l8'],
  ).then(() => null, (error) => error)
  assert.equal(immutableDelete?.code, '55000', 'audit DELETE must be rejected')
  const immutableTruncate = await pool.query('TRUNCATE l8_genesis_bootstrap_audit')
    .then(() => null, (error) => error)
  assert.equal(immutableTruncate?.code, '55000', 'audit TRUNCATE must be rejected')
  assert.equal(await readAuditCount(), 1, 'the one-time audit tombstone must remain permanent')

  const afterExpiry = new Date(Date.parse(concurrent[0]!.validUntil) + 1).toISOString()
  const freshApprovalAfterExpiry = buildApproval(userId, afterExpiry, randomUUID().replaceAll('-', ''))
  await expectReadinessError('BOOTSTRAP_ALREADY_CONSUMED', () =>
    checkL8BootstrapReadinessPostgres(pool!, freshApprovalAfterExpiry, afterExpiry),
  )
  await expectCommandError('BOOTSTRAP_ALREADY_CONSUMED', () =>
    bootstrapSuperAdminPostgres(pool!, freshApprovalAfterExpiry, afterExpiry),
  )
  assert.equal(await readAuditCount(), 1, 'expiration must not reopen the consumed genesis path')

  const report = {
    status: 'W02_L8_GENESIS_BOOTSTRAP_POSTGRES_RUNTIME_PASS',
    postgresMajor: 18,
    databaseTarget: 'disposable-clone-of-luckread_schema',
    migration: '0011_l8_genesis_bootstrap_audit.sql',
    assertions: {
      readOnlyReadiness: true,
      verifiedEmailAndVerifiedTotpRequired: true,
      effectiveL2RoleRequired: true,
      oneTimeAuditAndL8AssignmentCommittedAtomically: true,
      transactionAdvisoryLockSerializesConcurrentRequests: true,
      concurrentSameApprovalHasOneWriterAndOneReplay: true,
      roleVersionAdvancesExactlyOnce: true,
      exactApprovalReplayIsIdempotent: true,
      auditUpdateDeleteAndTruncateRejected: true,
      consumedGenesisCannotBeReissuedAfterFourHourRoleExpires: true,
      syntheticDatabaseDroppedAfterRehearsal: true,
    },
    auditRowsBeforeDatabaseDrop: 1,
    productionDatabaseTouched: false,
    remoteNeonTouched: false,
    cloudflareD1Touched: false,
    secretsCaptured: false,
  }
  mkdirSync(artifactDirectory, { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  primaryError = error
} finally {
  await pool?.end().catch(() => undefined)
  if (!adminPool.ended) await adminPool.end().catch(() => undefined)
  if (databaseCreated) {
    const cleanupPool = new Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 5_000 })
    try {
      await cleanupPool.query('DROP DATABASE IF EXISTS "' + rehearsalDatabase + '" WITH (FORCE)')
    } catch (cleanupError) {
      if (!primaryError) primaryError = cleanupError
    } finally {
      await cleanupPool.end()
    }
  }
}

if (primaryError) throw primaryError
