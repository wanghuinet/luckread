import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')

const pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000 })
const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
const userId = 'auth007-mfa-user-' + suffix
const factorId = 'auth007-mfa-factor-' + suffix
const createdAt = new Date('2026-01-01T00:00:00.000Z')

const assert = (condition, message) => {
  if (!condition) throw new Error('W02_AUTH007_MFA_PG_ASSERTION_FAILED: ' + message)
}
let negativeProbeSequence = 0
const expectPgCode = async (label, operation, expectedCode) => {
  const savepoint = 'mfa_negative_probe_' + (++negativeProbeSequence)
  await client.query('SAVEPOINT ' + savepoint)
  try {
    await operation()
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT ' + savepoint)
    await client.query('RELEASE SAVEPOINT ' + savepoint)
    assert(error && error.code === expectedCode,
      label + ' expected SQLSTATE ' + expectedCode + ', got ' + String(error?.code ?? 'unknown'))
    return
  }
  await client.query('ROLLBACK TO SAVEPOINT ' + savepoint)
  await client.query('RELEASE SAVEPOINT ' + savepoint)
  throw new Error('W02_AUTH007_MFA_PG_ASSERTION_FAILED: ' + label + ' unexpectedly succeeded')
}

let client
let primaryError
let report
try {
  client = await pool.connect()
  const identity = await client.query(
    "SELECT current_setting('server_version_num')::integer AS version_num, current_database() AS database_name",
  )
  const postgresMajor = Math.floor(Number(identity.rows[0].version_num) / 10000)
  assert(postgresMajor === 18, 'PostgreSQL 18 required')
  assert(identity.rows[0].database_name === 'luckread_schema', 'unexpected database target')

  const before = await client.query(
    'SELECT ' +
      '(SELECT COUNT(*)::int FROM "user") AS users, ' +
      '(SELECT COUNT(*)::int FROM "twoFactor") AS factors, ' +
      '(SELECT COUNT(*)::int FROM "session") AS sessions',
  )
  assert(Number(before.rows[0].users) === 0 &&
    Number(before.rows[0].factors) === 0 &&
    Number(before.rows[0].sessions) === 0,
  'MFA baseline must be empty before synthetic probe')

  const userColumns = await client.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = 'user'",
  )
  const userMap = new Map(userColumns.rows.map((row) => [row.column_name, row]))
  assert(userMap.get('two_factor_enabled')?.data_type === 'boolean', 'two_factor_enabled must be PostgreSQL BOOLEAN')
  assert(userMap.get('two_factor_enabled')?.is_nullable === 'NO', 'two_factor_enabled must be NOT NULL')
  assert(userMap.get('two_factor_enabled')?.column_default?.toLowerCase().includes('false'),
    'two_factor_enabled default must be FALSE')
  for (const [name, type] of [
    ['mfa_enrolled_at', 'timestamp with time zone'],
    ['mfa_enrollment_key_hash', 'text'],
    ['mfa_enrollment_confirm_key_hash', 'text'],
    ['mfa_enrollment_confirm_request_hash', 'text'],
  ]) {
    const column = userMap.get(name)
    assert(column?.data_type === type, name + ' type mismatch')
    assert(column?.is_nullable === 'YES', name + ' must be nullable')
    assert(column?.column_default === null, name + ' must have no default')
  }

  const factorColumns = await client.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = 'twoFactor'",
  )
  const factorMap = new Map(factorColumns.rows.map((row) => [row.column_name, row]))
  const expectedFactorColumns = [
    'id', 'secret', 'backupCodes', 'userId', 'verified',
    'failedVerificationCount', 'lockedUntil', 'lastAcceptedTotpTimeStep',
  ].sort()
  assert(JSON.stringify([...factorMap.keys()].sort()) === JSON.stringify(expectedFactorColumns),
    'twoFactor must reuse the official Better Auth table and exact eight-column shape')
  for (const name of ['id', 'secret', 'backupCodes', 'userId']) {
    assert(factorMap.get(name)?.data_type === 'text' && factorMap.get(name)?.is_nullable === 'NO',
      name + ' must remain TEXT NOT NULL')
  }
  assert(factorMap.get('lockedUntil')?.data_type === 'timestamp with time zone' &&
    factorMap.get('lockedUntil')?.is_nullable === 'YES',
  'lockedUntil must use nullable TIMESTAMPTZ')
  assert(factorMap.get('lastAcceptedTotpTimeStep')?.data_type === 'integer',
    'lastAcceptedTotpTimeStep must be INTEGER')
  assert(factorMap.get('lastAcceptedTotpTimeStep')?.is_nullable === 'YES',
    'lastAcceptedTotpTimeStep must remain nullable')
  assert(factorMap.get('verified')?.data_type === 'boolean' &&
    factorMap.get('verified')?.is_nullable === 'NO' &&
    factorMap.get('verified')?.column_default?.toLowerCase().includes('false'),
  'verified must be BOOLEAN NOT NULL DEFAULT FALSE')
  assert(factorMap.get('failedVerificationCount')?.data_type === 'integer' &&
    factorMap.get('failedVerificationCount')?.is_nullable === 'NO' &&
    factorMap.get('failedVerificationCount')?.column_default === '0',
  'failedVerificationCount must be INTEGER NOT NULL DEFAULT 0')
  assert(factorMap.get('userId')?.is_nullable === 'NO', 'twoFactor.userId must be NOT NULL')

  const constraints = await client.query(
    "SELECT conname, contype, pg_get_constraintdef(oid) AS definition " +
      "FROM pg_constraint WHERE conrelid = '\"twoFactor\"'::regclass",
  )
  const constraintMap = new Map(constraints.rows.map((row) => [row.conname, row]))
  assert(constraintMap.get('twoFactor_userId_uq')?.contype === 'u',
    'one factor per user uniqueness constraint is required')
  assert(constraintMap.get('twoFactor_failedVerificationCount_check')?.contype === 'c',
    'non-negative failed verification counter constraint is required')
  assert(constraintMap.get('twoFactor_lastAcceptedTotpTimeStep_check')?.contype === 'c',
    'non-negative TOTP replay step constraint is required')
  const fk = constraints.rows.find((row) => row.contype === 'f')
  assert(Boolean(fk) && /ON DELETE CASCADE/i.test(fk.definition),
    'twoFactor must cascade with its authoritative Better Auth user')

  const triggers = await client.query(
    "SELECT tg.tgname AS name, pg_get_functiondef(tg.tgfoid) AS function_definition, " +
      "pg_get_triggerdef(tg.oid) AS trigger_definition " +
      "FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid " +
      "JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relname = 'user' AND NOT tg.tgisinternal",
  )
  const triggerMap = new Map(triggers.rows.map((row) => [row.name, row.function_definition]))
  assert(triggerMap.has('user_mfa_enable_revoke_sessions'), 'MFA enable session-revocation trigger missing')
  assert(triggerMap.has('user_mfa_disable_clear_enrollment'), 'MFA disable cleanup/session-revocation trigger missing')
  const triggerDefinitions = new Map(triggers.rows.map((row) => [row.name, row.trigger_definition]))
  const enableDefinition = (triggerDefinitions.get('user_mfa_enable_revoke_sessions') ?? '').toLowerCase()
  const disableDefinition = (triggerDefinitions.get('user_mfa_disable_clear_enrollment') ?? '').toLowerCase()
  assert(/update of two_factor_enabled on (?:public\.)?"user"/i.test(enableDefinition) &&
    enableDefinition.includes('old.two_factor_enabled is false') &&
    enableDefinition.includes('new.two_factor_enabled is true'),
  'MFA enable trigger must run only on the false-to-true transition')
  assert(/update of two_factor_enabled on (?:public\.)?"user"/i.test(disableDefinition) &&
    disableDefinition.includes('old.two_factor_enabled is true') &&
    disableDefinition.includes('new.two_factor_enabled is false'),
  'MFA disable trigger must run only on the true-to-false transition')
  assert(triggerMap.get('user_mfa_enable_revoke_sessions')?.includes('mfa_enrolled_at = statement_timestamp()'),
    'MFA enable trigger must set authoritative enrollment time')
  assert(triggerMap.get('user_mfa_enable_revoke_sessions')?.includes('DELETE FROM "session" WHERE user_id = NEW.id'),
    'MFA enable trigger must revoke existing sessions')
  for (const field of [
    'mfa_enrolled_at', 'mfa_enrollment_key_hash',
    'mfa_enrollment_confirm_key_hash', 'mfa_enrollment_confirm_request_hash',
  ]) {
    assert(triggerMap.get('user_mfa_disable_clear_enrollment')?.includes(field),
      'MFA disable trigger must clear ' + field)
  }
  assert(triggerMap.get('user_mfa_disable_clear_enrollment')?.includes('DELETE FROM "session" WHERE user_id = NEW.id'),
    'MFA disable trigger must revoke existing sessions')

  // Run the full lifecycle probe in one transaction and roll it back.
  await client.query('BEGIN')
  try {
    await client.query(
      'INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) ' +
        'VALUES ($1, $2, $3, FALSE, $4, $4)',
      [userId, 'AUTH-007 schema probe', userId + '@example.invalid', createdAt],
    )
    const initial = await client.query(
      'SELECT two_factor_enabled, mfa_enrolled_at, mfa_enrollment_key_hash ' +
        'FROM "user" WHERE id = $1',
      [userId],
    )
    assert(initial.rows[0].two_factor_enabled === false, 'new Better Auth user must default MFA to disabled')
    assert(initial.rows[0].mfa_enrolled_at === null &&
      initial.rows[0].mfa_enrollment_key_hash === null,
    'new user enrollment metadata must default NULL')

    const factor = await client.query(
      'INSERT INTO "twoFactor" (id, "userId", secret, "backupCodes", "lastAcceptedTotpTimeStep") ' +
        'VALUES ($1, $2, $3, $4, $5) RETURNING verified, "failedVerificationCount"',
      [factorId, userId, 'ciphertext-schema-probe-only', 'encrypted-recovery-schema-probe-only', 42],
    )
    assert(factor.rows[0].verified === false, 'factor verified must default FALSE')
    assert(Number(factor.rows[0].failedVerificationCount) === 0, 'failed counter must default 0')

    await expectPgCode('negative failed verification count', () =>
      client.query('UPDATE "twoFactor" SET "failedVerificationCount" = -1 WHERE id = $1', [factorId]), '23514')
    await expectPgCode('negative TOTP time step', () =>
      client.query('UPDATE "twoFactor" SET "lastAcceptedTotpTimeStep" = -1 WHERE id = $1', [factorId]), '23514')
    await expectPgCode('duplicate factor for same user', () =>
      client.query(
        'INSERT INTO "twoFactor" (id, "userId", secret, "backupCodes") VALUES ($1, $2, $3, $4)',
        [factorId + '-duplicate', userId, 'ciphertext', 'encrypted-codes'],
      ), '23505')

    const insertSession = (id) => client.query(
      'INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_id) ' +
        'VALUES ($1, $2, $3, $4, $4, $5)',
      [id, new Date('2040-01-01T00:00:00.000Z'), 'token-schema-probe-' + id, createdAt, userId],
    )
    await insertSession('auth007-session-enable-' + suffix)
    await client.query('UPDATE "user" SET two_factor_enabled = TRUE WHERE id = $1', [userId])
    const enabled = await client.query(
      'SELECT two_factor_enabled, mfa_enrolled_at FROM "user" WHERE id = $1',
      [userId],
    )
    assert(enabled.rows[0].two_factor_enabled === true, 'MFA enable transition must persist')
    assert(enabled.rows[0].mfa_enrolled_at instanceof Date, 'MFA enable must set server-owned enrollment timestamp')
    const afterEnableSessions = await client.query(
      'SELECT COUNT(*)::int AS count FROM "session" WHERE user_id = $1', [userId],
    )
    assert(Number(afterEnableSessions.rows[0].count) === 0, 'MFA enable must revoke all pre-existing sessions')

    // Rewriting TRUE must not re-run the false-to-true lifecycle transition.
    const enrolledAt = enabled.rows[0].mfa_enrolled_at.toISOString()
    await insertSession('auth007-session-noop-' + suffix)
    await client.query('UPDATE "user" SET two_factor_enabled = TRUE WHERE id = $1', [userId])
    const noopSessions = await client.query(
      'SELECT COUNT(*)::int AS count FROM "session" WHERE user_id = $1', [userId],
    )
    const noopState = await client.query(
      'SELECT mfa_enrolled_at FROM "user" WHERE id = $1', [userId],
    )
    assert(Number(noopSessions.rows[0].count) === 1, 'same-value MFA update must not revoke a new session')
    assert(noopState.rows[0].mfa_enrolled_at.toISOString() === enrolledAt,
      'same-value MFA update must not refresh enrollment time')

    await client.query(
      'UPDATE "user" SET mfa_enrollment_key_hash = $1, ' +
        'mfa_enrollment_confirm_key_hash = $2, mfa_enrollment_confirm_request_hash = $3 ' +
        'WHERE id = $4',
      ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), userId],
    )
    await insertSession('auth007-session-disable-' + suffix)
    await client.query('UPDATE "user" SET two_factor_enabled = FALSE WHERE id = $1', [userId])
    const disabled = await client.query(
      'SELECT two_factor_enabled, mfa_enrolled_at, mfa_enrollment_key_hash, ' +
        'mfa_enrollment_confirm_key_hash, mfa_enrollment_confirm_request_hash ' +
        'FROM "user" WHERE id = $1',
      [userId],
    )
    assert(disabled.rows[0].two_factor_enabled === false, 'MFA disable transition must persist')
    for (const field of [
      'mfa_enrolled_at', 'mfa_enrollment_key_hash',
      'mfa_enrollment_confirm_key_hash', 'mfa_enrollment_confirm_request_hash',
    ]) assert(disabled.rows[0][field] === null, 'MFA disable must clear ' + field)
    const afterDisableSessions = await client.query(
      'SELECT COUNT(*)::int AS count FROM "session" WHERE user_id = $1', [userId],
    )
    assert(Number(afterDisableSessions.rows[0].count) === 0, 'MFA disable must revoke all pre-existing sessions')

    // A later enrollment starts a fresh trusted timestamp and again invalidates sessions.
    await insertSession('auth007-session-reenable-' + suffix)
    await client.query('UPDATE "user" SET two_factor_enabled = TRUE WHERE id = $1', [userId])
    const reenabled = await client.query(
      'SELECT mfa_enrolled_at FROM "user" WHERE id = $1', [userId],
    )
    assert(reenabled.rows[0].mfa_enrolled_at instanceof Date,
      're-enrollment must create a fresh server-owned enrollment timestamp')
    const afterReenableSessions = await client.query(
      'SELECT COUNT(*)::int AS count FROM "session" WHERE user_id = $1', [userId],
    )
    assert(Number(afterReenableSessions.rows[0].count) === 0,
      're-enrollment must revoke sessions created after previous disable')

    // The Better Auth user remains the parent; factor/session cleanup is FK-owned.
    await client.query('DELETE FROM "user" WHERE id = $1', [userId])
    const cascade = await client.query(
      'SELECT ' +
        '(SELECT COUNT(*)::int FROM "twoFactor" WHERE "userId" = $1) AS factors, ' +
        '(SELECT COUNT(*)::int FROM "session" WHERE user_id = $1) AS sessions',
      [userId],
    )
    assert(Number(cascade.rows[0].factors) === 0 && Number(cascade.rows[0].sessions) === 0,
      'deleting parent user must cascade to factor and session records')
  } finally {
    await client.query('ROLLBACK')
  }

  const after = await client.query(
    'SELECT ' +
      '(SELECT COUNT(*)::int FROM "user") AS users, ' +
      '(SELECT COUNT(*)::int FROM "twoFactor") AS factors, ' +
      '(SELECT COUNT(*)::int FROM "session") AS sessions',
  )
  assert(Number(after.rows[0].users) === 0 &&
    Number(after.rows[0].factors) === 0 &&
    Number(after.rows[0].sessions) === 0,
  'synthetic MFA lifecycle records must be rolled back and all three tables remain empty')

  report = {
    status: 'W02_AUTH007_MFA_LIFECYCLE_POSTGRES_SCHEMA_PASS',
    postgresMajor,
    checks: {
      officialBetterAuthCoreTablesReused: true,
      twoFactorEnabledBooleanDefaultAndNotNull: true,
      mfaEnrollmentMetadataTypesAndNullability: true,
      nativeFactorDefaultsAndChecks: true,
      oneFactorPerUserConstraint: true,
      durableNonNegativeTotpReplayStep: true,
      enableTransitionSetsServerTimestamp: true,
      enableTransitionRevokesAllExistingSessions: true,
      sameValueEnableDoesNotRetrigger: true,
      disableClearsAllEnrollmentMetadata: true,
      disableRevokesAllExistingSessions: true,
      reenableStartsFreshAndRevokesSessions: true,
      parentUserDeletionCascades: true,
      syntheticLifecycleTransactionRolledBack: true,
      userFactorAndSessionTablesRemainEmpty: true,
    },
    verifiedCheckCount: 15,
    tableRows: { user: 0, twoFactor: 0, session: 0 },
    productionDatabaseTouched: false,
    secretOrRecoveryMaterialImported: false,
  }
} catch (error) {
  primaryError = error
} finally {
  if (client) client.release()
  await pool.end()
}

if (primaryError) throw primaryError
if (!report) throw new Error('W02_AUTH007_MFA_POSTFLIGHT_EVIDENCE_INCOMPLETE')
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
