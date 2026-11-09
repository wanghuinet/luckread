import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import { ensureBaseUserRolePostgres } from '../../src/neon/role-assignment-postgres.js'
import { AccountStateTransitionError } from '../../src/account/account-state-transition.js'
import { createPostgresAccountStateTransitionStore } from '../../src/neon/account-state-transition-store-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing account-state transition rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({
  connectionString,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const accountStateStore = createPostgresAccountStateTransitionStore(pool)

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(workerRoot, 'artifacts/neon/w02-account-state-transition-postgres-runtime-rehearsal.json')
const suffix = randomUUID().replaceAll('-', '').slice(0, 18).toLowerCase()
const now = '2026-11-09T12:00:00.000Z'
const createdAt = new Date('2026-01-01T00:00:00.000Z')

const users = {
  moderator: 'auth013-moderator-' + suffix,
  moderatorNoMfa: 'auth013-no-mfa-' + suffix,
  inactiveModerator: 'auth013-inactive-mod-' + suffix,
  admin: 'auth013-admin-' + suffix,
  noRole: 'auth013-no-role-' + suffix,
  restricted: 'auth013-restricted-' + suffix,
  deniedSuspend: 'auth013-denied-suspend-' + suffix,
  deniedNoMfa: 'auth013-denied-no-mfa-' + suffix,
  deniedNoRole: 'auth013-denied-no-role-' + suffix,
  suspended: 'auth013-suspended-' + suffix,
  frozen: 'auth013-frozen-' + suffix,
  invalid: 'auth013-invalid-' + suffix,
  stale: 'auth013-stale-' + suffix,
  approval: 'auth013-approval-' + suffix,
  self: 'auth013-self-' + suffix,
  concurrent: 'auth013-concurrent-' + suffix,
  rollback: 'auth013-rollback-' + suffix,
  deniedInactiveActor: 'auth013-denied-inactive-' + suffix,
  deniedInactiveTarget: 'auth013-denied-inactive-target-' + suffix,
}
const allUserIds = Object.values(users)
const moderatorRoleId = 'auth013-role-moderator-' + suffix
const moderatorNoMfaRoleId = 'auth013-role-no-mfa-' + suffix
const inactiveModeratorRoleId = 'auth013-role-inactive-' + suffix
const adminRoleId = 'auth013-role-admin-' + suffix
const sessionSuspended = 'auth013-session-suspended-' + suffix
const sessionFrozen = 'auth013-session-frozen-' + suffix
let primaryError: unknown
let cleanupError: unknown
let cleanupVerified = false

const checks: Record<string, boolean> = {
  accountStateTransitionExecutedThroughProviderNeutralStore: false,
  moderatorPermissionMfaAndLayerAreRecheckedInsideTransaction: false,
  adminSuspensionWritesJournalAndInvalidatesSessionsAtomically: false,
  freezePreservesSessionsAndCanBeReversed: false,
  moderatorCanRestoreLimitedRestriction: false,
  inactiveModeratorIsDenied: false,
  selfModerationIsDenied: false,
  missingRoleAndMissingMfaFailClosed: false,
  invalidTransitionAndStaleVersionDoNotWrite: false,
  approvalRequiredBanFailsClosed: false,
  concurrentSameVersionTransitionsHaveExactlyOneWinner: false,
  duplicateJournalVersionRollsBackAccountMutation: false,
  syntheticRowsCleaned: false,
}

const insertUser = async (
  id: string,
  options: { state?: string; version?: number; mfa?: boolean } = {},
): Promise<void> => {
  const state = options.state ?? 'ACTIVE'
  const version = options.version ?? 1
  const mfa = options.mfa ?? false
  const enrolledAt = mfa ? new Date(new Date(now).getTime() - 60_000) : null
  await pool.query(
    'INSERT INTO "user" ' +
      '(id, name, email, email_verified, created_at, updated_at, two_factor_enabled, account_state, account_state_version, mfa_enrolled_at) ' +
      'VALUES ($1, $2, $3, TRUE, $4, $4, $5, $6, $7, $8)',
    [id, 'AUTH-013 account-state PostgreSQL rehearsal', id + '@example.invalid', createdAt, mfa, state, version, enrolledAt],
  )
  if (mfa) {
    await pool.query(
      'INSERT INTO "twoFactor" ' +
        '(id, secret, "backupCodes", "userId", verified, "failedVerificationCount", "lockedUntil", "lastAcceptedTotpTimeStep") ' +
        'VALUES ($1, $2, $3, $4, TRUE, 0, NULL, NULL)',
      [
        'auth013-factor-' + id,
        'encrypted:test-only-account-state-totp',
        'encrypted:test-only-account-state-backup-codes',
        id,
      ],
    )
  }
  await ensureBaseUserRolePostgres(pool, id, now)
}

const grantRole = async (subjectId: string, roleId: 'moderator' | 'admin', assignmentId: string): Promise<void> => {
  await pool.query(
    'INSERT INTO role_assignments ' +
      '(id, subject_id, role_id, scope_type, scope_id, status, valid_from, valid_until, created_at, updated_at) ' +
      "VALUES ($1, $2, $3, 'global', NULL, 'ACTIVE', $4, NULL, $4, $4)",
    [assignmentId, subjectId, roleId, now],
  )
}

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
  assert.ok(caught instanceof AccountStateTransitionError, 'expected shared W02 AccountStateTransitionError')
  assert.equal(caught.code, code)
}

const transition = (
  subjectId: string,
  targetUserId: string,
  to: 'ACTIVE' | 'RESTRICTED' | 'FROZEN' | 'SUSPENDED' | 'BANNED',
  expectedVersion = 1,
) => accountStateStore.transition({
  subjectId,
  targetUserId,
  to,
  reason: 'AUTH-013 PostgreSQL controlled runtime rehearsal',
  expectedVersion,
  correlationId: 'corr-auth013-' + suffix,
  causationId: 'cause-auth013-' + suffix,
})

const readAccount = async (id: string) => {
  const result = await pool.query<{ accountState: string; accountStateVersion: number }>(
    'SELECT account_state AS "accountState", account_state_version AS "accountStateVersion" ' +
      'FROM "user" WHERE id = $1',
    [id],
  )
  assert.equal(result.rowCount, 1)
  return result.rows[0]!
}

const countJournal = async (id: string): Promise<number> => {
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

  await insertUser(users.moderator, { mfa: true })
  await insertUser(users.moderatorNoMfa)
  await insertUser(users.inactiveModerator, { mfa: true })
  await insertUser(users.admin, { mfa: true })
  await insertUser(users.noRole)
  await insertUser(users.restricted)
  await insertUser(users.deniedSuspend)
  await insertUser(users.deniedNoMfa)
  await insertUser(users.deniedNoRole)
  await insertUser(users.suspended)
  await insertUser(users.frozen)
  await insertUser(users.invalid, { state: 'PENDING_VERIFICATION' })
  await insertUser(users.stale, { version: 2 })
  await insertUser(users.approval)
  await insertUser(users.self)
  await insertUser(users.concurrent)
  await insertUser(users.rollback)
  await insertUser(users.deniedInactiveActor)
  await insertUser(users.deniedInactiveTarget)

  await grantRole(users.moderator, 'moderator', moderatorRoleId)
  await grantRole(users.moderatorNoMfa, 'moderator', moderatorNoMfaRoleId)
  await grantRole(users.inactiveModerator, 'moderator', inactiveModeratorRoleId)
  await grantRole(users.admin, 'admin', adminRoleId)
  await grantRole(users.deniedInactiveActor, 'moderator', 'auth013-role-denied-inactive-' + suffix)
  await pool.query('UPDATE "user" SET account_state = $1 WHERE id = $2', ['SUSPENDED', users.deniedInactiveActor])

  // L6 moderator + verified TOTP can restrict; event attribution preserves
  // the canonical PLATFORM_OPERATOR event shape for operator transitions.
  const restrictedResult = await transition(users.moderator, users.restricted, 'RESTRICTED')
  assert.equal(restrictedResult.from, 'ACTIVE')
  assert.equal(restrictedResult.to, 'RESTRICTED')
  assert.equal(restrictedResult.accountStateVersion, 2)
  const restrictedJournal = await pool.query<{ payload: Record<string, unknown> | string }>(
    'SELECT payload FROM auth_013_publication_journal WHERE resource_id = $1',
    [users.restricted],
  )
  const restrictedPayload = restrictedJournal.rows[0]?.payload
  const restrictedEvent = typeof restrictedPayload === 'string'
    ? JSON.parse(restrictedPayload) as Record<string, unknown>
    : restrictedPayload
  assert.equal(restrictedEvent?.eventType, 'identity.account_state_changed')
  assert.deepEqual(restrictedEvent?.actor, {
    actorId: users.moderator,
    actorType: 'user',
    operationalRole: 'PLATFORM_OPERATOR',
  })
  assert.equal(await countJournal(users.restricted), 1)
  checks.accountStateTransitionExecutedThroughProviderNeutralStore = true
  checks.moderatorPermissionMfaAndLayerAreRecheckedInsideTransaction = true

  // The actor role may exist, but a lower layer, inactive actor, or missing MFA
  // cannot be used to exercise permissions that the role catalog withholds.
  await expectCode('FORBIDDEN', () => transition(users.moderator, users.deniedSuspend, 'SUSPENDED'))
  await expectCode('FORBIDDEN', () => transition(users.moderatorNoMfa, users.deniedNoMfa, 'RESTRICTED'))
  await expectCode('FORBIDDEN', () => transition(users.noRole, users.deniedNoRole, 'RESTRICTED'))
  await expectCode('FORBIDDEN', () => transition(users.deniedInactiveActor, users.deniedInactiveTarget, 'RESTRICTED'))
  checks.missingRoleAndMissingMfaFailClosed = true
  checks.inactiveModeratorIsDenied = true

  // L7 admin can suspend. The session delete and immutable AUTH-013 intent
  // commit together, so a journal failure cannot leave only one side applied.
  await pool.query(
    'INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id) ' +
      'VALUES ($1, $2, $3, $4, $4, $5)',
    [sessionSuspended, new Date('2027-01-01T00:00:00.000Z'), 'auth013-token-suspended-' + suffix, createdAt, users.suspended],
  )
  const suspendResult = await transition(users.admin, users.suspended, 'SUSPENDED')
  assert.equal(suspendResult.to, 'SUSPENDED')
  assert.equal(suspendResult.accountStateVersion, 2)
  const suspendedSessionCount = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::integer AS count FROM "session" WHERE user_id = $1',
    [users.suspended],
  )
  assert.equal(Number(suspendedSessionCount.rows[0]?.count), 0)
  assert.equal(await countJournal(users.suspended), 1)
  checks.adminSuspensionWritesJournalAndInvalidatesSessionsAtomically = true

  // FROZEN is intentionally not in x-token-invalidation-states. The session
  // remains present, and a canonical unfreeze action can restore ACTIVE.
  await pool.query(
    'INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id) ' +
      'VALUES ($1, $2, $3, $4, $4, $5)',
    [sessionFrozen, new Date('2027-01-01T00:00:00.000Z'), 'auth013-token-frozen-' + suffix, createdAt, users.frozen],
  )
  const freezeResult = await transition(users.admin, users.frozen, 'FROZEN')
  assert.equal(freezeResult.to, 'FROZEN')
  const retainedFrozenSession = await pool.query(
    'SELECT id FROM "session" WHERE id = $1 AND user_id = $2',
    [sessionFrozen, users.frozen],
  )
  assert.equal(retainedFrozenSession.rowCount, 1)
  const unfreeze = await transition(users.admin, users.frozen, 'ACTIVE', 2)
  assert.equal(unfreeze.to, 'ACTIVE')
  assert.equal((await readAccount(users.frozen)).accountStateVersion, 3)
  checks.freezePreservesSessionsAndCanBeReversed = true

  const restoreLimited = await transition(users.moderator, users.restricted, 'ACTIVE', 2)
  assert.equal(restoreLimited.to, 'ACTIVE')
  assert.equal((await readAccount(users.restricted)).accountStateVersion, 3)
  checks.moderatorCanRestoreLimitedRestriction = true

  // Account-owning self moderation is forbidden even when the subject has a
  // privileged role; the adapter only accepts actions on a different account.
  await expectCode('FORBIDDEN', () => transition(users.admin, users.admin, 'RESTRICTED'))
  checks.selfModerationIsDenied = true

  // The contract requires external L7 approval for BANNED. A permission grant
  // alone is deliberately insufficient; this adapter does not forge approval.
  await expectCode('FORBIDDEN', () => transition(users.admin, users.approval, 'BANNED'))
  assert.equal((await readAccount(users.approval)).accountState, 'ACTIVE')
  assert.equal(await countJournal(users.approval), 0)
  checks.approvalRequiredBanFailsClosed = true

  await expectCode('INVALID_STATE', () => transition(users.admin, users.invalid, 'SUSPENDED'))
  await expectCode('CONFLICT', () => transition(users.admin, users.stale, 'SUSPENDED'))
  assert.equal((await readAccount(users.invalid)).accountStateVersion, 1)
  assert.equal((await readAccount(users.stale)).accountStateVersion, 2)
  checks.invalidTransitionAndStaleVersionDoNotWrite = true

  // Concurrent transitions with one If-Match version serialize on the target
  // row: exactly one commits the state, journal, and version increment.
  const concurrent = await Promise.allSettled([
    transition(users.admin, users.concurrent, 'SUSPENDED'),
    transition(users.admin, users.concurrent, 'FROZEN'),
  ])
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = concurrent.filter((result) => result.status === 'rejected')
  assert.equal(rejected.length, 1)
  assert.ok(rejected[0]?.status === 'rejected')
  assert.ok(rejected[0].reason instanceof AccountStateTransitionError)
  // The canonical D1 kernel evaluates the current state-machine edge before
  // comparing If-Match. Depending on which concurrent transition wins, the
  // stale command is therefore a CONFLICT or an INVALID_STATE; both guarantee
  // that the losing command has no side effects.
  assert.ok(['CONFLICT', 'INVALID_STATE'].includes(rejected[0].reason.code))
  assert.equal((await readAccount(users.concurrent)).accountStateVersion, 2)
  assert.equal(await countJournal(users.concurrent), 1)
  checks.concurrentSameVersionTransitionsHaveExactlyOneWinner = true

  // A duplicate AUTH-013 resource/version row is forced to fail after the
  // account UPDATE. PostgreSQL must roll the state and version back.
  await pool.query(
    'INSERT INTO auth_013_publication_journal ' +
      '(journal_id, event_id, event_type, schema_version, resource_id, source_version, payload, status, attempt, created_at) ' +
      "VALUES ($1, $2, 'identity.account_state_changed', '1.0', $3, 2, '{}', 'PENDING', 1, $4)",
    ['auth013-seed-journal-' + suffix, randomUUID(), users.rollback, createdAt],
  )
  await expectCode('CONFLICT', () => transition(users.admin, users.rollback, 'SUSPENDED'))
  assert.deepEqual(await readAccount(users.rollback), {
    accountState: 'ACTIVE',
    accountStateVersion: 1,
  })
  assert.equal(await countJournal(users.rollback), 1)
  checks.duplicateJournalVersionRollsBackAccountMutation = true

} catch (error) {
  primaryError = error
} finally {
  try {
    await pool.query('DELETE FROM "session" WHERE user_id = ANY($1::text[])', [allUserIds])
    await pool.query('DELETE FROM auth_013_publication_journal WHERE resource_id = ANY($1::text[])', [allUserIds])
    await pool.query('DELETE FROM role_assignments WHERE subject_id = ANY($1::text[])', [allUserIds])
    await pool.query('DELETE FROM role_authorization_versions WHERE subject_id = ANY($1::text[])', [allUserIds])
    await pool.query('DELETE FROM "twoFactor" WHERE "userId" = ANY($1::text[])', [allUserIds])
    await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [allUserIds])

    const remaining = await pool.query<{ count: number }>(
      'SELECT ' +
        '(SELECT COUNT(*) FROM "user" WHERE id = ANY($1::text[])) + ' +
        '(SELECT COUNT(*) FROM "session" WHERE user_id = ANY($1::text[])) + ' +
        '(SELECT COUNT(*) FROM role_assignments WHERE subject_id = ANY($1::text[])) + ' +
        '(SELECT COUNT(*) FROM role_authorization_versions WHERE subject_id = ANY($1::text[])) + ' +
        '(SELECT COUNT(*) FROM "twoFactor" WHERE "userId" = ANY($1::text[])) + ' +
        '(SELECT COUNT(*) FROM auth_013_publication_journal WHERE resource_id = ANY($1::text[])) ' +
        'AS count',
      [allUserIds],
    )
    cleanupVerified = Number(remaining.rows[0]?.count ?? -1) === 0
    assert.equal(cleanupVerified, true, 'all synthetic account-state rows must be removed')
    checks.syntheticRowsCleaned = true
  } catch (error) {
    cleanupError = error
  }

  try {
    await pool.end()
  } catch (error) {
    if (!cleanupError) cleanupError = error
  }
}

const failure = primaryError ?? cleanupError
const report = {
  reportVersion: 1,
  status: failure
    ? 'W02_ACCOUNT_STATE_TRANSITION_POSTGRES_RUNTIME_REHEARSAL_FAILED'
    : 'W02_ACCOUNT_STATE_TRANSITION_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only W02 moderator/admin account-state PostgreSQL adapter on disposable PostgreSQL 18; production Worker and D1 authority are unchanged.',
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
  console.error(report.status + ' ' + report.error)
  process.exitCode = 1
} else {
  console.log(report.status + ' ' + JSON.stringify(report))
}
