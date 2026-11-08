import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const repositoryRoot = resolve(workerRoot, '../..')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0001_w07_d1_01_membership_schema.sql')
const templatePath = resolve(scriptDirectory, 'templates/d1-01-membership-postgres.sql')
const persistencePath = resolve(repositoryRoot, 'contracts/persistence/SUBSCRIPTION-D1-01-persistence.v1.json')
const entityPath = resolve(repositoryRoot, 'contracts/entity/SUBSCRIPTION-ENTITY-CONTRACT.v1.json')
const bootstrapPath = resolve(repositoryRoot, 'contracts/database/neon-five-domain-schema-bootstrap.v1.json')
const inventoryPath = resolve(repositoryRoot, 'contracts/database/neon-d1-01-schema-sources.v1.json')

const fail = (message) => {
  throw new Error('W07 D1-01 PostgreSQL schema contract drift: ' + message)
}
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const persistence = readJson(persistencePath)
const entity = readJson(entityPath)
const bootstrap = readJson(bootstrapPath)
const inventory = readJson(inventoryPath)

if (persistence.status !== 'CONTRACTED_NOT_VERIFIED' ||
    persistence.authority?.domainId !== 'D1-01' ||
    persistence.authority?.primaryWorker !== 'W07' ||
    persistence.authority?.databaseUuid !== '2f80471e-3756-49f9-8db1-7707a433ad64') {
  fail('Subscription persistence authority must remain W07 / D1-01')
}
if (entity.status !== 'CONTRACTED_NOT_VERIFIED' ||
    entity.entityId !== 'ENT-SUBSCRIPTION' ||
    entity.authority?.domainId !== 'D1-01' ||
    entity.authority?.primaryWorker !== 'W07') {
  fail('ENT-SUBSCRIPTION authority/status drift')
}
if (persistence.uniqueness?.activeSubscriptionKey !== 'NOT_YET_FIXED' ||
    persistence.uniqueness?.status !== 'DECISION_REQUIRED') {
  fail('active-subscription uniqueness must remain an explicit unresolved decision')
}
if (!Array.isArray(persistence.table?.columns) ||
    persistence.table.columns.length !== 17 ||
    persistence.table.columns.some((column) => column.type !== 'TEXT' && column.type !== 'INTEGER')) {
  fail('the logical Subscription contract must retain its exact seventeen fields')
}
const expectedSubscriptionColumns = [
  'subscription_id', 'subscriber_id', 'version', 'plan_id', 'plan_version',
  'creator_id', 'status', 'started_at', 'current_period_start', 'current_period_end',
  'trial_started_at', 'trial_ends_at', 'trial_converted_at', 'cancel_at',
  'entitlement_snapshot_ref', 'created_at', 'updated_at',
].sort()
if (JSON.stringify(persistence.table.columns.map((column) => column.name).sort()) !==
    JSON.stringify(expectedSubscriptionColumns)) {
  fail('Subscription seventeen-column field mapping drift')
}
const expectedAdditionalTables = [
  'membership_subscription_plan_change_attempts',
  'membership_subscription_scheduled_plan_changes',
]
if (JSON.stringify((persistence.additionalTables ?? []).map((table) => table.name).sort()) !==
    JSON.stringify(expectedAdditionalTables.sort())) {
  fail('upgrade-attempt and scheduled-plan-change tables must both remain in scope')
}
if (bootstrap.authorization?.productionCutoverAuthorized !== false ||
    bootstrap.authorization?.businessDataImportAuthorized !== false ||
    bootstrap.authorization?.schemaOnlyInitializationAuthorized !== true ||
    bootstrap.architecture?.productionAuthorityDuringBootstrap !== 'Cloudflare D1' ||
    bootstrap.architecture?.newWorkers !== 0 ||
    bootstrap.architecture?.newQueues !== 0 ||
    bootstrap.architecture?.newServiceBindings !== 0) {
  fail('five-domain schema-only bootstrap authorization drift')
}
const w07Source = inventory.owners?.find((owner) => owner.worker === 'W07')
if (w07Source?.schemaMode !== 'Port the D1-01 migration set to PostgreSQL; payment/order/financial facts remain in D1-04 and are not part of this domain bootstrap.') {
  fail('W07 D1-01 / D1-04 authority split drift')
}
const sourceMigrations = [
  ['0001_membership_subscriptions.sql', 'CREATE TABLE IF NOT EXISTS membership_subscriptions'],
  ['0002_subscription_version_cas.sql', 'ADD COLUMN version INTEGER NOT NULL DEFAULT 1'],
  ['0003_membership_plans.sql', 'CREATE TABLE IF NOT EXISTS membership_plans'],
  ['0004_revenuecat_membership_product_bindings.sql', 'CREATE TABLE IF NOT EXISTS membership_revenuecat_product_bindings'],
  ['0005_membership_subscription_plan_change_attempts.sql', 'CREATE TABLE IF NOT EXISTS membership_subscription_plan_change_attempts'],
  ['0006_membership_subscription_scheduled_plan_changes.sql', 'CREATE TABLE IF NOT EXISTS membership_subscription_scheduled_plan_changes'],
  ['0007_scheduled_plan_change_type.sql', "DEFAULT 'DOWNGRADE'"],
  ['0008_subscription_trial_lifecycle.sql', 'trial_converted_at'],
]
for (const [name, token] of sourceMigrations) {
  const sourcePath = resolve(workerRoot, 'migrations', name)
  const sourceText = readFileSync(sourcePath, 'utf8')
  if (!sourceText.includes(token)) fail('canonical source migration drift: ' + name)
}
const sourcePlans = readFileSync(resolve(workerRoot, 'migrations/0003_membership_plans.sql'), 'utf8')
for (const trigger of [
  'membership_plan_versions_immutable_update',
  'membership_plan_versions_immutable_delete',
  'membership_plans_owner_immutable_update',
  'membership_plans_current_version_forward_only',
]) {
  if (!sourcePlans.includes(trigger)) fail('canonical plan immutability trigger missing: ' + trigger)
}
const sourceBindings = readFileSync(resolve(workerRoot, 'migrations/0004_revenuecat_membership_product_bindings.sql'), 'utf8')
for (const trigger of [
  'membership_revenuecat_bindings_immutable_update',
  'membership_revenuecat_bindings_immutable_delete',
]) {
  if (!sourceBindings.includes(trigger)) fail('canonical RevenueCat trigger missing: ' + trigger)
}
const sourceTrials = readFileSync(resolve(workerRoot, 'migrations/0008_subscription_trial_lifecycle.sql'), 'utf8')
for (const trigger of [
  'membership_subscriptions_trial_window_immutable',
  'membership_subscriptions_trial_conversion_write_once',
]) {
  if (!sourceTrials.includes(trigger)) fail('canonical trial trigger missing: ' + trigger)
}

const sql = readFileSync(templatePath, 'utf8')
const requiredSqlTokens = [
  'BEGIN;',
  'COMMIT;',
  'CREATE TABLE membership_subscriptions',
  'CREATE TABLE membership_plans',
  'CREATE TABLE membership_plan_versions',
  'CREATE TABLE membership_revenuecat_product_bindings',
  'CREATE TABLE membership_subscription_plan_change_attempts',
  'CREATE TABLE membership_subscription_scheduled_plan_changes',
  'CREATE UNIQUE INDEX ux_membership_subscriptions_trial_per_subscriber_creator',
  'CREATE UNIQUE INDEX ux_membership_plan_change_attempts_idempotency',
  'CREATE UNIQUE INDEX ux_membership_plan_change_attempts_pending_subscription',
  'CREATE UNIQUE INDEX ux_membership_scheduled_plan_changes_idempotency',
  'CREATE UNIQUE INDEX ux_membership_scheduled_plan_changes_pending_subscription',
  'CREATE TRIGGER membership_plan_versions_immutable_update',
  'CREATE TRIGGER membership_plans_current_version_forward_only',
  'CREATE TRIGGER membership_revenuecat_bindings_immutable_update',
  'CREATE TRIGGER membership_subscriptions_trial_window_immutable',
  'CREATE TRIGGER membership_subscriptions_trial_conversion_write_once',
]
for (const token of requiredSqlTokens) {
  if (!sql.includes(token)) fail('generated PostgreSQL template missing: ' + token)
}
const contractFields = [
  ...persistence.table.columns.map((column) => column.name),
  ...persistence.additionalTables.flatMap((table) => table.columns.map((column) => column.name)),
]
for (const fieldName of contractFields) {
  if (!sql.includes(fieldName)) fail('PostgreSQL DDL is missing contract field: ' + fieldName)
}
const contractIndexes = [
  ...persistence.table.indexes.map((index) => index.name),
  ...persistence.additionalTables.flatMap((table) => table.indexes.map((index) => index.name)),
]
for (const indexName of contractIndexes) {
  if (!sql.includes(indexName)) fail('PostgreSQL DDL is missing contract index: ' + indexName)
}
const subscriptionUniqueIndexes = [...sql.matchAll(/CREATE\s+UNIQUE\s+INDEX\s+([a-z0-9_]+)\s+ON\s+membership_subscriptions\b/gi)]
  .map((match) => match[1])
if (JSON.stringify(subscriptionUniqueIndexes) !==
    JSON.stringify(['ux_membership_subscriptions_trial_per_subscriber_creator'])) {
  fail('only the contract-defined one-trial-per-creator unique index is allowed for subscriptions')
}
if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(?:orders?|order_items?|payments?|refunds?|wallets?|ledger|ledger_entries)\b/i.test(sql)) {
  fail('D1-04 financial/order tables must not enter the D1-01 schema')
}
if (/PRAGMA|AUTOINCREMENT|strftime|julianday|RAISE\s*\(\s*ABORT|GLOB/i.test(sql)) {
  fail('generated PostgreSQL SQL contains SQLite-only syntax')
}

mkdirSync(dirname(outputPath), { recursive: true })
const generatedHeader = [
  '-- GENERATED FILE. Do not hand-edit.',
  '-- Regenerate with scripts/neon/generate-d1-01-membership-postgres-migration.mjs.',
  '-- See scripts/neon/templates/d1-01-membership-postgres.sql for the checked schema template.',
  '-- Source of truth remains migrations/0001..0008 and the W07 Subscription contracts.',
  '-- This file is schema-only; runtime remains on Cloudflare D1 pending a separate cutover gate.',
  '',
].join('\n')
writeFileSync(outputPath, generatedHeader + '\n' + sql)
console.log('W07_D1_01_MEMBERSHIP_POSTGRES_MIGRATION_GENERATION_PASS')
