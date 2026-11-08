import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const migrationPath = resolve(workerRoot, 'migrations/0009_auth_007_mfa_operation_receipts.sql')
const sourcePath = resolve(workerRoot, 'src/auth/mfa-audit-receipts.ts')
const migrationContractPath = resolve(repositoryRoot, 'contracts/migration/AUTH-007-mfa-operation-receipt.v1.json')
const eventContractPath = resolve(repositoryRoot, 'contracts/events/AUTH-007-mfa-audit-binding.v1.json')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0010_auth_007_mfa_operation_receipts.sql')

const migration = readFileSync(migrationPath, 'utf8')
const source = readFileSync(sourcePath, 'utf8')
const contract = JSON.parse(readFileSync(migrationContractPath, 'utf8'))
const eventContract = JSON.parse(readFileSync(eventContractPath, 'utf8'))
const fail = (message) => { throw new Error('AUTH-007 MFA operation receipt PostgreSQL schema contract drift: ' + message) }

const expectedPaths = [
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
]
const expectedStatuses = ['STARTED', 'READY', 'EMITTED', 'RESOLVED', 'UNKNOWN']
const expectedColumns = [
  { column: 'receipt_id', dbType: 'TEXT', nullable: false, primaryKey: true },
  { column: 'resource_id', dbType: 'TEXT', nullable: false, authority: 'W02-derived User id' },
  { column: 'operation_path', dbType: 'TEXT', nullable: false, enum: expectedPaths },
  { column: 'is_challenge', dbType: 'INTEGER', nullable: false, enum: [0, 1] },
  { column: 'status', dbType: 'TEXT', nullable: false, enum: expectedStatuses, default: 'STARTED' },
  { column: 'started_at', dbType: 'TEXT', nullable: false },
  { column: 'completed_at', dbType: 'TEXT', nullable: true },
  { column: 'correlation_id', dbType: 'TEXT', nullable: false, maxLength: 128 },
  { column: 'causation_id', dbType: 'TEXT', nullable: false, maxLength: 128 },
  { column: 'event_plan', dbType: 'TEXT', nullable: true, jsonArray: true, secretsForbidden: true },
  { column: 'attempt', dbType: 'INTEGER', nullable: false, minimum: 0, default: 0 },
  { column: 'next_attempt_at', dbType: 'TEXT', nullable: true },
  { column: 'last_error_code', dbType: 'TEXT', nullable: true, maxLength: 128 },
]

if (contract.status !== 'CONTRACTED_NOT_VERIFIED' || contract.promotion !== 'NOT_GREEN' ||
    contract.featureId !== 'AUTH-007' ||
    contract.migrationId !== 'MIG-AUTH-007-MFA-OPERATION-RECEIPTS-V1') {
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
  contract.target?.physicalTable !== 'auth_007_mfa_operation_receipts' ||
  contract.target?.sourceMigration !== 'workers/W02-identity/migrations/0009_auth_007_mfa_operation_receipts.sql' ||
  contract.target?.databaseBinding !== 'workers/W02-identity/wrangler.jsonc:D1_01'
) fail('target table/source migration')
if (JSON.stringify(contract.columns) !== JSON.stringify(expectedColumns)) {
  fail('exact thirteen-column receipt contract')
}
if (
  JSON.stringify(contract.constraints?.statusValues) !== JSON.stringify(expectedStatuses) ||
  JSON.stringify(contract.constraints?.operationPaths) !== JSON.stringify(expectedPaths) ||
  contract.constraints?.eventPlanJsonArray !== true ||
  contract.constraints?.noCredentialsOrSecrets !== true ||
  contract.constraints?.retryableOutboxFailureKeepsReady !== true ||
  contract.constraints?.staleStartedReceiptBecomesUnknown !== true ||
  contract.constraints?.unknownOutcomeIsNeverSynthesized !== true
) fail('receipt status, event plan and unknown-outcome contract')
if (JSON.stringify(contract.indexes) !==
    JSON.stringify(['auth_007_mfa_operation_receipts_status_next_attempt_idx'])) {
  fail('receipt retry index contract')
}
if (
  contract.rules?.receiptIsNotMfaFactorAuthority !== true ||
  contract.rules?.receiptIsNotCanonicalAuditStore !== true ||
  contract.rules?.w02IsAuthoritativeWriter !== true ||
  contract.rules?.w02MustNotWriteD1_03 !== true ||
  contract.rules?.existingAuth013QueueOnly !== true ||
  contract.rules?.noNewWorkerD1QueueOrServiceBinding !== true ||
  contract.rules?.outboxEventInsertsUseStableIdempotencyKeys !== true ||
  contract.rules?.secretsNeverEnterReceipt !== true ||
  contract.rules?.unknownOutcomesRemainVisible !== true
) fail('authority, topology, secret and unknown-outcome invariants')
if (
  contract.remoteExecution?.mode !== 'CONTROLLED_REMOTE_D1' ||
  contract.remoteExecution?.mutation !== 'NOT_EXECUTED'
) fail('this PR must not imply a production D1 migration')

if (
  eventContract.status !== 'CONTRACTED_NOT_VERIFIED' ||
  eventContract.featureId !== 'AUTH-007' ||
  eventContract.authority?.factorAndIdentityAuthority?.worker !== 'W02' ||
  eventContract.authority?.factorAndIdentityAuthority?.database !== 'D1-01' ||
  eventContract.authority?.canonicalAuditEventAuthority?.worker !== 'W06' ||
  eventContract.authority?.canonicalAuditEventAuthority?.database !== 'D1-03' ||
  eventContract.delivery?.mode !== 'EXISTING_TRANSPORT_ONLY' ||
  eventContract.delivery?.existingW02ToW06Binding !== 'AUTH013_QUEUE' ||
  eventContract.delivery?.existingQueueName !== 'luckread-auth013-account-state' ||
  eventContract.delivery?.newWorkerD1QueueOrServiceBindingAllowed !== false
) fail('canonical AUTH-007 event and transport authority')

const sourceTokens = [
  'CREATE TABLE auth_007_mfa_operation_receipts',
  'receipt_id TEXT PRIMARY KEY NOT NULL',
  'resource_id TEXT NOT NULL',
  'is_challenge INTEGER NOT NULL CHECK (is_challenge IN (0, 1))',
  "status TEXT NOT NULL DEFAULT 'STARTED'",
  'started_at TEXT NOT NULL',
  'completed_at TEXT',
  'correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 128)',
  'causation_id TEXT NOT NULL CHECK (length(causation_id) BETWEEN 1 AND 128)',
  'json_valid(event_plan) AND json_type(event_plan) = ',
  'attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0)',
  'last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128)',
  'CREATE INDEX auth_007_mfa_operation_receipts_status_next_attempt_idx',
]
for (const token of sourceTokens) {
  if (!migration.includes(token)) fail('D1 source migration missing ' + token)
}
for (const operationPath of expectedPaths) {
  if (!migration.includes("'" + operationPath + "'") || !source.includes("'" + operationPath + "'")) {
    fail('receipt operation path is missing from migration/runtime: ' + operationPath)
  }
}
for (const status of expectedStatuses) {
  if (!migration.includes("'" + status + "'") || !source.includes("'" + status + "'")) {
    fail('receipt status is missing from migration/runtime: ' + status)
  }
}
if (!source.includes('function parsePlan(value: string | null)') ||
    !source.includes('Array.isArray(parsed)') ||
    !source.includes('JSON.stringify(plan)') ||
    !source.includes("const nextStatus = plan.length > 0 ? 'READY' : 'RESOLVED'") ||
    !source.includes("SET status = ?, attempt = attempt + 1, next_attempt_at = ?") ||
    !source.includes("SET status = ?, last_error_code = ?, next_attempt_at = NULL")) {
  fail('runtime receipt event-plan, retry or stale-UNKNOWN lifecycle source drift')
}

const pathList = expectedPaths.map((value) => "    '" + value + "'").join(',\n')
const statusList = expectedStatuses.map((value) => "    '" + value + "'").join(',\n')
const sql = [
  '-- GENERATED FILE',
  '-- Source authority: workers/W02-identity/migrations/0009_auth_007_mfa_operation_receipts.sql',
  '-- Migration contract: contracts/migration/AUTH-007-mfa-operation-receipt.v1.json',
  '-- Event contract: contracts/events/AUTH-007-mfa-audit-binding.v1.json',
  '-- W02/D1-01 owns secret-free MFA operation receipts; W06/D1-03 owns canonical AuditEvent persistence.',
  '-- Receipts preserve STARTED/READY/EMITTED/RESOLVED/UNKNOWN outcomes; they are not factor or audit authority.',
  '-- READY receipts are reconciled by the existing W02 Cron and existing AUTH013_QUEUE only.',
  '-- SQLite ISO-8601 timestamp TEXT values are represented as PostgreSQL TIMESTAMPTZ.',
  '-- event_plan remains TEXT; PostgreSQL JSONB is used only to require a valid JSON array.',
  '-- No users, factors, secrets, TOTP codes, recovery codes, sessions or event rows are imported.',
  '-- AUTH-007 remains CONTRACTED_NOT_VERIFIED / NOT_GREEN; this is not production deployment or rollout admission.',
  '-- Generator: workers/W02-identity/scripts/neon/generate-auth007-mfa-operation-receipts-postgres-migration.mjs',
  '-- Do not hand-edit. Regenerate from the canonical migration and contracts.',
  '',
  'CREATE TABLE auth_007_mfa_operation_receipts (',
  '  receipt_id TEXT NOT NULL CONSTRAINT auth_007_mfa_operation_receipts_pkey PRIMARY KEY,',
  '  resource_id TEXT NOT NULL,',
  '  operation_path TEXT NOT NULL CHECK (operation_path IN (',
  pathList,
  '  )),',
  '  is_challenge INTEGER NOT NULL CHECK (is_challenge IN (0, 1)),',
  "  status TEXT NOT NULL DEFAULT 'STARTED' CHECK (status IN (",
  statusList,
  '  )),',
  '  started_at TIMESTAMPTZ NOT NULL,',
  '  completed_at TIMESTAMPTZ,',
  '  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 128),',
  '  causation_id TEXT NOT NULL CHECK (length(causation_id) BETWEEN 1 AND 128),',
  "  event_plan TEXT CHECK (event_plan IS NULL OR jsonb_typeof(event_plan::jsonb) = 'array'),",
  '  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),',
  '  next_attempt_at TIMESTAMPTZ,',
  '  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 128)',
  ');',
  '',
  'CREATE INDEX auth_007_mfa_operation_receipts_status_next_attempt_idx',
  '  ON auth_007_mfa_operation_receipts(status, next_attempt_at, started_at);',
  '',
].join('\n')

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, sql)
console.log('W02_AUTH007_MFA_OPERATION_RECEIPTS_POSTGRES_MIGRATION_GENERATION_PASS')
