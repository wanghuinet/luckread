import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  inspectD1_04OrderMigrationPreflight,
  verifyD1_04OrderMigrationPostflight,
  ORDER_MIGRATION_ID,
  PAYMENT_MIGRATION_ID,
  SAVED_METHOD_MIGRATION_ID,
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

test('an applied Order migration can advance only the pending Payment migration', () => {
  const result = inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: schemaWithMigrations([ORDER_MIGRATION_ID]),
    migrationState: wrapMigrationState([ORDER_MIGRATION_ID]),
  })
  assert.equal(result.action, 'APPLY')
  assert.deepEqual(result.pendingMigrationIds, [PAYMENT_MIGRATION_ID])
  assert.equal(result.writesPerformed, false)
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
  assert.equal(report.verifiedTables.length, 8)
  assert.equal(report.verifiedIndexes.length, 18)
  assert.equal(report.verifiedTriggers.length, 36)
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
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s{2}(push|pull_request):/m)
  assert.match(workflow, /source_sha:/)
  assert.match(workflow, /target_database_name:/)
  assert.match(workflow, /APPLY_W07_D1_04_ORDER_MIGRATION/)
  assert.match(workflow, /SOURCE_SHA.*GITHUB_SHA/s)
  assert.match(workflow, /d1 migrations apply/)
  assert.match(workflow, /--remote/)
  assert.match(workflow, /id: schema_preflight/)
  assert.match(workflow, /steps\.schema_preflight\.outputs\.action == 'APPLY'/)
  assert.match(workflow, /Capture read-only D1-04 schema after candidate migrations/)
  assert.match(workflow, /0002_payment_provider_events\.sql/)
  assert.match(workflow, /0003_saved_payment_methods_mandates\.sql/)
  assert.match(workflow, /PRAGMA table_info\("saved_payment_methods"\)/)
  assert.match(workflow, /PRAGMA table_info\("payment_mandates"\)/)
  assert.match(workflow, /PRAGMA table_info\("payments"\)/)
  assert.match(workflow, /PRAGMA table_info\("payment_provider_events"\)/)
  assert.match(workflow, /PRAGMA table_info\("payment_provider_event_conflicts"\)/)
  assert.doesNotMatch(workflow, /wrangler(?:@[\w.]+)?\s+deploy/)
})
