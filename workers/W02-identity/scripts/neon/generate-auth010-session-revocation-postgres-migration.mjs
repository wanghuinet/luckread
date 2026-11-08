import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const migrationContractPath = resolve(repositoryRoot, 'contracts/migration/AUTH-010-session-revocation-journal.v1.json')
const eventContractPath = resolve(repositoryRoot, 'contracts/events/AUTH-010-session-revoked-binding.v1.json')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0006_auth_010_session_revocation_journal.sql')

const migrationContract = JSON.parse(readFileSync(migrationContractPath, 'utf8'))
const eventContract = JSON.parse(readFileSync(eventContractPath, 'utf8'))
const fail = (message) => { throw new Error('AUTH-010 session revocation journal contract drift: ' + message) }

const expectedColumns = [
  'journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id',
  'source_version', 'idempotency_key', 'payload', 'status', 'attempt',
  'next_attempt_at', 'created_at', 'published_at', 'last_error_code',
]

if (migrationContract.status !== 'CONTRACTED_PARTIAL') fail('contract must remain partial until production evidence is admitted')
if (
  migrationContract.authority?.worker !== 'W02' ||
  migrationContract.authority?.database !== 'D1-01' ||
  migrationContract.authority?.table !== 'auth_010_session_revocation_journal'
) fail('W02 / D1-01 / journal table authority')
if (
  migrationContract.migration?.file !== 'workers/W02-identity/migrations/0012_auth_010_session_revocation_journal.sql' ||
  migrationContract.migration?.number !== '0012'
) fail('source migration identity/path')
if (
  migrationContract.purpose !== 'Persist the immutable user.session.revoked publication intent in the same D1 transaction that removes a caller-owned Better Auth session.'
) fail('journal purpose')
if (JSON.stringify(migrationContract.requiredColumns) !== JSON.stringify(expectedColumns)) {
  fail('exact fourteen-column contract and order')
}
for (const required of [
  'event_id is unique',
  'idempotency_key is unique',
  'one user.session.revoked event per Session resource_id',
  'payload must be valid JSON object',
  'status is PENDING, PUBLISHED or FAILED',
  'source_version equals 1',
]) {
  if (!migrationContract.constraints?.includes(required)) fail('required database invariant: ' + required)
}
if (JSON.stringify(migrationContract.indexes) !== JSON.stringify([
  'auth_010_session_revocation_journal_status_next_attempt_idx',
])) fail('retry index authority')
if (!migrationContract.nonGoals?.some((item) => item.includes('No production D1 migration'))) {
  fail('source schema migration must not imply a production D1 migration')
}

const event = eventContract.properties ?? {}
const delivery = eventContract['x-luckread']?.delivery ?? {}
const payloadPolicy = eventContract['x-luckread']?.payloadPolicy ?? {}
if (
  eventContract['x-luckread']?.canonical !== true ||
  eventContract['x-luckread']?.producerAuthority !== 'W02' ||
  eventContract['x-luckread']?.sourceAuthority !== 'D1-01 Better Auth session' ||
  eventContract['x-luckread']?.auditAuthority !== 'W06 D1-03 AuditEvent' ||
  event.eventId?.pattern !== '^evt_[a-f0-9]{32}$' ||
  event.eventType?.const !== 'user.session.revoked' ||
  event.schemaVersion?.const !== '1.0' ||
  event.producer?.const !== 'W02' ||
  event.resourceType?.const !== 'Session' ||
  event.sourceVersion?.const !== 1 ||
  event.attempt?.const !== 1
) fail('canonical session-revoked event constants/schema')
if (
  delivery.mode !== 'AT_LEAST_ONCE' ||
  delivery.existingQueueBinding !== 'AUTH013_QUEUE' ||
  delivery.existingQueueName !== 'luckread-auth013-account-state' ||
  delivery.outbox !== 'W02 D1-01 auth_010_session_revocation_journal' ||
  delivery.deduplication !== 'eventId' ||
  delivery.newWorkerD1QueueOrServiceBindingAllowed !== false
) fail('existing W02/W06 delivery topology')
if (
  payloadPolicy.sessionId !== 'Only in resourceId; never include the native session token.' ||
  !Array.isArray(payloadPolicy.secretFieldsForbidden) ||
  !payloadPolicy.secretFieldsForbidden.includes('sessionToken') ||
  !payloadPolicy.secretFieldsForbidden.includes('cookie') ||
  !payloadPolicy.secretFieldsForbidden.includes('deviceFingerprint') ||
  !payloadPolicy.secretFieldsForbidden.includes('ipAddress') ||
  !payloadPolicy.secretFieldsForbidden.includes('userAgent')
) fail('secret-free event payload policy')
if (
  event.actor?.properties?.actorType?.const !== 'user' ||
  JSON.stringify(event.payload?.required) !== JSON.stringify(['operationId', 'result', 'reasonCode']) ||
  JSON.stringify(Object.keys(event.payload?.properties ?? {}).sort()) !==
    JSON.stringify(['operationId', 'reasonCode', 'result'])
) fail('canonical actor and payload shape')

const sql = [
  '-- GENERATED FILE',
  '-- Source authority: contracts/migration/AUTH-010-session-revocation-journal.v1.json',
  '-- Event authority: contracts/events/AUTH-010-session-revoked-binding.v1.json',
  '-- W02 owns the durable session-revocation outbox; W06 owns AuditEvent persistence.',
  '-- Better Auth "session" remains the sole session-state authority. This is not a Session table.',
  '-- No production D1 migration/deployment, user data, session data, or audit event is included.',
  '-- SQLite ISO-8601 timestamp TEXT fields are represented as PostgreSQL TIMESTAMPTZ.',
  '-- Payload remains TEXT; PostgreSQL JSONB is used only to enforce valid JSON object shape.',
  '-- Generator: workers/W02-identity/scripts/neon/generate-auth010-session-revocation-postgres-migration.mjs',
  '-- Do not hand-edit. Regenerate from the canonical contracts.',
  '',
  'CREATE TABLE auth_010_session_revocation_journal (',
  '  journal_id TEXT NOT NULL CONSTRAINT auth_010_session_revocation_journal_pkey PRIMARY KEY,',
  '  event_id TEXT NOT NULL CONSTRAINT auth_010_session_revocation_journal_event_id_uq UNIQUE,',
  "  event_type TEXT NOT NULL CHECK (event_type = 'user.session.revoked'),",
  "  schema_version TEXT NOT NULL CHECK (schema_version = '1.0'),",
  '  resource_id TEXT NOT NULL,',
  '  source_version INTEGER NOT NULL CHECK (source_version = 1),',
  '  idempotency_key TEXT NOT NULL CONSTRAINT auth_010_session_revocation_journal_idempotency_key_uq UNIQUE,',
  "  payload TEXT NOT NULL CHECK (jsonb_typeof(payload::jsonb) = 'object'),",
  "  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),",
  '  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),',
  '  next_attempt_at TIMESTAMPTZ,',
  '  created_at TIMESTAMPTZ NOT NULL,',
  '  published_at TIMESTAMPTZ,',
  '  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128),',
  '  CONSTRAINT auth_010_session_revocation_journal_resource_event_uq UNIQUE (resource_id, event_type)',
  ');',
  '',
  'CREATE INDEX auth_010_session_revocation_journal_status_next_attempt_idx',
  '  ON auth_010_session_revocation_journal(status, next_attempt_at);',
  '',
].join('\n')

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, sql)
console.log('W02_AUTH010_SESSION_REVOCATION_POSTGRES_MIGRATION_GENERATION_PASS')
