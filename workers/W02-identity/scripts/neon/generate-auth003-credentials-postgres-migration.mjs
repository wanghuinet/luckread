import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const identityContractPath = resolve(repositoryRoot, 'contracts/entity/AUTH-003-identity-field-contract.v1.json')
const credentialContractPath = resolve(repositoryRoot, 'contracts/entity/AUTH-003-credential-field-contract.v1.json')
const apiContractPath = resolve(repositoryRoot, 'contracts/api/AUTH-003-credential-management-contract.v1.json')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0003_auth_003_credentials.sql')

const identityContract = JSON.parse(readFileSync(identityContractPath, 'utf8'))
const credentialContract = JSON.parse(readFileSync(credentialContractPath, 'utf8'))
const apiContract = JSON.parse(readFileSync(apiContractPath, 'utf8'))

const assertField = (fields, fieldId, expected) => {
  const field = fields.find((candidate) => candidate.fieldId === fieldId)
  if (!field) throw new Error('AUTH-003 contract field missing: ' + fieldId)
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(field[key]) !== JSON.stringify(value)) {
      throw new Error('AUTH-003 contract field drift: ' + fieldId + '.' + key)
    }
  }
}

if (identityContract.entityId !== 'ENT-IDENTITY' || credentialContract.featureId !== 'AUTH-003') {
  throw new Error('AUTH-003 identity/credential contract authority mismatch')
}
if (credentialContract.entityAuthority?.identityEntityId !== 'ENT-IDENTITY' ||
    credentialContract.entityAuthority?.credentialEntityId !== 'ENT-CREDENTIAL') {
  throw new Error('AUTH-003 entity identity binding drift')
}

const identityFields = identityContract.fields ?? []
for (const [fieldId, expected] of [
  ['ENT-IDENTITY-F-ID', { name: 'id', type: 'text', nullable: false, unique: true, indexed: true }],
  ['ENT-IDENTITY-F-USER-ID', { name: 'userId', type: 'text', nullable: false, unique: true, indexed: true }],
  ['ENT-IDENTITY-F-USERNAME', { name: 'username', type: 'text', nullable: true, unique: false, indexed: false }],
  ['ENT-IDENTITY-F-USERNAME-NORMALIZED', { name: 'usernameNormalized', type: 'text', nullable: true, unique: true, indexed: true }],
  ['ENT-IDENTITY-F-EMAIL', { name: 'email', type: 'text', nullable: true, unique: false, indexed: false }],
  ['ENT-IDENTITY-F-EMAIL-NORMALIZED', { name: 'emailNormalized', type: 'text', nullable: true, unique: true, indexed: true }],
  ['ENT-IDENTITY-F-PHONE', { name: 'phone', type: 'text', nullable: true, unique: false, indexed: false }],
  ['ENT-IDENTITY-F-PHONE-NORMALIZED', { name: 'phoneNormalized', type: 'text', nullable: true, unique: true, indexed: true }],
  ['ENT-IDENTITY-F-NORMALIZATION-VERSION', { name: 'normalizationVersion', type: 'text', nullable: false, unique: false, indexed: false }],
]) assertField(identityFields, fieldId, expected)

const credentialFields = credentialContract.fieldAuthority ?? []
for (const [fieldId, expected] of [
  ['ENT-CREDENTIAL-F-ID', { name: 'id', type: 'text', nullable: false, unique: true, indexed: true }],
  ['ENT-CREDENTIAL-F-IDENTITY-ID', { name: 'identityId', type: 'text', nullable: false, unique: false, indexed: true }],
  ['ENT-CREDENTIAL-F-KIND', { name: 'kind', type: 'enum', nullable: false, unique: false, indexed: true, allowedValues: ['username', 'email', 'phone'] }],
  ['ENT-CREDENTIAL-F-VALUE-HASH', { name: 'valueHash', type: 'text', nullable: false, unique: true, indexed: true }],
  ['ENT-CREDENTIAL-F-NORMALIZED-VALUE', { name: 'normalizedValue', type: 'text', nullable: false, unique: false, indexed: true }],
  ['ENT-CREDENTIAL-F-VERIFIED-AT', { name: 'verifiedAt', type: 'datetime', nullable: true, unique: false, indexed: true }],
  ['ENT-CREDENTIAL-F-ACTIVE', { name: 'active', type: 'boolean', nullable: false, unique: false, indexed: true, defaultValue: true }],
  ['ENT-CREDENTIAL-F-CREATED-AT', { name: 'createdAt', type: 'datetime', nullable: false, unique: false, indexed: true }],
  ['ENT-CREDENTIAL-F-UPDATED-AT', { name: 'updatedAt', type: 'datetime', nullable: false, unique: false, indexed: true }],
]) assertField(credentialFields, fieldId, expected)

const uniqueness = apiContract.uniqueness
if (
  uniqueness?.authority !== 'persistence_boundary' ||
  JSON.stringify(uniqueness.scope) !== JSON.stringify(['kind', 'normalizedValue']) ||
  uniqueness.raceHandling !== 'concurrent_insert_must_resolve_to_single_authoritative_owner'
) {
  throw new Error('AUTH-003 composite credential uniqueness contract drift')
}
if (
  identityContract.rules?.rawPasswordAbsent !== true ||
  identityContract.rules?.rawRecoveryTokenAbsent !== true ||
  identityContract.rules?.rawVerificationTokenAbsent !== true ||
  credentialContract.rules?.credentialMaterialMustNeverBePublic !== true
) {
  throw new Error('AUTH-003 protected-material invariants missing')
}

const sql = [
  '-- GENERATED FILE',
  '-- Source authority: contracts/entity/AUTH-003-identity-field-contract.v1.json',
  '-- Source authority: contracts/entity/AUTH-003-credential-field-contract.v1.json',
  '-- Uniqueness authority: contracts/api/AUTH-003-credential-management-contract.v1.json',
  '-- Target: W02 PostgreSQL schema baseline only; production W02 remains on D1-01.',
  '-- No identities or credentials are backfilled; HMAC value_hash derivation stays in the W02 secret boundary.',
  '-- Generator: workers/W02-identity/scripts/neon/generate-auth003-credentials-postgres-migration.mjs',
  '-- Do not hand-edit. Regenerate from the canonical contracts.',
  '',
  'CREATE TABLE auth_identities (',
  '  id TEXT NOT NULL PRIMARY KEY,',
  '  user_id TEXT NOT NULL CONSTRAINT auth_identities_user_id_uq UNIQUE,',
  '  username TEXT,',
  '  username_normalized TEXT CONSTRAINT auth_identities_username_normalized_uq UNIQUE,',
  '  email TEXT,',
  '  email_normalized TEXT CONSTRAINT auth_identities_email_normalized_uq UNIQUE,',
  '  phone TEXT,',
  '  phone_normalized TEXT CONSTRAINT auth_identities_phone_normalized_uq UNIQUE,',
  '  normalization_version TEXT NOT NULL',
  ');',
  '',
  'CREATE TABLE auth_credentials (',
  '  id TEXT NOT NULL PRIMARY KEY,',
  '  identity_id TEXT NOT NULL,',
  "  kind TEXT NOT NULL CHECK (kind IN ('username', 'email', 'phone')),",
  '  value_hash TEXT NOT NULL CONSTRAINT auth_credentials_value_hash_uq UNIQUE,',
  '  normalized_value TEXT NOT NULL,',
  '  verified_at TIMESTAMPTZ,',
  '  active BOOLEAN NOT NULL DEFAULT TRUE,',
  '  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,',
  '  CONSTRAINT auth_credentials_identity_fk',
  '    FOREIGN KEY (identity_id) REFERENCES auth_identities(id)',
  '    ON UPDATE NO ACTION ON DELETE CASCADE,',
  '  CONSTRAINT auth_credentials_kind_normalized_value_uq UNIQUE (kind, normalized_value)',
  ');',
  '',
  '-- The composite unique constraint supplies the leading kind lookup index.',
  '-- Do not add normalized_value as a separate UNIQUE key: the contract only',
  '-- forbids duplicates within the same kind.',
  'CREATE INDEX auth_credentials_identity_id_idx ON auth_credentials(identity_id);',
  'CREATE INDEX auth_credentials_verified_at_idx ON auth_credentials(verified_at);',
  'CREATE INDEX auth_credentials_active_idx ON auth_credentials(active);',
  'CREATE INDEX auth_credentials_created_at_idx ON auth_credentials(created_at);',
  'CREATE INDEX auth_credentials_updated_at_idx ON auth_credentials(updated_at);',
  '',
].join('\n')

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, sql)
console.log('W02_AUTH003_CREDENTIAL_POSTGRES_MIGRATION_GENERATION_PASS')
