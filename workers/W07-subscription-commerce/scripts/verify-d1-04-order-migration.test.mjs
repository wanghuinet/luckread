import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  inspectD1_04OrderMigrationPreflight,
  verifyD1_04OrderMigrationPostflight,
  ORDER_MIGRATION_ID,
  PAYMENT_MIGRATION_ID,
  SAVED_METHOD_MIGRATION_ID,
  RENEWAL_MIGRATION_ID,
  REVENUECAT_WEBHOOK_MIGRATION_ID,
  REFUNDS_BILLING_MIGRATION_ID,
  REQUIRED_MIGRATION_IDS,
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
  REQUIRED_TRIGGERS,
} from './verify-d1-04-order-migration.mjs'

const baseSchema = [
  { type: 'table', name: '_cf_KV', tbl_name: '_cf_KV', sql: 'CREATE TABLE _cf_KV (key TEXT)' },
]
const migrationTable = {
  type: 'table', name: 'd1_migrations', tbl_name: 'd1_migrations',
  sql: 'CREATE TABLE d1_migrations (name TEXT PRIMARY KEY)',
}
const wrapSchema = (objects) => ({ success: true, results: [{ results: objects }] })
const wrapMigrationState = (names) => ({ success: true, results: [{ results: names.map((name) => ({ name })) }] })

function targetObjectsFor(migrationIds) {
  const tables = migrationIds.flatMap((id) => id === ORDER_MIGRATION_ID
    ? ['orders', 'order_lines', 'order_create_idempotency']
    : id === PAYMENT_MIGRATION_ID
      ? ['payments', 'payment_provider_events', 'payment_provider_event_conflicts']
      : id === SAVED_METHOD_MIGRATION_ID
        ? ['saved_payment_methods', 'payment_mandates']
        : id === RENEWAL_MIGRATION_ID
          ? ['subscription_renewal_cycles', 'subscription_renewal_scheduler_state']
          : id === REVENUECAT_WEBHOOK_MIGRATION_ID
            ? ['revenuecat_webhook_events', 'revenuecat_webhook_event_conflicts']
            : id === REFUNDS_BILLING_MIGRATION_ID
              ? ['refunds', 'billing_documents']
              : [])
  const objects = tables.map((tableName) => ({
    type: 'table',
    name: tableName,
    tbl_name: tableName,
    sql: 'CREATE TABLE ' + tableName + ' (probe TEXT)',
  }))
  for (const [tableName, names] of Object.entries(REQUIRED_INDEXES)) {
    for (const name of names) {
      if (!tables.includes(tableName)) continue
      objects.push({
        type: 'index',
        name,
        tbl_name: tableName,
        sql: 'CREATE INDEX ' + name + ' ON ' + tableName + '(probe)',
      })
    }
  }
  for (const [tableName, names] of Object.entries(REQUIRED_TRIGGERS)) {
    for (const name of names) {
      if (!tables.includes(tableName)) continue
      objects.push({
        type: 'trigger',
        name,
        tbl_name: tableName,
        sql: 'CREATE TRIGGER ' + name + ' BEFORE UPDATE ON ' + tableName + ' BEGIN SELECT 1; END',
      })
    }
  }
  return objects
}

function schemaWithMigrations(migrationIds) {
  return wrapSchema([
    ...baseSchema,
    ...(migrationIds.length > 0 ? [migrationTable] : []),
    ...targetObjectsFor(migrationIds),
  ])
}

function tableInfoFor(tableName) {
  return {
    success: true,
    results: [{
      results: REQUIRED_COLUMNS[tableName].map(([name, type, notnull, pk], cid) => ({
        cid, name, type, notnull, dflt_value: null, pk,
      })),
    }],
  }
}

const tableInfo = {
  orders: tableInfoFor('orders'),
  orderLines: tableInfoFor('order_lines'),
  idempotency: tableInfoFor('order_create_idempotency'),
  payments: tableInfoFor('payments'),
  paymentProviderEvents: tableInfoFor('payment_provider_events'),
  paymentProviderEventConflicts: tableInfoFor('payment_provider_event_conflicts'),
  savedPaymentMethods: tableInfoFor('saved_payment_methods'),
  paymentMandates: tableInfoFor('payment_mandates'),
  renewalCycles: tableInfoFor('subscription_renewal_cycles'),
  renewalSchedulerState: tableInfoFor('subscription_renewal_scheduler_state'),
  revenueCatWebhookEvents: tableInfoFor('revenuecat_webhook_events'),
  revenueCatWebhookConflicts: tableInfoFor('revenuecat_webhook_event_conflicts'),
  refunds: tableInfoFor('refunds'),
  billingDocuments: tableInfoFor('billing_documents'),
}

function verifyCompletePostflight({ preflightSchema = schemaWithMigrations([]), postflightSchema = schemaWithMigrations(REQUIRED_MIGRATION_IDS), migrationState = wrapMigrationState(REQUIRED_MIGRATION_IDS) } = {}) {
  return verifyD1_04OrderMigrationPostflight({
    preflightSchema,
    postflightSchema,
    migrationState,
    ordersTableInfo: tableInfo.orders,
    orderLinesTableInfo: tableInfo.orderLines,
    idempotencyTableInfo: tableInfo.idempotency,
    paymentsTableInfo: tableInfo.payments,
    paymentProviderEventsTableInfo: tableInfo.paymentProviderEvents,
    paymentProviderEventConflictsTableInfo: tableInfo.paymentProviderEventConflicts,
    savedPaymentMethodsTableInfo: tableInfo.savedPaymentMethods,
    paymentMandatesTableInfo: tableInfo.paymentMandates,
    renewalCyclesTableInfo: tableInfo.renewalCycles,
    renewalSchedulerStateTableInfo: tableInfo.renewalSchedulerState,
    revenueCatWebhookEventsTableInfo: tableInfo.revenueCatWebhookEvents,
    revenueCatWebhookConflictsTableInfo: tableInfo.revenueCatWebhookConflicts,
    refundsTableInfo: tableInfo.refunds,
    billingDocumentsTableInfo: tableInfo.billingDocuments,
  })
}

test('clean empty D1-04 schema is eligible for explicitly confirmed pending migrations only', () => {
  const result = inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: wrapSchema(baseSchema),
    migrationState: { querySkipped: 'd1_migrations table not present' },
  })
  assert.equal(result.result, 'PREFLIGHT_PASS_PENDING_MIGRATIONS')
  assert.equal(result.action, 'APPLY')
  assert.deepEqual(result.pendingMigrationIds, REQUIRED_MIGRATION_IDS)
  assert.equal(result.databaseUuid, '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736')
  assert.equal(result.writesPerformed, false)
})

test('fails closed when Payment migration history exists without its Order prerequisite', () => {
  assert.throws(() => inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: schemaWithMigrations([PAYMENT_MIGRATION_ID]),
    migrationState: wrapMigrationState([PAYMENT_MIGRATION_ID]),
  }), /payment migration is recorded without its required prior Order migration/)
})

test('fails closed when saved-method migration history exists without both earlier migrations', () => {
  assert.throws(() => inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: schemaWithMigrations([SAVED_METHOD_MIGRATION_ID]),
    migrationState: wrapMigrationState([SAVED_METHOD_MIGRATION_ID]),
  }), /saved-method migration is recorded without its required Order and Payment migrations/)
})

test('an applied Order migration can advance pending Payment, mandate and renewal migrations', () => {
  const result = inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: schemaWithMigrations([ORDER_MIGRATION_ID]),
    migrationState: wrapMigrationState([ORDER_MIGRATION_ID]),
  })
  assert.equal(result.action, 'APPLY')
  assert.deepEqual(result.pendingMigrationIds, [PAYMENT_MIGRATION_ID, SAVED_METHOD_MIGRATION_ID, RENEWAL_MIGRATION_ID, REVENUECAT_WEBHOOK_MIGRATION_ID, REFUNDS_BILLING_MIGRATION_ID])
  assert.equal(result.writesPerformed, false)
})


test('refund and billing migration cannot be recorded before the prior commerce schema chain', () => {
  assert.throws(() => inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: schemaWithMigrations([REFUNDS_BILLING_MIGRATION_ID]),
    migrationState: wrapMigrationState([REFUNDS_BILLING_MIGRATION_ID]),
  }), /refund\/billing migration is recorded without its required prior commerce migrations/)
})

test('all reviewed migrations already applied proceeds only to postflight verification', () => {
  const result = inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: schemaWithMigrations(REQUIRED_MIGRATION_IDS),
    migrationState: wrapMigrationState(REQUIRED_MIGRATION_IDS),
  })
  assert.equal(result.result, 'PREFLIGHT_PASS_ALREADY_APPLIED')
  assert.equal(result.action, 'VERIFY_ONLY')
  assert.deepEqual(result.pendingMigrationIds, [])
  assert.equal(result.writesPerformed, false)
})

test('normalizes Wrangler .sql migration filenames for preflight and postflight admission', () => {
  const migrationState = wrapMigrationState(REQUIRED_MIGRATION_IDS.map((migrationId) => migrationId + '.sql'))
  const preflight = inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: schemaWithMigrations(REQUIRED_MIGRATION_IDS),
    migrationState,
  })
  assert.equal(preflight.result, 'PREFLIGHT_PASS_ALREADY_APPLIED')
  assert.equal(preflight.action, 'VERIFY_ONLY')
  assert.deepEqual(preflight.pendingMigrationIds, [])

  const report = verifyCompletePostflight({ migrationState })
  assert.equal(report.result, 'POSTFLIGHT_PASS')
  assert.deepEqual(report.appliedMigrations, REQUIRED_MIGRATION_IDS)
  assert.equal(report.verifiedTriggers.length, 65)
})

test('fails closed if any target object exists without matching migration history', () => {
  assert.throws(() => inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: wrapSchema([...baseSchema, targetObjectsFor([PAYMENT_MIGRATION_ID])[0]]),
    migrationState: { querySkipped: 'd1_migrations table not present' },
  }), /target commerce objects already exist/)
})

test('fails closed when migration history exists but was not readable', () => {
  assert.throws(() => inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: wrapSchema([...baseSchema, migrationTable]),
    migrationState: { querySkipped: 'probe failed' },
  }), /history query was skipped/)
})

test('fails closed when migration history claims Order is applied but its table is missing', () => {
  assert.throws(() => inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: wrapSchema([...baseSchema, migrationTable]),
    migrationState: wrapMigrationState([ORDER_MIGRATION_ID]),
  }), /migration history records .* target schema objects are missing/)
})

test('postflight validates both migrations, all tables/columns/indexes/triggers, and preserves baseline', () => {
  const report = verifyCompletePostflight()
  assert.equal(report.result, 'POSTFLIGHT_PASS')
  assert.equal(report.baselineSchemaPreserved, true)
  assert.deepEqual(report.appliedMigrations, REQUIRED_MIGRATION_IDS)
  assert.equal(report.verifiedTables.length, 14)
  assert.equal(report.verifiedIndexes.length, 29)
  assert.equal(report.verifiedTriggers.length, 65)
  assert.equal(report.databaseRowsExported, false)
})

test('postflight rejects a missing Payment migration record', () => {
  assert.throws(() => verifyCompletePostflight({
    postflightSchema: schemaWithMigrations([ORDER_MIGRATION_ID]),
    migrationState: wrapMigrationState([ORDER_MIGRATION_ID]),
  }), /does not contain required migrations/)
})

test('postflight rejects changed existing schema objects', () => {
  const changedBase = wrapSchema([{ ...baseSchema[0], sql: 'CREATE TABLE _cf_KV (key TEXT, value TEXT)' }])
  assert.throws(() => verifyCompletePostflight({
    postflightSchema: wrapSchema([
      ...changedBase.results[0].results,
      migrationTable,
      ...targetObjectsFor(REQUIRED_MIGRATION_IDS),
    ]),
  }), /pre-existing schema object was removed or changed/)
})

test('workflow is manual-only, gates exact SHA/name/confirmation, and never deploys a Worker', () => {
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/w07-d1-04-order-migration.yml', import.meta.url), 'utf8')
  const migration = fs.readFileSync(new URL('../migrations-d1-04/0004_subscription_renewal_cycles.sql', import.meta.url), 'utf8')
  const revenueCatMigration = fs.readFileSync(new URL('../migrations-d1-04/0005_revenuecat_webhook_inbox.sql', import.meta.url), 'utf8')
  const refundsBillingMigration = fs.readFileSync(new URL('../migrations-d1-04/0006_refunds_billing_documents.sql', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s{2}(push|pull_request):/m)
  assert.match(workflow, /source_sha:/)
  assert.match(workflow, /target_database_name:/)
  assert.match(workflow, /APPLY_W07_D1_04_COMMERCE_MIGRATIONS/)
  assert.match(workflow, /SOURCE_SHA.*GITHUB_SHA/s)
  assert.match(workflow, /MAIN_SHA="\$\(git rev-parse origin\/main\)"/)
  assert.match(workflow, /SOURCE_SHA"\s*!=\s*"\$MAIN_SHA"/)
  assert.match(workflow, /d1 migrations apply/)
  assert.match(workflow, /--remote/)
  assert.match(workflow, /id: schema_preflight/)
  assert.match(workflow, /steps\.schema_preflight\.outputs\.action == 'APPLY'/)
  assert.match(workflow, /Capture read-only D1-04 schema after candidate migrations/)
  assert.match(workflow, /0002_payment_provider_events\.sql/)
  assert.match(workflow, /0003_saved_payment_methods_mandates\.sql/)
  assert.match(workflow, /0004_subscription_renewal_cycles\.sql/)
  assert.match(workflow, /0005_revenuecat_webhook_inbox\.sql/)
  assert.match(workflow, /0006_refunds_billing_documents\.sql/)
  assert.match(workflow, /PRAGMA table_info\("refunds"\)/)
  assert.match(workflow, /PRAGMA table_info\("billing_documents"\)/)
  assert.match(refundsBillingMigration, /CREATE TABLE refunds/)
  assert.match(refundsBillingMigration, /CREATE TABLE billing_documents/)
  assert.match(refundsBillingMigration, /refunds_require_captured_payment/)
  assert.match(refundsBillingMigration, /refunds_version_guard/)
  assert.match(workflow, /PRAGMA table_info\("saved_payment_methods"\)/)
  assert.match(workflow, /PRAGMA table_info\("payment_mandates"\)/)
  assert.match(workflow, /PRAGMA table_info\("subscription_renewal_cycles"\)/)
  assert.match(workflow, /PRAGMA table_info\("subscription_renewal_scheduler_state"\)/)
  assert.match(workflow, /PRAGMA table_info\("revenuecat_webhook_events"\)/)
  assert.match(workflow, /PRAGMA table_info\("revenuecat_webhook_event_conflicts"\)/)
  assert.match(revenueCatMigration, /CREATE TABLE revenuecat_webhook_events/)
  assert.match(revenueCatMigration, /CREATE TABLE revenuecat_webhook_event_conflicts/)
  assert.match(migration, /subscription_renewal_cycles_sync_state_transition_guard/)
  assert.match(workflow, /PRAGMA table_info\("payments"\)/)
  assert.match(workflow, /PRAGMA table_info\("payment_provider_events"\)/)
  assert.match(workflow, /PRAGMA table_info\("payment_provider_event_conflicts"\)/)
  assert.doesNotMatch(workflow, /wrangler(?:@[\w.]+)?\s+deploy/)
})


test('W07 deployment fails closed until all D1-04 commerce migrations are already applied', () => {
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/w07-subscription-runtime-deploy.yml', import.meta.url), 'utf8')
  const bindingPreflight = workflow.indexOf('node scripts/verify-d1-04-binding.mjs /tmp/w07-d1-list.json')
  const d1_04Gate = workflow.indexOf('name: Require D1-04 refund and billing migration readiness')
  const d1_01Migration = workflow.indexOf('name: Apply D1-01 Subscription migration')
  const workerDeploy = workflow.indexOf('name: Deploy W07')

  assert.ok(bindingPreflight >= 0, 'deployment must verify the live D1-04 binding')
  assert.ok(d1_04Gate > bindingPreflight, 'D1-04 schema admission must follow live binding verification')
  assert.ok(d1_04Gate < d1_01Migration, 'D1-04 schema admission must run before any D1-01 migration write')
  assert.ok(d1_01Migration < workerDeploy, 'D1-04 schema admission must run before Worker deployment')
  assert.match(workflow, /test -f migrations-d1-04\/0006_refunds_billing_documents\.sql/)
  assert.match(workflow, /verify-d1-04-order-migration\.mjs preflight/)
  assert.match(workflow, /\[\[ "\$ACTION" != "VERIFY_ONLY" \]\]/)
  assert.match(workflow, /D1-04 refund and billing migrations are pending or inconsistent/)
  assert.match(workflow, /--remote/)
})
