import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')

const pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000 })
const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
const userA = 'username-state-a-' + suffix
const userB = 'username-state-b-' + suffix
const userC = 'username-state-c-' + suffix
const createdAt = new Date('2026-01-01T00:00:00.000Z')
const futureExpiry = new Date('2040-01-01T00:00:00.000Z')
const pastExpiry = new Date('2020-01-01T00:00:00.000Z')

const assert = (condition, message) => {
  if (!condition) throw new Error('W02_USERNAME_STATE_PG_ASSERTION_FAILED: ' + message)
}
let client
let savepointSequence = 0
const expectPgCode = async (label, operation, expectedCode) => {
  const savepoint = 'username_negative_probe_' + (++savepointSequence)
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
  throw new Error('W02_USERNAME_STATE_PG_ASSERTION_FAILED: ' + label + ' unexpectedly succeeded')
}

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
      '(SELECT COUNT(*)::int FROM auth_identities) AS identities, ' +
      '(SELECT COUNT(*)::int FROM auth_username_change_state) AS states',
  )
  assert(Number(before.rows[0].users) === 0 &&
    Number(before.rows[0].identities) === 0 &&
    Number(before.rows[0].states) === 0,
  'username schema baseline must be empty before synthetic probe')

  const stateColumns = await client.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = 'auth_username_change_state'",
  )
  const stateMap = new Map(stateColumns.rows.map((row) => [row.column_name, row]))
  const expectedStateColumns = [
    'user_id', 'username_version', 'last_changed_at', 'previous_username',
    'previous_username_normalized', 'previous_username_expires_at',
    'idempotency_key_hash', 'request_fingerprint', 'idempotency_expires_at', 'changed_username',
  ].sort()
  assert(JSON.stringify([...stateMap.keys()].sort()) === JSON.stringify(expectedStateColumns),
    'username state table must have the exact ten-column contract')
  for (const name of [
    'user_id', 'previous_username', 'previous_username_normalized',
    'idempotency_key_hash', 'request_fingerprint', 'changed_username',
  ]) {
    assert(stateMap.get(name)?.data_type === 'text', name + ' must use TEXT')
  }
  assert(stateMap.get('username_version')?.data_type === 'integer' &&
    stateMap.get('username_version')?.is_nullable === 'NO',
  'username_version must use INTEGER NOT NULL')
  for (const name of ['last_changed_at', 'idempotency_expires_at']) {
    assert(stateMap.get(name)?.data_type === 'timestamp with time zone' &&
      stateMap.get(name)?.is_nullable === 'NO', name + ' must use TIMESTAMPTZ NOT NULL')
  }
  assert(stateMap.get('previous_username_expires_at')?.data_type === 'timestamp with time zone' &&
    stateMap.get('previous_username_expires_at')?.is_nullable === 'YES',
  'previous_username_expires_at must use nullable TIMESTAMPTZ')
  for (const name of ['previous_username', 'previous_username_normalized', 'previous_username_expires_at']) {
    assert(stateMap.get(name)?.is_nullable === 'YES', name + ' must remain nullable')
  }
  for (const name of ['idempotency_key_hash', 'request_fingerprint', 'changed_username', 'user_id']) {
    assert(stateMap.get(name)?.is_nullable === 'NO', name + ' must be NOT NULL')
  }

  const indexes = await client.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND " +
      "(tablename = 'auth_username_change_state' OR (tablename = 'user' AND indexname IN ('auth_user_username_normalized_lookup_idx', 'user_username_uq')))",
  )
  const indexMap = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]))
  for (const name of [
    'auth_username_change_state_pkey',
    'auth_username_change_state_previous_name_idx',
    'auth_username_change_state_last_changed_idx',
    'auth_user_username_normalized_lookup_idx',
    'user_username_uq',
  ]) assert(indexMap.has(name), 'required username index/constraint missing: ' + name)
  assert(indexMap.get('auth_username_change_state_previous_name_idx')?.includes('(previous_username_normalized, previous_username_expires_at)'),
    'previous-name index columns mismatch')
  assert(indexMap.get('auth_username_change_state_last_changed_idx')?.includes('(last_changed_at)'),
    'last-changed index columns mismatch')
  assert(indexMap.get('auth_user_username_normalized_lookup_idx')?.includes('(lower(username))'),
    'username normalized lookup index mismatch')
  assert(indexMap.get('user_username_uq')?.includes('CREATE UNIQUE INDEX') &&
    indexMap.get('user_username_uq')?.includes('(username)'),
  'Better Auth username must retain the source D1 unique constraint')

  const constraints = await client.query(
    "SELECT conname, contype, pg_get_constraintdef(oid) AS definition " +
      "FROM pg_constraint WHERE conrelid = 'auth_username_change_state'::regclass",
  )
  const constraintMap = new Map(constraints.rows.map((row) => [row.conname, row]))
  for (const name of [
    'auth_username_change_state_pkey',
    'auth_username_change_state_username_version_check',
    'auth_username_change_state_idempotency_key_hash_check',
    'auth_username_change_state_request_fingerprint_check',
    'auth_username_change_state_previous_name_group_check',
  ]) assert(constraintMap.has(name), 'required username state constraint missing: ' + name)
  const stateForeignKeys = constraints.rows.filter((row) => row.contype === 'f')
  assert(stateForeignKeys.length === 0, 'source username state migration must not invent a new FK')

  const triggers = await client.query(
    "SELECT tg.tgname AS name, pg_get_functiondef(tg.tgfoid) AS function_definition, " +
      "pg_get_triggerdef(tg.oid) AS trigger_definition " +
      "FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid " +
      "JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE n.nspname = 'public' AND c.relname = 'user' AND NOT tg.tgisinternal",
  )
  const triggerMap = new Map(triggers.rows.map((row) => [row.name, row.function_definition]))
  const triggerDefinitions = new Map(triggers.rows.map((row) => [row.name, row.trigger_definition]))
  for (const name of [
    'auth_username_identity_projection_sync',
    'auth_user_previous_username_reservation_guard_insert',
    'auth_user_previous_username_reservation_guard_update',
  ]) assert(triggerMap.has(name), 'required username trigger missing: ' + name)
  const projectionDefinition = (triggerMap.get('auth_username_identity_projection_sync') ?? '').toLowerCase()
  assert(projectionDefinition.includes('username_normalized = lower(new.username)') &&
    projectionDefinition.includes("normalization_version = 'unicode-nfc-casefold-v1'"),
  'identity projection must synchronize exact username normalization metadata')
  const guardDefinition = (triggerMap.get('auth_user_previous_username_reservation_guard_insert') ?? '').toLowerCase()
  assert(guardDefinition.includes('previous_username_normalized = lower(new.username)') &&
    guardDefinition.includes('previous_username_expires_at > statement_timestamp()') &&
    guardDefinition.includes("message = 'username_reserved'"),
  'reservation guard must compare exact normalized username with a live 30-day lease')
  const insertDefinition = (triggerDefinitions.get('auth_user_previous_username_reservation_guard_insert') ?? '').toLowerCase()
  const updateDefinition = (triggerDefinitions.get('auth_user_previous_username_reservation_guard_update') ?? '').toLowerCase()
  assert(/before insert on (?:public\.)?"user"/i.test(insertDefinition),
    'reservation guard must cover Better Auth registration inserts')
  assert(/before update of username on (?:public\.)?"user"/i.test(updateDefinition),
    'reservation guard must cover Better Auth username updates')

  await client.query('BEGIN')
  try {
    await client.query(
      'INSERT INTO "user" (id, name, email, email_verified, username, created_at, updated_at) ' +
        'VALUES ($1, $2, $3, FALSE, $4, $5, $5)',
      [userA, 'username schema probe A', userA + '@example.invalid', 'OldName', createdAt],
    )
    await client.query(
      'INSERT INTO auth_identities (id, user_id, username, username_normalized, normalization_version) ' +
        'VALUES ($1, $2, $3, $4, $5)',
      ['identity-' + suffix, userA, 'OldName', 'oldname', 'unicode-nfc-casefold-v1'],
    )

    // The authoritative Better Auth username update must mirror the existing W02 identity projection.
    await client.query('UPDATE "user" SET username = $1 WHERE id = $2', ['NewName', userA])
    const identityProjection = await client.query(
      'SELECT username, username_normalized, normalization_version FROM auth_identities WHERE user_id = $1',
      [userA],
    )
    assert(identityProjection.rows[0]?.username === 'NewName' &&
      identityProjection.rows[0]?.username_normalized === 'newname' &&
      identityProjection.rows[0]?.normalization_version === 'unicode-nfc-casefold-v1',
    'W02 username identity projection must synchronize in the same transaction')

    await client.query(
      'INSERT INTO auth_username_change_state (' +
        'user_id, username_version, last_changed_at, previous_username, previous_username_normalized, ' +
        'previous_username_expires_at, idempotency_key_hash, request_fingerprint, idempotency_expires_at, changed_username' +
      ') VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        userA, new Date('2026-11-02T00:01:00.000Z'), 'OldName', 'oldname', futureExpiry,
        'a'.repeat(64), 'b'.repeat(64), new Date('2026-11-03T00:01:00.000Z'), 'NewName',
      ],
    )

    await client.query(
      'INSERT INTO "user" (id, name, email, email_verified, username, created_at, updated_at) ' +
        'VALUES ($1, $2, $3, FALSE, $4, $5, $5)',
      [userB, 'username schema probe B', userB + '@example.invalid', 'AvailableName', createdAt],
    )
    await expectPgCode('previous username insert guard', () => client.query(
      'INSERT INTO "user" (id, name, email, email_verified, username, created_at, updated_at) ' +
        'VALUES ($1, $2, $3, FALSE, $4, $5, $5)',
      [userC, 'username schema probe C', userC + '@example.invalid', 'oldname', createdAt],
    ), '23514')
    await expectPgCode('previous username update guard', () =>
      client.query('UPDATE "user" SET username = $1 WHERE id = $2', ['oldname', userB]), '23514')

    // Once the lease expires, the old handle is no longer reserved and can be registered.
    await client.query(
      'UPDATE auth_username_change_state SET previous_username_expires_at = $1 WHERE user_id = $2',
      [pastExpiry, userA],
    )
    await client.query(
      'INSERT INTO "user" (id, name, email, email_verified, username, created_at, updated_at) ' +
        'VALUES ($1, $2, $3, FALSE, $4, $5, $5)',
      [userC, 'username schema probe C', userC + '@example.invalid', 'oldname', createdAt],
    )

    // The primary key is the compact current-state row, not an append-only alias ledger.
    const stateRows = await client.query(
      'SELECT COUNT(*)::int AS count FROM auth_username_change_state WHERE user_id = $1',
      [userA],
    )
    assert(Number(stateRows.rows[0].count) === 1, 'one compact username state row per account')

    await expectPgCode('invalid username version', () =>
      client.query(
        'INSERT INTO auth_username_change_state ' +
          '(user_id, username_version, last_changed_at, idempotency_key_hash, request_fingerprint, idempotency_expires_at, changed_username) ' +
          'VALUES ($1, 0, $2, $3, $4, $5, $6)',
        ['invalid-' + suffix, createdAt, 'c'.repeat(64), 'd'.repeat(64), futureExpiry, 'BadName'],
      ), '23514')
    await expectPgCode('invalid idempotency hash length', () =>
      client.query(
        'INSERT INTO auth_username_change_state ' +
          '(user_id, username_version, last_changed_at, idempotency_key_hash, request_fingerprint, idempotency_expires_at, changed_username) ' +
          'VALUES ($1, 1, $2, $3, $4, $5, $6)',
        ['invalid-hash-' + suffix, createdAt, 'short', 'e'.repeat(64), futureExpiry, 'BadName'],
      ), '23514')
  } finally {
    await client.query('ROLLBACK')
  }

  const after = await client.query(
    'SELECT ' +
      '(SELECT COUNT(*)::int FROM "user") AS users, ' +
      '(SELECT COUNT(*)::int FROM auth_identities) AS identities, ' +
      '(SELECT COUNT(*)::int FROM auth_username_change_state) AS states',
  )
  assert(Number(after.rows[0].users) === 0 &&
    Number(after.rows[0].identities) === 0 &&
    Number(after.rows[0].states) === 0,
  'synthetic username state must be rolled back; all user/identity/state tables remain empty')

  report = {
    status: 'W02_USERNAME_CHANGE_STATE_POSTGRES_SCHEMA_PASS',
    postgresMajor,
    checks: {
      exactTenColumnCompactState: true,
      nativePostgresTimestampTypes: true,
      versionAndSha256HashConstraints: true,
      previousNameMetadataNullGroupConstraint: true,
      betterAuthUsernameUniquenessPreserved: true,
      usernameProjectionTriggerSynchronizesAuthIdentity: true,
      registrationInsertReservationGuard: true,
      usernameUpdateReservationGuard: true,
      activeThirtyDayReservationBlocksReclaim: true,
      expiredReservationAllowsReuse: true,
      oneCurrentStateRowPerRenamedAccount: true,
      noForeignKeyOrPermanentAliasLedgerInvented: true,
      syntheticUsernameLifecycleTransactionRolledBack: true,
      userIdentityAndStateTablesRemainEmpty: true,
    },
    verifiedCheckCount: 14,
    tableRows: { user: 0, auth_identities: 0, auth_username_change_state: 0 },
    productionDatabaseTouched: false,
    userRowsOrUsernameAliasesImported: false,
    payloadRedirectRowsCreated: false,
  }
} catch (error) {
  primaryError = error
} finally {
  if (client) client.release()
  await pool.end()
}

if (primaryError) throw primaryError
if (!report) throw new Error('W02_USERNAME_CHANGE_POSTFLIGHT_EVIDENCE_INCOMPLETE')
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
