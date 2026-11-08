import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const migrationPath = resolve(workerRoot, 'migrations/0008_auth_007_mfa_publication_journal.sql')
const sourcePath = resolve(workerRoot, 'src/auth/mfa-audit-events.ts')
const migrationContractPath = resolve(repositoryRoot, 'contracts/migration/AUTH-007-mfa-publication-journal.v1.json')
const eventContractPath = resolve(repositoryRoot, 'contracts/events/AUTH-007-mfa-audit-binding.v1.json')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0009_auth_007_mfa_publication_journal.sql')

const migration = readFileSync(migrationPath, 'utf8')
const source = readFileSync(sourcePath, 'utf8')
const contract = JSON.parse(readFileSync(migrationContractPath, 'utf8'))
const eventContract = JSON.parse(readFileSync(eventContractPath, 'utf8'))
const fail = (message) => { throw new Error('AUTH-007 MFA publication journal PostgreSQL schema contract drift: ' + message) }

const expectedEvents = [
  'auth.mfa.enrollment_started',
  'auth.mfa.enrollment_verified',
  'auth.mfa.enrollment_failed',
  'auth.mfa.challenge_succeeded',
  'auth.mfa.challenge_failed',
  'auth.mfa.factor_disabled',
  'auth.mfa.recovery_codes_rotated',
  'auth.mfa.recovery_code_consumed',
  'auth.mfa.locked',
  'auth.mfa.replay_rejected',
]
const expectedColumns = [
  { column: 'journal_id', dbType: 'TEXT', nullable: false, primaryKey: true },
  { column: 'event_id', dbType: 'TEXT', nullable: false, unique: true },
  { column: 'event_type', dbType: 'TEXT', nullable: false, enum: expectedEvents },
  { column: 'schema_version', dbType: 'TEXT', nullable: false, constant: '1.0' },
  { column: 'resource_id', dbType: 'TEXT', nullable: false, authority: 'W02-derived User id' },
  { column: 'source_version', dbType: 'INTEGER', nullable: false, minimum: 1 },
  { column: 'idempotency_key', dbType: 'TEXT', nullable: false, unique: true },
  { column: 'payload', dbType: 'TEXT', nullable: false, jsonObject: true, secretsForbidden: true },
  { column: 'status', dbType: 'TEXT', nullable: false, enum: ['PENDING', 'PUBLISHED', 'FAILED'], default: 'PENDING' },
  { column: 'attempt', dbType: 'INTEGER', nullable: false, minimum: 1, default: 1 },
  { column: 'next_attempt_at', dbType: 'TEXT', nullable: true },
  { column: 'created_at', dbType: 'TEXT', nullable: false },
  { column: 'published_at', dbType: 'TEXT', nullable: true },
  { column: 'last_error_code', dbType: 'TEXT', nullable: true, maxLength: 128 },
]

if (contract.status !== 'CONTRACTED_NOT_VERIFIED' || contract.promotion !== 'NOT_GREEN' ||
    contract.featureId !== 'AUTH-007' ||
    contract.migrationId !== 'MIG-AUTH-007-MFA-PUBLICATION-JOURNAL-V1') {
  fail('AUTH-007 must remain CONTRACTED_NOT_VERIFIED / NOT_GREEN')
}
if (
  contract.authority?.worker !== 'W02' ||
  contract.authority?.domain !== 'D1-01' ||
  contract.authority?.businessAuthority !== 'W02' ||
  contract.authority?.finalAuditAuthority !== 'W06' ||
  contract.authority?.eventContract !== 'contracts/events/AUTH-007-mfa-audit-binding.v1.json'
) fail('W02 / D1-01 and W06 final audit authority')
if (
  contract.target?.physicalTable !== 'auth_007_mfa_publication_journal' ||
  contract.target?.sourceMigration !== 'workers/W02-identity/migrations/0008_auth_007_mfa_publication_journal.sql' ||
  contract.target?.databaseBinding !== 'workers/W02-identity/wrangler.jsonc:D1_01'
) fail('target table/source migration')
if (JSON.stringify(contract.columns) !== JSON.stringify(expectedColumns)) {
  fail('exact fourteen-column contract')
}
if (
  contract.constraints?.eventIdUnique !== true ||
  contract.constraints?.idempotencyKeyUnique !== true ||
  JSON.stringify(contract.constraints?.statusValues) !== JSON.stringify(['PENDING', 'PUBLISHED', 'FAILED']) ||
  contract.constraints?.schemaVersion !== '1.0' ||
  JSON.stringify(contract.constraints?.eventTypes) !== JSON.stringify(expectedEvents) ||
  contract.constraints?.payloadJsonObject !== true ||
  contract.constraints?.retryableQueueFailureKeepsPending !== true ||
  contract.constraints?.malformedPayloadBecomesFailed !== true
) fail('journal constraints and retry contract')
if (JSON.stringify(contract.indexes) !==
    JSON.stringify(['auth_007_mfa_publication_journal_status_next_attempt_idx'])) {
  fail('retry index contract')
}
if (
  contract.rules?.journalIsNotMfaFactorAuthority !== true ||
  contract.rules?.journalIsNotCanonicalAuditStore !== true ||
  contract.rules?.w02IsAuthoritativeWriter !== true ||
  contract.rules?.w02MustNotWriteD1_03 !== true ||
  contract.rules?.existingAuth013QueueOnly !== true ||
  contract.rules?.noNewWorkerD1QueueOrServiceBinding !== true ||
  contract.rules?.eventIdRetainedAcrossDeliveryRetries !== true ||
  contract.rules?.consumerDeduplicationRemainsW06Responsibility !== true ||
  contract.rules?.secretsNeverEnterPayload !== true
) fail('authority, topology, retry and secret invariants')
if (
  contract.remoteExecution?.mode !== 'CONTROLLED_REMOTE_D1' ||
  contract.remoteExecution?.mutation !== 'NOT_EXECUTED'
) fail('this PR must not imply a production D1 migration')

if (
  eventContract.status !== 'CONTRACTED_NOT_VERIFIED' ||
  eventContract.featureId !== 'AUTH-007' ||
  JSON.stringify(eventContract.events?.map((event) => event.name)) !== JSON.stringify(expectedEvents) ||
  eventContract.events?.some((event) => event.targetType !== 'User') ||
  eventContract.authority?.factorAndIdentityAuthority?.worker !== 'W02' ||
  eventContract.authority?.factorAndIdentityAuthority?.database !== 'D1-01' ||
  eventContract.authority?.canonicalAuditEventAuthority?.worker !== 'W06' ||
  eventContract.authority?.canonicalAuditEventAuthority?.database !== 'D1-03' ||
  eventContract.delivery?.mode !== 'EXISTING_TRANSPORT_ONLY' ||
  eventContract.delivery?.existingW02ToW06Binding !== 'AUTH013_QUEUE' ||
  eventContract.delivery?.existingQueueName !== 'luckread-auth013-account-state' ||
  eventContract.delivery?.newWorkerD1QueueOrServiceBindingAllowed !== false ||
  JSON.stringify(eventContract.payloadPolicy?.allowedFields) !==
    JSON.stringify(['operationId', 'result', 'reasonCode', 'factorState', 'challengeMethod']) ||
  eventContract.payloadPolicy?.actorAndTargetMustBeServerDerived !== true ||
  eventContract.payloadPolicy?.noClientSuppliedAssurance !== true
) fail('canonical event authority and queue contract')

const sourceEvents = expectedEvents.map((eventName) =>
  source.includes("'" + eventName + "'"),
)
if (sourceEvents.some((present) => !present)) fail('W02 source producer must register all ten event names')
if (!Array.isArray(eventContract.payloadPolicy?.secretFieldsForbidden) ||
    !eventContract.payloadPolicy.secretFieldsForbidden.includes('secret') ||
    !eventContract.payloadPolicy.secretFieldsForbidden.includes('totpUri') ||
    !eventContract.payloadPolicy.secretFieldsForbidden.includes('code') ||
    !eventContract.payloadPolicy.secretFieldsForbidden.includes('backupCodes') ||
    !eventContract.payloadPolicy.secretFieldsForbidden.includes('sessionToken') ||
    !eventContract.payloadPolicy.secretFieldsForbidden.includes('cookie') ||
    !eventContract.payloadPolicy.secretFieldsForbidden.includes('lastAcceptedTotpTimeStep')) {
  fail('canonical event secret-field deny list')
}

const sourceTokens = [
  'CREATE TABLE auth_007_mfa_publication_journal',
  'journal_id TEXT PRIMARY KEY NOT NULL',
  'event_id TEXT NOT NULL UNIQUE',
  "schema_version TEXT NOT NULL CHECK (schema_version = '1.0')",
  'source_version INTEGER NOT NULL CHECK (source_version >= 1)',
  'idempotency_key TEXT NOT NULL UNIQUE',
  'json_valid(payload) AND json_type(payload) = ',
  "status TEXT NOT NULL DEFAULT 'PENDING'",
  "attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1)",
  'created_at TEXT NOT NULL',
  'last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128)',
  'CREATE INDEX auth_007_mfa_publication_journal_status_next_attempt_idx',
]
for (const token of sourceTokens) {
  if (!migration.includes(token)) fail('D1 source migration missing ' + token)
}
for (const eventName of expectedEvents) {
  if (!migration.includes("'" + eventName + "'")) fail('D1 source migration missing event type ' + eventName)
}

const eventList = expectedEvents.map((value) => "'" + value + "'").join(',\n    ')
const sql = [
  '-- GENERATED FILE',
  '-- Source authority: workers/W02-identity/migrations/0008_auth_007_mfa_publication_journal.sql',
  '-- Migration contract: contracts/migration/AUTH-007-mfa-publication-journal.v1.json',
  '-- Event contract: contracts/events/AUTH-007-mfa-audit-binding.v1.json',
  '-- W02/D1-01 owns the durable MFA audit publication intent; W06/D1-03 owns canonical AuditEvent persistence.',
  '-- This journal is not an MFA factor authority or the final audit store.',
  '-- Delivery uses only the existing AUTH013_QUEUE / luckread-auth013-account-state transport.',
  '-- SQLite ISO-8601 timestamp TEXT values are represented as PostgreSQL TIMESTAMPTZ.',
  '-- Payload remains TEXT; PostgreSQL JSONB is used only to require a valid JSON object.',
  '-- No users, factors, secrets, TOTP codes, recovery codes, sessions or audit events are imported.',
  '-- AUTH-007 remains CONTRACTED_NOT_VERIFIED / NOT_GREEN; this is not production deployment or rollout admission.',
  '-- Generator: workers/W02-identity/scripts/neon/generate-auth007-mfa-publication-journal-postgres-migration.mjs',
  '-- Do not hand-edit. Regenerate from the canonical migration and contracts.',
  '',
  'CREATE TABLE auth_007_mfa_publication_journal (',
  '  journal_id TEXT NOT NULL CONSTRAINT auth_007_mfa_publication_journal_pkey PRIMARY KEY,',
  '  event_id TEXT NOT NULL CONSTRAINT auth_007_mfa_publication_journal_event_id_uq UNIQUE,',
  '  event_type TEXT NOT NULL CHECK (event_type IN (',
  '    ' + eventList.split('\n').join('\n    '),
  '  )),',
  "  schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),",
  '  resource_id TEXT NOT NULL,',
  '  source_version INTEGER NOT NULL CHECK (source_version >= 1),',
  '  idempotency_key TEXT NOT NULL CONSTRAINT auth_007_mfa_publication_journal_idempotency_key_uq UNIQUE,',
  "  payload TEXT NOT NULL CHECK (jsonb_typeof(payload::jsonb) = 'object'),",
  "  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),",
  '  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),',
  '  next_attempt_at TIMESTAMPTZ,',
  '  created_at TIMESTAMPTZ NOT NULL,',
  '  published_at TIMESTAMPTZ,',
  '  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128)',
  ');',
  '',
  'CREATE INDEX auth_007_mfa_publication_journal_status_next_attempt_idx',
  '  ON auth_007_mfa_publication_journal(status, next_attempt_at);',
  '',
].join('\n')

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, sql)
console.log('W02_AUTH007_MFA_PUBLICATION_JOURNAL_POSTGRES_MIGRATION_GENERATION_PASS')
