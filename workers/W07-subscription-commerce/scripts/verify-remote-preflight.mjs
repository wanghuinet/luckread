import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EXPECTED_DATABASE_NAME = 'luckread'
const EXPECTED_DATABASE_ID = '2f80471e-3756-49f9-8db1-7707a433ad64'
const BASELINE_MIGRATION = '0001_membership_subscriptions.sql'
const VERSION_MIGRATION = '0002_subscription_version_cas.sql'
const PLAN_MIGRATION = '0003_membership_plans.sql'
const REVENUECAT_BINDING_MIGRATION = '0004_revenuecat_membership_product_bindings.sql'
const PLAN_CHANGE_RECEIPT_MIGRATION = '0005_membership_subscription_plan_change_receipts.sql'

const EXPECTED_INDEXES = [
  'ix_membership_subscriptions_subscriber_status_period',
  'ix_membership_subscriptions_plan_version',
  'ix_membership_subscriptions_creator_status',
  'ix_membership_subscriptions_updated_at',
]

const LEGACY_COLUMNS = [
  ['subscription_id', 'TEXT', 1, 1],
  ['subscriber_id', 'TEXT', 1, 0],
  ['plan_id', 'TEXT', 1, 0],
  ['plan_version', 'INTEGER', 1, 0],
  ['creator_id', 'TEXT', 0, 0],
  ['status', 'TEXT', 1, 0],
  ['started_at', 'TEXT', 1, 0],
  ['current_period_start', 'TEXT', 1, 0],
  ['current_period_end', 'TEXT', 1, 0],
  ['cancel_at', 'TEXT', 0, 0],
  ['entitlement_snapshot_ref', 'TEXT', 0, 0],
  ['created_at', 'TEXT', 1, 0],
  ['updated_at', 'TEXT', 1, 0],
]

const CURRENT_COLUMNS = [...LEGACY_COLUMNS, ['version', 'INTEGER', 1, 0]]

const EXPECTED_PLAN_COLUMNS = [
  ['plan_id', 'TEXT', 1, 1],
  ['owner_type', 'TEXT', 1, 0],
  ['owner_id', 'TEXT', 1, 0],
  ['current_version', 'INTEGER', 1, 0],
  ['status', 'TEXT', 1, 0],
  ['visibility', 'TEXT', 1, 0],
  ['version', 'INTEGER', 1, 0],
  ['created_at', 'TEXT', 1, 0],
  ['updated_at', 'TEXT', 1, 0],
]

const EXPECTED_PLAN_VERSION_COLUMNS = [
  ['plan_id', 'TEXT', 1, 1],
  ['plan_version', 'INTEGER', 1, 2],
  ['name', 'TEXT', 1, 0],
  ['tier', 'TEXT', 1, 0],
  ['billing_interval', 'TEXT', 1, 0],
  ['price_minor', 'INTEGER', 1, 0],
  ['currency', 'TEXT', 1, 0],
  ['benefits_json', 'TEXT', 1, 0],
  ['created_at', 'TEXT', 1, 0],
]

const EXPECTED_PLAN_INDEXES = [
  'ix_membership_plans_owner_status_updated',
  'ix_membership_plans_status_visibility_updated',
]

const EXPECTED_PLAN_VERSION_INDEXES = [
  'ix_membership_plan_versions_created',
]

const EXPECTED_PLAN_TRIGGERS = [
  'membership_plan_versions_immutable_update',
  'membership_plan_versions_immutable_delete',
  'membership_plans_owner_immutable_update',
  'membership_plans_current_version_forward_only',
]

const EXPECTED_REVENUECAT_BINDING_COLUMNS = [
  ['revenuecat_app_id', 'TEXT', 1, 1],
  ['store', 'TEXT', 1, 2],
  ['product_id', 'TEXT', 1, 3],
  ['plan_id', 'TEXT', 1, 0],
  ['plan_version', 'INTEGER', 1, 0],
  ['status', 'TEXT', 1, 0],
  ['created_at', 'TEXT', 1, 0],
  ['retired_at', 'TEXT', 0, 0],
]
const EXPECTED_REVENUECAT_BINDING_INDEXES = [
  'ix_membership_revenuecat_bindings_plan_version',
]
const EXPECTED_REVENUECAT_BINDING_TRIGGERS = [
  'membership_revenuecat_bindings_immutable_update',
  'membership_revenuecat_bindings_immutable_delete',
]

const EXPECTED_PLAN_CHANGE_RECEIPT_COLUMNS = [
  ['change_request_id', 'TEXT', 1, 1],
  ['subscription_id', 'TEXT', 1, 0],
  ['subscriber_id', 'TEXT', 1, 0],
  ['source_subscription_version', 'INTEGER', 1, 0],
  ['applied_subscription_version', 'INTEGER', 1, 0],
  ['source_plan_id', 'TEXT', 1, 0],
  ['source_plan_version', 'INTEGER', 1, 0],
  ['target_plan_id', 'TEXT', 1, 0],
  ['target_plan_version', 'INTEGER', 1, 0],
  ['order_id', 'TEXT', 1, 0],
  ['payment_id', 'TEXT', 1, 0],
  ['currency', 'TEXT', 1, 0],
  ['amount_before_tax_minor', 'INTEGER', 1, 0],
  ['current_period_start', 'TEXT', 1, 0],
  ['current_period_end', 'TEXT', 1, 0],
  ['applied_at', 'TEXT', 1, 0],
]
const EXPECTED_PLAN_CHANGE_RECEIPT_INDEXES = [
  'ix_membership_subscription_plan_change_receipts_subscription',
  'ix_membership_subscription_plan_change_receipts_payment',
]
const EXPECTED_PLAN_CHANGE_RECEIPT_TRIGGERS = [
  'membership_subscription_plan_change_receipts_immutable_update',
  'membership_subscription_plan_change_receipts_immutable_delete',
]

const fail = (message) => {
  throw new Error('READ_ONLY_PREFLIGHT_FAILED: ' + message)
}

const collectObjects = (value, output = []) => {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output)
  } else if (value && typeof value === 'object') {
    output.push(value)
    for (const item of Object.values(value)) collectObjects(item, output)
  }
  return output
}

const columnsFrom = (value) => collectObjects(value)
  .filter((item) => Number.isInteger(item.cid) &&
    typeof item.name === 'string' &&
    typeof item.type === 'string' &&
    Object.prototype.hasOwnProperty.call(item, 'notnull') &&
    Object.prototype.hasOwnProperty.call(item, 'pk'))
  .sort((left, right) => left.cid - right.cid)
  .map((item) => ({
    name: item.name,
    type: item.type,
    notnull: Number(item.notnull),
    primaryKey: Number(item.pk),
    defaultValue: item.dflt_value,
  }))

const indexNamesFrom = (value) => new Set(collectObjects(value)
  .filter((item) => Number.isInteger(item.seq) && typeof item.name === 'string')
  .map((item) => item.name))

export function verifyD1SubscriptionPreflight({
  databaseList,
  migrationState,
  subscriptionSchema,
  subscriptionIndexes,
  subscriptionForeignKeys = [],
  planSchema = [],
  planIndexes = [],
  planVersionSchema = [],
  planVersionIndexes = [],
  planTriggers = [],
  revenueCatBindingSchema = [],
  revenueCatBindingIndexes = [],
  revenueCatBindingTriggers = [],
  planChangeReceiptSchema = [],
  planChangeReceiptIndexes = [],
  planChangeReceiptTriggers = [],
  expectedDatabaseName = EXPECTED_DATABASE_NAME,
  expectedDatabaseId = EXPECTED_DATABASE_ID,
}) {
  const databases = collectObjects(databaseList)
  const hasExactDatabase = databases.some((item) =>
    item.name === expectedDatabaseName &&
    (item.uuid === expectedDatabaseId || item.database_id === expectedDatabaseId))
  if (!hasExactDatabase) fail('exact D1-01 database name/UUID was not found')

  const migrationNames = new Set([
    BASELINE_MIGRATION, VERSION_MIGRATION, PLAN_MIGRATION,
    REVENUECAT_BINDING_MIGRATION, PLAN_CHANGE_RECEIPT_MIGRATION,
  ])
  const appliedMigrations = [...new Set(collectObjects(migrationState)
    .filter((item) => migrationNames.has(item.name))
    .map((item) => item.name))].sort()
  if (!appliedMigrations.includes(BASELINE_MIGRATION)) {
    fail('baseline migration 0001 is not recorded as applied')
  }

  const columns = columnsFrom(subscriptionSchema)
  const shape = columns.map(({ name, type, notnull, primaryKey }) => [name, type, notnull, primaryKey])
  const foreignKeyRows = collectObjects(subscriptionForeignKeys)
    .filter((item) => Object.prototype.hasOwnProperty.call(item, 'from') &&
      Object.prototype.hasOwnProperty.call(item, 'table') &&
      typeof item.from === 'string')
  if (foreignKeyRows.length > 0) fail('physical foreign keys are forbidden for Subscription')

  const indexNames = indexNamesFrom(subscriptionIndexes)
  for (const name of EXPECTED_INDEXES) {
    if (!indexNames.has(name)) fail('missing expected index ' + name)
  }

  const planShape = columnsFrom(planSchema).map(({ name, type, notnull, primaryKey }) => [name, type, notnull, primaryKey])
  const planVersionShape = columnsFrom(planVersionSchema).map(({ name, type, notnull, primaryKey }) => [name, type, notnull, primaryKey])
  const planIndexNames = indexNamesFrom(planIndexes)
  const planVersionIndexNames = indexNamesFrom(planVersionIndexes)
  const planTriggerNames = new Set(collectObjects(planTriggers)
    .filter((item) => typeof item.name === 'string')
    .map((item) => item.name))
  const noPlanTables = planShape.length === 0 && planVersionShape.length === 0 &&
    planIndexNames.size === 0 && planVersionIndexNames.size === 0 && planTriggerNames.size === 0
  const allPlanTablesPresent = JSON.stringify(planShape) === JSON.stringify(EXPECTED_PLAN_COLUMNS) &&
    JSON.stringify(planVersionShape) === JSON.stringify(EXPECTED_PLAN_VERSION_COLUMNS) &&
    EXPECTED_PLAN_INDEXES.every((name) => planIndexNames.has(name)) &&
    EXPECTED_PLAN_VERSION_INDEXES.every((name) => planVersionIndexNames.has(name)) &&
    planTriggerNames.size === EXPECTED_PLAN_TRIGGERS.length &&
    EXPECTED_PLAN_TRIGGERS.every((name) => planTriggerNames.has(name))

  const revenueCatBindingShape = columnsFrom(revenueCatBindingSchema).map(({ name, type, notnull, primaryKey }) => [name, type, notnull, primaryKey])
  const revenueCatBindingIndexNames = indexNamesFrom(revenueCatBindingIndexes)
  const revenueCatBindingTriggerNames = new Set(collectObjects(revenueCatBindingTriggers)
    .filter((item) => typeof item.name === 'string')
    .map((item) => item.name))
  const noRevenueCatBinding = revenueCatBindingShape.length === 0 &&
    revenueCatBindingIndexNames.size === 0 && revenueCatBindingTriggerNames.size === 0
  const allRevenueCatBindingPresent =
    JSON.stringify(revenueCatBindingShape) === JSON.stringify(EXPECTED_REVENUECAT_BINDING_COLUMNS) &&
    EXPECTED_REVENUECAT_BINDING_INDEXES.every((name) => revenueCatBindingIndexNames.has(name)) &&
    revenueCatBindingTriggerNames.size === EXPECTED_REVENUECAT_BINDING_TRIGGERS.length &&
    EXPECTED_REVENUECAT_BINDING_TRIGGERS.every((name) => revenueCatBindingTriggerNames.has(name))

  const receiptShape = columnsFrom(planChangeReceiptSchema).map(({ name, type, notnull, primaryKey }) => [name, type, notnull, primaryKey])
  const receiptIndexNames = indexNamesFrom(planChangeReceiptIndexes)
  const receiptTriggerNames = new Set(collectObjects(planChangeReceiptTriggers)
    .filter((item) => typeof item.name === 'string')
    .map((item) => item.name))
  const noPlanChangeReceipts = receiptShape.length === 0 &&
    receiptIndexNames.size === 0 && receiptTriggerNames.size === 0
  const allPlanChangeReceiptsPresent =
    JSON.stringify(receiptShape) === JSON.stringify(EXPECTED_PLAN_CHANGE_RECEIPT_COLUMNS) &&
    EXPECTED_PLAN_CHANGE_RECEIPT_INDEXES.every((name) => receiptIndexNames.has(name)) &&
    receiptTriggerNames.size === EXPECTED_PLAN_CHANGE_RECEIPT_TRIGGERS.length &&
    EXPECTED_PLAN_CHANGE_RECEIPT_TRIGGERS.every((name) => receiptTriggerNames.has(name))

  const legacySubscriptionShape = JSON.stringify(shape) === JSON.stringify(LEGACY_COLUMNS)
  const currentSubscriptionShape = JSON.stringify(shape) === JSON.stringify(CURRENT_COLUMNS)
  const versionColumn = columns.find((column) => column.name === 'version')
  if (currentSubscriptionShape && (!versionColumn || versionColumn.type !== 'INTEGER' ||
      versionColumn.notnull !== 1 || versionColumn.primaryKey !== 0 ||
      ![1, '1'].includes(versionColumn.defaultValue))) {
    fail('version column does not satisfy INTEGER NOT NULL DEFAULT 1')
  }

  const coreMigrations = appliedMigrations.filter((name) =>
    name === BASELINE_MIGRATION || name === VERSION_MIGRATION || name === PLAN_MIGRATION)
  const hasOnlyBaseline = JSON.stringify(coreMigrations) === JSON.stringify([BASELINE_MIGRATION])
  const hasVersionMigration = JSON.stringify(coreMigrations) === JSON.stringify([BASELINE_MIGRATION, VERSION_MIGRATION])
  const hasPlanMigration = JSON.stringify(coreMigrations) === JSON.stringify([BASELINE_MIGRATION, VERSION_MIGRATION, PLAN_MIGRATION])
  const hasRevenueCatMigration = appliedMigrations.includes(REVENUECAT_BINDING_MIGRATION)
  const hasPlanChangeReceiptMigration = appliedMigrations.includes(PLAN_CHANGE_RECEIPT_MIGRATION)

  let migrationAction
  if (hasOnlyBaseline && legacySubscriptionShape && noPlanTables &&
      noRevenueCatBinding && noPlanChangeReceipts &&
      !hasRevenueCatMigration && !hasPlanChangeReceiptMigration) {
    migrationAction = 'apply'
  } else if (hasVersionMigration && currentSubscriptionShape && noPlanTables &&
      noRevenueCatBinding && noPlanChangeReceipts &&
      !hasRevenueCatMigration && !hasPlanChangeReceiptMigration) {
    migrationAction = 'apply'
  } else if (hasPlanMigration && currentSubscriptionShape && allPlanTablesPresent) {
    if (!hasRevenueCatMigration && noRevenueCatBinding &&
        !hasPlanChangeReceiptMigration && noPlanChangeReceipts) {
      // Both bounded D1-01 candidate migrations remain pending; apply only
      // after exact target/history preflight has admitted the full sequence.
      migrationAction = 'apply'
    } else if (hasRevenueCatMigration && allRevenueCatBindingPresent &&
        !hasPlanChangeReceiptMigration && noPlanChangeReceipts) {
      // RevenueCat product binding is already physical; the plan-change
      // receipt is the only pending D1-01 migration.
      migrationAction = 'apply'
    } else if (hasRevenueCatMigration && allRevenueCatBindingPresent &&
        hasPlanChangeReceiptMigration && allPlanChangeReceiptsPresent) {
      migrationAction = 'skip'
    } else {
      fail('D1-01 RevenueCat or subscription plan-change receipt migration history and physical schemas do not match an admitted state')
    }
  } else {
    fail('migration history and physical Subscription/MembershipPlan schemas do not match an admitted state')
  }

  return {
    migrationAction,
    databaseName: expectedDatabaseName,
    databaseId: expectedDatabaseId,
    appliedMigrations,
    columns: shape,
    indexes: [...EXPECTED_INDEXES],
    foreignKeyCount: foreignKeyRows.length,
    planColumns: planShape,
    planVersionColumns: planVersionShape,
    planIndexes: EXPECTED_PLAN_INDEXES.filter((name) => planIndexNames.has(name)),
    planVersionIndexes: EXPECTED_PLAN_VERSION_INDEXES.filter((name) => planVersionIndexNames.has(name)),
    planTriggers: EXPECTED_PLAN_TRIGGERS.filter((name) => planTriggerNames.has(name)),
    revenueCatBindingColumns: revenueCatBindingShape,
    revenueCatBindingIndexes: EXPECTED_REVENUECAT_BINDING_INDEXES.filter((name) => revenueCatBindingIndexNames.has(name)),
    revenueCatBindingTriggers: EXPECTED_REVENUECAT_BINDING_TRIGGERS.filter((name) => revenueCatBindingTriggerNames.has(name)),
    planChangeReceiptColumns: receiptShape,
    planChangeReceiptIndexes: EXPECTED_PLAN_CHANGE_RECEIPT_INDEXES.filter((name) => receiptIndexNames.has(name)),
    planChangeReceiptTriggers: EXPECTED_PLAN_CHANGE_RECEIPT_TRIGGERS.filter((name) => receiptTriggerNames.has(name)),
  }
}

export function verifyD1SubscriptionPostflight(input) {
  const report = verifyD1SubscriptionPreflight(input)
  if (report.migrationAction !== 'skip') {
    fail('post-migration verification requires migrations 0001 through 0005 with exact current D1-01 schemas')
  }

  const integrityRows = collectObjects(input.versionIntegrity)
    .filter((item) => Object.prototype.hasOwnProperty.call(item, 'invalid_versions'))
  if (integrityRows.length !== 1) fail('version integrity query did not return exactly one count')
  const invalidVersions = Number(integrityRows[0].invalid_versions)
  if (!Number.isSafeInteger(invalidVersions) || invalidVersions !== 0) {
    fail('existing subscription versions include invalid or non-positive values')
  }

  const planIntegrityRows = collectObjects(input.planIntegrity)
    .filter((item) => Object.prototype.hasOwnProperty.call(item, 'invalid_current_plan_versions'))
  if (planIntegrityRows.length !== 1) fail('membership plan integrity query did not return exactly one count')
  const invalidCurrentPlanVersions = Number(planIntegrityRows[0].invalid_current_plan_versions)
  if (!Number.isSafeInteger(invalidCurrentPlanVersions) || invalidCurrentPlanVersions !== 0) {
    fail('membership plans include a missing or invalid current immutable version')
  }

  const receiptIntegrityRows = collectObjects(input.planChangeReceiptIntegrity)
    .filter((item) => Object.prototype.hasOwnProperty.call(item, 'invalid_plan_change_receipts'))
  if (receiptIntegrityRows.length !== 1) fail('plan-change receipt integrity query did not return exactly one count')
  const invalidPlanChangeReceipts = Number(receiptIntegrityRows[0].invalid_plan_change_receipts)
  if (!Number.isSafeInteger(invalidPlanChangeReceipts) || invalidPlanChangeReceipts !== 0) {
    fail('subscription plan-change receipt records contain invalid version or financial references')
  }

  return { ...report, invalidVersions, invalidCurrentPlanVersions, invalidPlanChangeReceipts, postflight: 'PASS' }
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

function main() {
  const [mode, ...filePaths] = process.argv.slice(2)
  const isPostflight = mode === 'postflight'
  if (!isPostflight && mode !== 'preflight') {
    throw new Error('Usage: node scripts/verify-remote-preflight.mjs <preflight|postflight> <database-list.json> <migration-state.json> <subscription-schema.json> <subscription-indexes.json> <subscription-foreign-keys.json> <plan-schema.json> <plan-version-schema.json> <plan-indexes.json> <plan-version-indexes.json> <plan-triggers.json> <revenuecat-binding-schema.json> <revenuecat-binding-indexes.json> <revenuecat-binding-triggers.json> <plan-change-receipt-schema.json> <plan-change-receipt-indexes.json> <plan-change-receipt-triggers.json> [version-integrity.json plan-integrity.json plan-change-receipt-integrity.json]')
  }
  const requiredCount = isPostflight ? 19 : 16
  if (filePaths.length !== requiredCount || filePaths.some((value) => !value)) {
    throw new Error('Invalid arguments for D1 subscription preflight verification')
  }

  const [
    databaseListPath, migrationStatePath, schemaPath, indexesPath, foreignKeysPath,
    planSchemaPath, planVersionSchemaPath, planIndexesPath, planVersionIndexesPath, planTriggersPath,
    revenueCatBindingSchemaPath, revenueCatBindingIndexesPath, revenueCatBindingTriggersPath,
    planChangeReceiptSchemaPath, planChangeReceiptIndexesPath, planChangeReceiptTriggersPath,
    versionIntegrityPath, planIntegrityPath, planChangeReceiptIntegrityPath,
  ] = filePaths
  const input = {
    databaseList: readJson(path.resolve(databaseListPath)),
    migrationState: readJson(path.resolve(migrationStatePath)),
    subscriptionSchema: readJson(path.resolve(schemaPath)),
    subscriptionIndexes: readJson(path.resolve(indexesPath)),
    subscriptionForeignKeys: readJson(path.resolve(foreignKeysPath)),
    planSchema: readJson(path.resolve(planSchemaPath)),
    planVersionSchema: readJson(path.resolve(planVersionSchemaPath)),
    planIndexes: readJson(path.resolve(planIndexesPath)),
    planVersionIndexes: readJson(path.resolve(planVersionIndexesPath)),
    planTriggers: readJson(path.resolve(planTriggersPath)),
    revenueCatBindingSchema: readJson(path.resolve(revenueCatBindingSchemaPath)),
    revenueCatBindingIndexes: readJson(path.resolve(revenueCatBindingIndexesPath)),
    revenueCatBindingTriggers: readJson(path.resolve(revenueCatBindingTriggersPath)),
    planChangeReceiptSchema: readJson(path.resolve(planChangeReceiptSchemaPath)),
    planChangeReceiptIndexes: readJson(path.resolve(planChangeReceiptIndexesPath)),
    planChangeReceiptTriggers: readJson(path.resolve(planChangeReceiptTriggersPath)),
  }
  if (isPostflight) {
    const report = verifyD1SubscriptionPostflight({
      ...input,
      versionIntegrity: readJson(path.resolve(versionIntegrityPath)),
      planIntegrity: readJson(path.resolve(planIntegrityPath)),
      planChangeReceiptIntegrity: readJson(path.resolve(planChangeReceiptIntegrityPath)),
    })
    console.log(JSON.stringify({ readOnlyPostflight: 'PASS', ...report }))
    return
  }

  const report = verifyD1SubscriptionPreflight(input)
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) throw new Error('GITHUB_OUTPUT is unavailable; refusing to continue deployment')
  fs.appendFileSync(outputPath, 'migration_action=' + report.migrationAction + '\n')
  console.log(JSON.stringify({ readOnlyPreflight: 'PASS', ...report }))
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
