import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  inspectD1_04OrderMigrationPreflight,
  verifyD1_04OrderMigrationPostflight,
  ORDER_MIGRATION_ID,
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

const targetObjects = [
  { type: 'table', name: 'orders', tbl_name: 'orders', sql: 'CREATE TABLE orders (order_id TEXT PRIMARY KEY)' },
  { type: 'table', name: 'order_lines', tbl_name: 'order_lines', sql: 'CREATE TABLE order_lines (order_line_id TEXT PRIMARY KEY)' },
  { type: 'table', name: 'order_create_idempotency', tbl_name: 'order_create_idempotency', sql: 'CREATE TABLE order_create_idempotency (id TEXT PRIMARY KEY)' },
  { type: 'index', name: 'ix_orders_customer_created_order', tbl_name: 'orders', sql: 'CREATE INDEX ix_orders_customer_created_order ON orders(customer_id, created_at, order_id)' },
  { type: 'index', name: 'ix_orders_status_created_order', tbl_name: 'orders', sql: 'CREATE INDEX ix_orders_status_created_order ON orders(status, created_at, order_id)' },
  { type: 'index', name: 'ix_order_lines_order_id', tbl_name: 'order_lines', sql: 'CREATE INDEX ix_order_lines_order_id ON order_lines(order_id)' },
  { type: 'index', name: 'ix_order_lines_item_ref_version', tbl_name: 'order_lines', sql: 'CREATE INDEX ix_order_lines_item_ref_version ON order_lines(item_ref, item_version)' },
  { type: 'index', name: 'ix_order_create_idempotency_customer_created', tbl_name: 'order_create_idempotency', sql: 'CREATE INDEX ix_order_create_idempotency_customer_created ON order_create_idempotency(customer_id, created_at)' },
  { type: 'index', name: 'ix_order_create_idempotency_expiration', tbl_name: 'order_create_idempotency', sql: 'CREATE INDEX ix_order_create_idempotency_expiration ON order_create_idempotency(expires_at)' },
  ...[
    ['orders_commercial_snapshot_immutable', 'orders'],
    ['orders_version_must_advance', 'orders'],
    ['orders_status_transition_guard', 'orders'],
    ['orders_retained', 'orders'],
    ['order_lines_require_order', 'order_lines'],
    ['order_lines_immutable_update', 'order_lines'],
    ['order_lines_retained', 'order_lines'],
    ['order_create_idempotency_identity_immutable', 'order_create_idempotency'],
    ['order_create_idempotency_terminal_immutable', 'order_create_idempotency'],
  ].map(([name, table]) => ({
    type: 'trigger', name, tbl_name: table,
    sql: 'CREATE TRIGGER ' + name + ' BEFORE UPDATE ON ' + table + ' BEGIN SELECT 1; END',
  })),
]

const columns = (names) => ({
  success: true,
  results: [{ results: names.map(([name, type], cid) => ({
    cid, name, type, notnull: 1, dflt_value: null, pk: cid === 0 ? 1 : 0,
  })) }],
})

const tableInfo = {
  orders: columns([
    ['order_id', 'TEXT'], ['customer_id', 'TEXT'], ['status', 'TEXT'], ['version', 'INTEGER'],
    ['currency', 'TEXT'], ['subtotal_minor', 'INTEGER'], ['discount_minor', 'INTEGER'],
    ['tax_minor', 'INTEGER'], ['total_minor', 'INTEGER'], ['created_at', 'TEXT'],
    ['updated_at', 'TEXT'], ['confirmed_at', 'TEXT'], ['cancelled_at', 'TEXT'], ['failure_code', 'TEXT'],
  ]),
  orderLines: columns([
    ['order_line_id', 'TEXT'], ['order_id', 'TEXT'], ['item_type', 'TEXT'], ['item_ref', 'TEXT'],
    ['item_version', 'TEXT'], ['quantity', 'INTEGER'], ['unit_amount_minor', 'INTEGER'],
    ['line_subtotal_minor', 'INTEGER'], ['line_discount_minor', 'INTEGER'], ['line_tax_minor', 'INTEGER'],
    ['line_total_minor', 'INTEGER'], ['item_snapshot_json', 'TEXT'], ['created_at', 'TEXT'],
  ]),
  idempotency: columns([
    ['id', 'TEXT'], ['customer_id', 'TEXT'], ['operation_key', 'TEXT'], ['idempotency_key', 'TEXT'],
    ['request_hash', 'TEXT'], ['state', 'TEXT'], ['response_status', 'INTEGER'], ['response_json', 'TEXT'],
    ['created_at', 'TEXT'], ['expires_at', 'TEXT'],
  ]),
}

test('clean empty D1-04 schema is eligible for explicit migration only', () => {
  const result = inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: wrapSchema(baseSchema),
    migrationState: { querySkipped: 'd1_migrations table not present' },
  })
  assert.equal(result.result, 'PREFLIGHT_PASS_CLEAN_TARGET')
  assert.equal(result.action, 'APPLY')
  assert.equal(result.databaseUuid, '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736')
  assert.equal(result.writesPerformed, false)
})

test('already applied migration proceeds only to postflight verification', () => {
  const result = inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: wrapSchema([...baseSchema, migrationTable, ...targetObjects]),
    migrationState: wrapMigrationState([ORDER_MIGRATION_ID]),
  })
  assert.equal(result.action, 'VERIFY_ONLY')
  assert.equal(result.writesPerformed, false)
})

test('fails closed if any target object exists without matching migration history', () => {
  assert.throws(() => inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: wrapSchema([...baseSchema, targetObjects[0]]),
    migrationState: { querySkipped: 'd1_migrations table not present' },
  }), /target commerce objects already exist/)
})

test('fails closed when migration history exists but was not readable', () => {
  assert.throws(() => inspectD1_04OrderMigrationPreflight({
    schemaSnapshot: wrapSchema([...baseSchema, migrationTable]),
    migrationState: { querySkipped: 'probe failed' },
  }), /history query was skipped/)
})

test('postflight validates exact tables, columns, indexes, triggers, and migration history', () => {
  const baseline = wrapSchema([...baseSchema])
  const remote = wrapSchema([...baseSchema, migrationTable, ...targetObjects])
  const report = verifyD1_04OrderMigrationPostflight({
    preflightSchema: baseline,
    postflightSchema: remote,
    migrationState: wrapMigrationState([ORDER_MIGRATION_ID]),
    ordersTableInfo: tableInfo.orders,
    orderLinesTableInfo: tableInfo.orderLines,
    idempotencyTableInfo: tableInfo.idempotency,
  })
  assert.equal(report.result, 'POSTFLIGHT_PASS')
  assert.equal(report.baselineSchemaPreserved, true)
  assert.equal(report.verifiedTables.length, 3)
  assert.equal(report.verifiedIndexes.length, 6)
  assert.equal(report.verifiedTriggers.length, 9)
  assert.equal(report.databaseRowsExported, false)
})

test('postflight rejects missing migration history', () => {
  assert.throws(() => verifyD1_04OrderMigrationPostflight({
    preflightSchema: wrapSchema(baseSchema),
    postflightSchema: wrapSchema([...baseSchema, migrationTable, ...targetObjects]),
    migrationState: wrapMigrationState([]),
    ordersTableInfo: tableInfo.orders,
    orderLinesTableInfo: tableInfo.orderLines,
    idempotencyTableInfo: tableInfo.idempotency,
  }), /does not contain/)
})

test('postflight rejects changed existing schema objects', () => {
  const changedBase = wrapSchema([{ ...baseSchema[0], sql: 'CREATE TABLE _cf_KV (key TEXT, value TEXT)' }])
  assert.throws(() => verifyD1_04OrderMigrationPostflight({
    preflightSchema: wrapSchema(baseSchema),
    postflightSchema: wrapSchema([...changedBase.results[0].results, migrationTable, ...targetObjects]),
    migrationState: wrapMigrationState([ORDER_MIGRATION_ID]),
    ordersTableInfo: tableInfo.orders,
    orderLinesTableInfo: tableInfo.orderLines,
    idempotencyTableInfo: tableInfo.idempotency,
  }), /pre-existing schema object was removed or changed/)
})

test('workflow is manual-only, requires exact SHA/name/confirmation, and has no deploy command', () => {
  const workflow = fs.readFileSync(new URL('../../../../.github/workflows/w07-d1-04-order-migration.yml', import.meta.url), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s{2}(push|pull_request):/m)
  assert.match(workflow, /source_sha:/)
  assert.match(workflow, /target_database_name:/)
  assert.match(workflow, /APPLY_W07_D1_04_ORDER_MIGRATION/)
  assert.match(workflow, /SOURCE_SHA.*GITHUB_SHA/s)
  assert.match(workflow, /d1 migrations apply/)
  assert.match(workflow, /--remote/)
  assert.match(workflow, /id: preflight/)
  assert.match(workflow, /steps\.preflight\.outputs\.action == 'APPLY'/)
  assert.match(workflow, /Read-only D1-04 postflight/)
  assert.doesNotMatch(workflow, /wrangler(?:@[\w.]+)?\s+deploy/)
})
