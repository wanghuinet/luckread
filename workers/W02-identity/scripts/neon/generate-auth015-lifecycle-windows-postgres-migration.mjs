import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const contractPath = resolve(repositoryRoot, 'contracts/persistence/AUTH-015-account-lifecycle-window-persistence-contract.v1.json')
const changeControlPath = resolve(repositoryRoot, 'docs/change-control/CC-AUTH-015-W02-LIFECYCLE-WINDOW-PERSISTENCE-2026-11-06.md')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0005_auth_015_lifecycle_windows.sql')

const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const changeControl = readFileSync(changeControlPath, 'utf8')
const fail = (message) => { throw new Error('AUTH-015 lifecycle-window contract drift: ' + message) }

if (contract.featureId !== 'AUTH-015' || contract.entityId !== 'ENT-USER') fail('feature/entity authority')
if (contract.authoritativeWriter !== 'W02' || contract.persistenceDomain !== 'D1-01') fail('W02/D1-01 authority')
if (contract.physicalTarget?.table !== 'user' || contract.physicalTarget?.notPayloadCollection !== true) {
  fail('target must be Better Auth user, not Payload users')
}
if (contract.physicalTarget?.tableAuthority !== 'workers/W02-identity/migrations/0005_better_auth_identity_core.sql') {
  fail('Better Auth user table authority')
}
if (
  contract.migration?.migrationId !== 'MIG-AUTH-015-LIFECYCLE-WINDOWS-V1' ||
  contract.migration?.migrationFile !== 'workers/W02-identity/migrations/0011_auth_015_lifecycle_windows.sql'
) fail('migration identity/path')
if (contract.migration?.authorizedScope !== 'existing D1-01 only; additive nullable columns on Better Auth user table') {
  fail('source schema-slice admission')
}
if (contract.migration?.preflight?.noTimestampBackfill !== true ||
    contract.rules?.nullHistoricalTimestampsMustNotBeGuessed !== true ||
    contract.rules?.w02IsSoleLifecycleTimestampWriter !== true ||
    contract.rules?.noPayloadCoreChange !== true ||
    contract.rules?.noClientTimestampAccepted !== true) {
  fail('no-backfill / authority invariants')
}

const expected = [
  {
    fieldId: 'ENT-USER-F-DELETION-REQUESTED-AT',
    canonicalName: 'deletion_requested_at',
    targetTable: 'user',
    targetColumn: 'deletion_requested_at',
    dbType: 'TEXT',
    nullable: true,
    required: false,
    writer: 'W02',
  },
  {
    fieldId: 'ENT-USER-F-DELETED-AT',
    canonicalName: 'deleted_at',
    targetTable: 'user',
    targetColumn: 'deleted_at',
    dbType: 'TEXT',
    nullable: true,
    required: false,
    writer: 'W02',
  },
]
if (contract.fieldMappings?.length !== expected.length) fail('exactly two lifecycle fields required')
for (const item of expected) {
  const actual = contract.fieldMappings.find((field) => field.fieldId === item.fieldId)
  if (!actual) fail('missing field ' + item.fieldId)
  for (const [key, value] of Object.entries(item)) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(value)) {
      fail('field mapping ' + item.fieldId + '.' + key)
    }
  }
}
for (const required of [
  '**Decision:** AUTHORIZED_SCHEMA_SLICE',
  'two nullable timestamp columns',
  'Target table: Better Auth user',
  'There is no backfill',
  'Remote D1 execution status: NOT EXECUTED',
  'No Worker, D1, Queue, Service Binding or Payload Core surface is added.',
]) {
  if (!changeControl.includes(required)) fail('change-control evidence missing: ' + required)
}

const sql = [
  '-- GENERATED FILE',
  '-- Source authority: contracts/persistence/AUTH-015-account-lifecycle-window-persistence-contract.v1.json',
  '-- Change control: docs/change-control/CC-AUTH-015-W02-LIFECYCLE-WINDOW-PERSISTENCE-2026-11-06.md',
  '-- W02 owns these trusted lifecycle timestamps on the Better Auth "user" row.',
  '-- This is a schema-only PostgreSQL baseline slice; production D1 runtime is unchanged.',
  '-- SQLite canonical UTC ISO-8601 TEXT values are represented as TIMESTAMPTZ.',
  '-- No timestamp backfill, inferred history, default, or data mutation is included.',
  '-- Historical migration 0011 includes a D1-only guard; it is not executed on PostgreSQL.',
  '-- Generator: workers/W02-identity/scripts/neon/generate-auth015-lifecycle-windows-postgres-migration.mjs',
  '-- Do not hand-edit. Regenerate from the canonical contract.',
  '',
  'ALTER TABLE "user"',
  '  ADD COLUMN deletion_requested_at TIMESTAMPTZ;',
  '',
  'ALTER TABLE "user"',
  '  ADD COLUMN deleted_at TIMESTAMPTZ;',
  '',
].join('\n')

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, sql)
console.log('W02_AUTH015_LIFECYCLE_WINDOWS_POSTGRES_MIGRATION_GENERATION_PASS')
