import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0001_w08_d1_01_creator_authorization.sql')
const templatePath = resolve(scriptDirectory, 'templates/d1-01-creator-postgres.sql')
const migrationPath = resolve(workerRoot, 'migrations/0001_creator_authorization.sql')
const inventoryPath = resolve(repositoryRoot, 'contracts/database/neon-d1-01-schema-sources.v1.json')
const bootstrapPath = resolve(repositoryRoot, 'contracts/database/neon-five-domain-schema-bootstrap.v1.json')
const boundaryPath = resolve(repositoryRoot, 'docs/change-control/CC-W02-W08-AUTHORIZATION-BOUNDARY-2026-10-12.md')

const fail = (message) => {
  throw new Error('W08 D1-01 PostgreSQL schema contract drift: ' + message)
}
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const inventory = readJson(inventoryPath)
const bootstrap = readJson(bootstrapPath)
const target = inventory.target
const owner = inventory.owners?.find((item) => item.worker === 'W08')
const domain = bootstrap.domains?.find((item) => item.domainId === 'D1-01')
const boundary = readFileSync(boundaryPath, 'utf8')
const source = readFileSync(migrationPath, 'utf8')
const sql = readFileSync(templatePath, 'utf8')

if (
  target?.domainId !== 'D1-01' ||
  target?.databaseName !== 'luckread' ||
  target?.postgresMajor !== 18 ||
  target?.businessDataImport !== false
) {
  fail('target must remain empty-schema D1-01 / luckread / PostgreSQL 18')
}
if (
  owner?.role !== 'Creator application and creator identity facts; RoleAssignment remains W02-owned' ||
  owner?.schemaMode !== 'Port the D1-01 creator authorization migration to PostgreSQL; preserve W02 role authority.' ||
  JSON.stringify(owner?.sqlMigrations) !== JSON.stringify(['0001_creator_authorization.sql'])
) {
  fail('W08 schema owner/source inventory drift')
}
if (
  !domain ||
  domain.databaseName !== 'luckread' ||
  !domain.owners?.includes('W08') ||
  !domain.schemaSources?.includes('workers/W08-creator/migrations')
) {
  fail('W08 must remain one of the D1-01 owners in the five-domain bootstrap contract')
}
if (
  bootstrap.authorization?.productionCutoverAuthorized !== false ||
  bootstrap.authorization?.businessDataImportAuthorized !== false ||
  bootstrap.authorization?.schemaOnlyInitializationAuthorized !== true ||
  bootstrap.architecture?.productionAuthorityDuringBootstrap !== 'Cloudflare D1' ||
  bootstrap.architecture?.newWorkers !== 0 ||
  bootstrap.architecture?.newQueues !== 0 ||
  bootstrap.architecture?.newServiceBindings !== 0
) {
  fail('five-domain schema-only bootstrap authorization/architecture drift')
}
if (
  !boundary.includes('W02 = Identity / Account') ||
  !boundary.includes('RoleAssignment grant transport remain authoritative and unchanged') ||
  !boundary.includes('W08 = Authorization / Creator / Organization')
) {
  fail('W02/W08 identity and RoleAssignment boundary contract drift')
}

const sourceTables = [
  ['creator_applications', [
    'application_id', 'user_id', 'creator_type', 'statement', 'status',
    'grant_state', 'version', 'application_idempotency_key',
    'decision_idempotency_key', 'decided_by', 'decision_reason',
    'created_at', 'updated_at', 'decided_at',
  ]],
  ['creators', [
    'creator_id', 'user_id', 'application_id', 'creator_type',
    'status', 'version', 'created_at', 'updated_at',
  ]],
  ['creator_authorization_audit', [
    'audit_id', 'event_key', 'actor_id', 'subject_id', 'event_type',
    'resource_type', 'resource_id', 'from_state', 'to_state',
    'idempotency_key', 'correlation_id', 'occurred_at', 'details_json',
  ]],
]
for (const [tableName, columns] of sourceTables) {
  if (!new RegExp('CREATE TABLE IF NOT EXISTS\\s+' + tableName + '\\b', 'i').test(source)) {
    fail('canonical W08 D1 migration is missing table ' + tableName)
  }
  for (const columnName of columns) {
    if (!new RegExp('\\b' + columnName + '\\b').test(source)) {
      fail('canonical W08 D1 migration is missing field ' + tableName + '.' + columnName)
    }
    if (!new RegExp('\\b' + columnName + '\\b').test(sql)) {
      fail('PostgreSQL DDL is missing field ' + tableName + '.' + columnName)
    }
  }
  if (!new RegExp('CREATE TABLE\\s+' + tableName + '\\b', 'i').test(sql)) {
    fail('PostgreSQL DDL is missing table ' + tableName)
  }
}

const sourceIndexNames = [
  'creator_applications_one_pending_per_user',
  'creator_applications_status_created_idx',
  'creators_status_idx',
  'creator_authorization_audit_subject_time_idx',
  'creator_authorization_audit_resource_time_idx',
]
for (const indexName of sourceIndexNames) {
  if (!source.includes(indexName) || !sql.includes(indexName)) {
    fail('W08 source-defined index missing from PostgreSQL DDL: ' + indexName)
  }
}
const normalizeSql = (value) => value.replace(/\s+/g, '')
for (const token of [
  "('PERSONAL','WRITER','VIDEO_CREATOR','DEVELOPER','ARTIST','OTHER')",
  "('PENDING','APPROVED','REJECTED')",
  "('NOT_REQUESTED','PENDING','GRANTED')",
  "('PENDING_ROLE_GRANT','ACTIVE','REVOKED')",
  "'CREATOR_APPLICATION_SUBMITTED'",
  "'CREATOR_APPLICATION_APPROVED'",
  "'CREATOR_APPLICATION_REJECTED'",
  "'CREATOR_ROLE_GRANTED'",
  "'creator_application'",
  "'creator'",
  "'role_assignment'",
]) {
  if (!normalizeSql(source).includes(normalizeSql(token)) ||
      !normalizeSql(sql).includes(normalizeSql(token))) {
    fail('PostgreSQL enum/event/resource vocabulary differs from the canonical source: ' + token)
  }
}
for (const token of [
  'CREATE TABLE creator_applications',
  'CREATE TABLE creators',
  'CREATE TABLE creator_authorization_audit',
  'CREATE UNIQUE INDEX creator_applications_one_pending_per_user',
  'CREATE INDEX creator_applications_status_created_idx',
  'CREATE INDEX creators_status_idx',
  'CREATE INDEX creator_authorization_audit_subject_time_idx',
  'CREATE INDEX creator_authorization_audit_resource_time_idx',
  'UNIQUE (user_id, application_idempotency_key)',
  'user_id TEXT NOT NULL UNIQUE',
  'application_id TEXT NOT NULL UNIQUE',
  'event_key TEXT NOT NULL UNIQUE',
  'details_json TEXT NOT NULL DEFAULT',
  'BEGIN;',
  'COMMIT;',
]) {
  if (!sql.includes(token)) fail('PostgreSQL DDL is missing required source rule: ' + token)
}
if ((sql.match(/CREATE TABLE\s+/gi) ?? []).length !== 3) {
  fail('W08 PostgreSQL migration must create exactly three owner tables')
}
if ((sql.match(/CREATE (?:UNIQUE )?INDEX\s+/gi) ?? []).length !== 5) {
  fail('W08 PostgreSQL migration must preserve exactly five explicit source indexes')
}
const ddlStatements = sql.replace(/^\s*--.*$/gm, '')
if (/\bFOREIGN\s+KEY\b|\bREFERENCES\b/i.test(ddlStatements)) {
  fail('W08 must not introduce cross-domain or undocumented foreign keys')
}
if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(?:role_assignments?|users?|membership_subscriptions|orders?|payments?|refunds?)\b/i.test(sql)) {
  fail('W08 DDL must not copy W02 identity/RoleAssignment, W07 subscription or D1-04 financial tables')
}
const createdTableNames = [...sql.matchAll(/^CREATE TABLE\s+([a-z_][a-z0-9_]*)/gim)]
  .map((match) => match[1])
  .sort()
if (JSON.stringify(createdTableNames) !== JSON.stringify([
  'creator_applications',
  'creator_authorization_audit',
  'creators',
].sort())) {
  fail('W08 schema must contain exactly the three Creator-owned D1-01 tables')
}
if (/PRAGMA|AUTOINCREMENT|strftime|julianday|GLOB|typeof\s*\(|RAISE\s*\(\s*ABORT/i.test(sql)) {
  fail('PostgreSQL migration contains SQLite-only syntax')
}
if (/JSONB|jsonb_/i.test(sql)) {
  fail('details_json must retain the source TEXT representation without added JSON semantics')
}
const expectedTimestampColumns = [
  'created_at', 'updated_at', 'decided_at', 'occurred_at',
]
for (const columnName of expectedTimestampColumns) {
  if (!new RegExp('\\b' + columnName + '\\s+TIMESTAMPTZ\\b').test(sql)) {
    fail('D1 UTC timestamp column must map to PostgreSQL TIMESTAMPTZ: ' + columnName)
  }
}

const generatedHeader = [
  '-- GENERATED FILE. Do not hand-edit.',
  '-- Regenerate with scripts/neon/generate-d1-01-creator-postgres-migration.mjs.',
  '-- See scripts/neon/templates/d1-01-creator-postgres.sql for the checked schema template.',
  '-- Source of truth remains migrations/0001_creator_authorization.sql and the D1-01 owner inventory.',
  '-- This file is schema-only; runtime remains on Cloudflare D1 pending a separate cutover gate.',
  '',
].join('\n')
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, generatedHeader + '\n' + sql)
console.log('W08_D1_01_CREATOR_POSTGRES_MIGRATION_GENERATION_PASS')
