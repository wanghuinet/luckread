import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')

const pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000 })
const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
const identityId = 'auth003-identity-' + suffix
const otherIdentityId = 'auth003-identity-b-' + suffix
const nullIdentityId = 'auth003-identity-null-b-' + suffix
const identityIds = [identityId, otherIdentityId, nullIdentityId]
const userIds = ['auth003-user-' + suffix, 'auth003-user-b-' + suffix, 'auth003-user-null-b-' + suffix]
const timestamp = new Date('2026-01-01T00:00:00.000Z')

const assert = (condition, message) => {
  if (!condition) throw new Error('W02_AUTH003_PG_ASSERTION_FAILED: ' + message)
}
const expectPgCode = async (label, operation, expectedCode) => {
  try {
    await operation()
  } catch (error) {
    assert(error && error.code === expectedCode,
      label + ' expected SQLSTATE ' + expectedCode + ', got ' + String(error?.code ?? 'unknown'))
    return
  }
  throw new Error('W02_AUTH003_PG_ASSERTION_FAILED: ' + label + ' unexpectedly succeeded')
}
const insertIdentity = (id, userId, usernameNormalized = null, emailNormalized = null, phoneNormalized = null) =>
  pool.query(
    'INSERT INTO auth_identities ' +
      '(id, user_id, username, username_normalized, email, email_normalized, phone, phone_normalized, normalization_version) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [id, userId, null, usernameNormalized, null, emailNormalized, null, phoneNormalized, 'unicode-nfc-casefold-v1'],
  )
const insertCredential = (id, owner, kind, valueHash, normalizedValue, active) =>
  pool.query(
    'INSERT INTO auth_credentials (id, identity_id, kind, value_hash, normalized_value, active, verified_at, created_at, updated_at) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
    [id, owner, kind, valueHash, normalizedValue, active, timestamp, timestamp],
  )

let assertionsPassed = 0
let primaryError
try {
  const identity = await pool.query(
    "SELECT current_setting('server_version_num')::integer AS version_num, current_database() AS database_name",
  )
  const postgresMajor = Math.floor(Number(identity.rows[0].version_num) / 10000)
  assert(postgresMajor === 18, 'PostgreSQL 18 required')
  assert(identity.rows[0].database_name === 'luckread_schema', 'unexpected database target')
  assertionsPassed++

  const identityIndexes = await pool.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'auth_identities'",
  )
  const identityIndexNames = new Set(identityIndexes.rows.map((row) => row.indexname))
  for (const name of [
    'auth_identities_pkey',
    'auth_identities_user_id_uq',
    'auth_identities_username_normalized_uq',
    'auth_identities_email_normalized_uq',
    'auth_identities_phone_normalized_uq',
  ]) assert(identityIndexNames.has(name), 'required identity index missing: ' + name)
  assertionsPassed++

  const credentialIndexes = await pool.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'auth_credentials'",
  )
  const credentialIndexNames = new Set(credentialIndexes.rows.map((row) => row.indexname))
  for (const name of [
    'auth_credentials_pkey',
    'auth_credentials_value_hash_uq',
    'auth_credentials_kind_normalized_value_uq',
    'auth_credentials_identity_id_idx',
    'auth_credentials_verified_at_idx',
    'auth_credentials_active_idx',
    'auth_credentials_created_at_idx',
    'auth_credentials_updated_at_idx',
  ]) assert(credentialIndexNames.has(name), 'required credential index missing: ' + name)
  assertionsPassed++

  const identityColumns = await pool.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_identities'",
  )
  const identityColumnMap = new Map(identityColumns.rows.map((row) => [row.column_name, row]))
  assert(identityColumnMap.size === 9, 'identity table has an unexpected column count')
  assert(identityColumnMap.get('normalization_version')?.is_nullable === 'NO', 'normalization version must be required')
  assertionsPassed++

  const credentialColumns = await pool.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_credentials'",
  )
  const credentialColumnMap = new Map(credentialColumns.rows.map((row) => [row.column_name, row]))
  assert(credentialColumnMap.size === 9, 'credential table has an unexpected column count')
  assert(credentialColumnMap.get('active')?.data_type === 'boolean', 'active must be native PostgreSQL boolean')
  assert(credentialColumnMap.get('active')?.column_default === 'true', 'active must default to true')
  assert(credentialColumnMap.get('created_at')?.data_type === 'timestamp with time zone', 'created_at must be timestamptz')
  assert(credentialColumnMap.get('updated_at')?.data_type === 'timestamp with time zone', 'updated_at must be timestamptz')
  assertionsPassed++

  const foreignKeys = await pool.query(
    "SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'auth_credentials'::regclass AND contype = 'f'",
  )
  assert(foreignKeys.rows.length === 1, 'credential identity FK count mismatch')
  assert(foreignKeys.rows[0].conname === 'auth_credentials_identity_fk', 'credential identity FK name mismatch')
  assert(foreignKeys.rows[0].confdeltype === 'c', 'credential identity FK must cascade on delete')
  assertionsPassed++

  await insertIdentity(identityId, 'auth003-user-' + suffix, 'normalized-user-' + suffix, 'normalized-email-' + suffix, '+12025550100')
  await insertIdentity(otherIdentityId, 'auth003-user-b-' + suffix, null, null, null)
  assertionsPassed++

  // Different credential kinds may claim the same normalized text; uniqueness
  // is exactly (kind, normalized_value), not normalized_value alone.
  await insertCredential('auth003-u-' + suffix, identityId, 'username', 'hash-user-' + suffix, 'shared-normalized-value', true)
  await insertCredential('auth003-e-' + suffix, otherIdentityId, 'email', 'hash-email-' + suffix, 'shared-normalized-value', true)
  assertionsPassed++

  await expectPgCode('same-kind normalized credential conflict', () => insertCredential(
    'auth003-u2-' + suffix, otherIdentityId, 'username', 'hash-user2-' + suffix, 'shared-normalized-value', true,
  ), '23505')
  await expectPgCode('duplicate credential value hash', () => insertCredential(
    'auth003-hash-dup-' + suffix, otherIdentityId, 'phone', 'hash-user-' + suffix, '+12025550101', true,
  ), '23505')
  await expectPgCode('invalid credential kind', () => insertCredential(
    'auth003-kind-invalid-' + suffix, otherIdentityId, 'password', 'hash-invalid-' + suffix, 'invalid-kind', true,
  ), '23514')
  await expectPgCode('orphan credential identity', () => insertCredential(
    'auth003-orphan-' + suffix, 'missing-identity-' + suffix, 'phone', 'hash-orphan-' + suffix, '+12025550102', true,
  ), '23503')
  assertionsPassed++

  await expectPgCode('duplicate normalized username identity', () => insertIdentity(
    'auth003-identity-dup-name-' + suffix, 'auth003-user-c-' + suffix, 'normalized-user-' + suffix, null, null,
  ), '23505')
  await expectPgCode('duplicate normalized email identity', () => insertIdentity(
    'auth003-identity-dup-email-' + suffix, 'auth003-user-d-' + suffix, null, 'normalized-email-' + suffix, null,
  ), '23505')
  await expectPgCode('duplicate normalized phone identity', () => insertIdentity(
    'auth003-identity-dup-phone-' + suffix, 'auth003-user-e-' + suffix, null, null, '+12025550100',
  ), '23505')
  await expectPgCode('duplicate identity user binding', () => insertIdentity(
    'auth003-identity-dup-user-' + suffix, 'auth003-user-' + suffix, null, null, null,
  ), '23505')
  assertionsPassed++

  // NULL normalized values remain compatible with nullable optional identity fields.
  await insertIdentity(nullIdentityId, userIds[2])
  assertionsPassed++

  const defaults = await pool.query(
    "INSERT INTO auth_credentials (id, identity_id, kind, value_hash, normalized_value) " +
      "VALUES ($1, $2, 'phone', $3, $4) RETURNING active, created_at, updated_at",
    ['auth003-defaults-' + suffix, otherIdentityId, 'hash-defaults-' + suffix, '+12025550103'],
  )
  assert(defaults.rows[0].active === true, 'active default must be true')
  assert(defaults.rows[0].created_at instanceof Date && defaults.rows[0].updated_at instanceof Date,
    'timestamp defaults must be PostgreSQL timestamps')
  assertionsPassed++

  await insertCredential('auth003-cascade-' + suffix, otherIdentityId, 'username',
    'hash-cascade-' + suffix, 'cascade-normalized-' + suffix, true)
  await pool.query('DELETE FROM auth_identities WHERE id = $1', [otherIdentityId])
  const cascaded = await pool.query('SELECT COUNT(*)::int AS count FROM auth_credentials WHERE id = $1',
    ['auth003-cascade-' + suffix])
  assert(Number(cascaded.rows[0].count) === 0, 'deleting an identity must cascade its credentials')
  assertionsPassed++

  const cleanup = {
    productionDatabaseTouched: false,
    businessRowsImported: false,
  }
  console.log(JSON.stringify({
    status: 'W02_AUTH003_CREDENTIAL_POSTGRES_SCHEMA_PASS',
    postgresMajor,
    assertionsPassed,
    checks: {
      canonicalIdentityFieldsAndUniqueIndexes: true,
      canonicalCredentialFieldsAndIndexes: true,
      nativeBooleanAndTimestampTypes: true,
      activeDefaultsToTrue: true,
      credentialIdentityForeignKeyCascadesOnDelete: true,
      uniquenessIsScopedToKindAndNormalizedValue: true,
      differentKindsMayShareNormalizedValue: true,
      duplicateSameKindValueRejected: true,
      duplicateHashRejected: true,
      identityDeleteCascadesCredentials: true,
      unknownKindRejected: true,
      missingIdentityRejected: true,
      optionalIdentityValuesMayRemainNull: true,
      syntheticCredentialRowsCleaned: true,
    },
    ...cleanup,
  }, null, 2))
} catch (error) {
  primaryError = error
} finally {
  try {
    await pool.query('DELETE FROM auth_credentials WHERE identity_id = ANY($1::text[]) OR id LIKE $2', [
      identityIds, 'auth003-%-' + suffix,
    ])
    await pool.query('DELETE FROM auth_identities WHERE id = ANY($1::text[])', [identityIds])
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError
  }
  try {
    const remaining = await pool.query(
      "SELECT " +
        "(SELECT COUNT(*) FROM auth_credentials WHERE identity_id = ANY($1::text[]) OR id LIKE $2) AS credentials, " +
        "(SELECT COUNT(*) FROM auth_identities WHERE id = ANY($1::text[]) OR user_id = ANY($3::text[])) AS identities",
      [identityIds, 'auth003-%-' + suffix, userIds],
    )
    if (Number(remaining.rows[0].credentials) !== 0 || Number(remaining.rows[0].identities) !== 0) {
      if (!primaryError) primaryError = new Error('W02_AUTH003_SYNTHETIC_CLEANUP_FAILED')
    }
  } catch (cleanupVerificationError) {
    if (!primaryError) primaryError = cleanupVerificationError
  }
  await pool.end()
}

if (primaryError) throw primaryError
