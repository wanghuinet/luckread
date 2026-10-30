import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  ADMITTED_D1_04_UUID,
  createD1_04SchemaSnapshotReport,
} from './report-d1-04-schema-snapshot.mjs'

const liveNameReport = {
  result: 'LIVE_NAME_IDENTIFIED',
  binding: 'D1_04',
  databaseUuid: ADMITTED_D1_04_UUID,
  configuredDatabaseName: 'unimportant',
  liveDatabaseName: 'unimportant',
  displayNameMatches: true,
  source: 'current read-only Cloudflare D1 inventory',
  readOnly: true,
  migrationApplied: false,
  deploymentPerformed: false,
}

const schemaWithCommerce = {
  success: true,
  results: [{
    results: [
      { type: 'table', name: 'd1_migrations', tbl_name: 'd1_migrations', sql: 'CREATE TABLE d1_migrations (name TEXT PRIMARY KEY)' },
      { type: 'table', name: 'orders', tbl_name: 'orders', sql: 'CREATE TABLE orders (order_id TEXT PRIMARY KEY)' },
      { type: 'index', name: 'ix_orders_customer_created', tbl_name: 'orders', sql: 'CREATE INDEX ix_orders_customer_created ON orders(customer_id, created_at)' },
      { type: 'trigger', name: 'orders_guard', tbl_name: 'orders', sql: 'CREATE TRIGGER orders_guard BEFORE UPDATE ON orders BEGIN SELECT RAISE(ABORT, "immutable"); END' },
      { type: 'table', name: 'unrelated_records', tbl_name: 'unrelated_records', sql: 'CREATE TABLE unrelated_records (id TEXT PRIMARY KEY)' },
    ],
  }],
}

test('reports current schema objects and applied migration history without claiming writes', () => {
  const report = createD1_04SchemaSnapshotReport({
    liveNameReport,
    schemaSnapshot: schemaWithCommerce,
    migrationState: { success: true, results: [{ results: [{ name: '0001_orders' }, { name: '0002_order_idempotency' }] }] },
  })
  assert.equal(report.result, 'SCHEMA_SNAPSHOT_COLLECTED')
  assert.equal(report.databaseUuid, ADMITTED_D1_04_UUID)
  assert.equal(report.databaseName, 'unimportant')
  assert.equal(report.migrationTablePresent, true)
  assert.equal(report.migrationHistoryRead, true)
  assert.deepEqual(report.appliedMigrations, ['0001_orders', '0002_order_idempotency'])
  assert.deepEqual(report.objectCounts, { tables: 3, views: 0, indexes: 1, triggers: 1 })
  assert.deepEqual(report.existingCommerceObjects.map((item) => item.name), ['ix_orders_customer_created', 'orders', 'orders_guard'])
  assert.equal(report.databaseRowsExported, false)
  assert.equal(report.writesPerformed, false)
  assert.equal(report.migrationApplied, false)
  assert.equal(report.deploymentPerformed, false)
  assert.ok(report.schemaObjects.every((object) => object.sql === null || typeof object.sql === 'string'))
})

test('handles a D1-04 database without a Wrangler migration history table', () => {
  const report = createD1_04SchemaSnapshotReport({
    liveNameReport,
    schemaSnapshot: { results: [{ results: [{ type: 'table', name: 'customers', tbl_name: 'customers', sql: 'CREATE TABLE customers (id TEXT PRIMARY KEY)' }] }] },
    migrationState: { querySkipped: 'd1_migrations table not present' },
  })
  assert.equal(report.migrationTablePresent, false)
  assert.equal(report.migrationHistoryRead, false)
  assert.deepEqual(report.appliedMigrations, [])
  assert.equal(report.objectCounts.tables, 1)
})

test('allows an empty schema and no recorded migrations without making a write', () => {
  const report = createD1_04SchemaSnapshotReport({
    liveNameReport,
    schemaSnapshot: { results: [{ results: [] }] },
    migrationState: { querySkipped: 'd1_migrations table not present' },
  })
  assert.equal(report.objectCounts.tables, 0)
  assert.deepEqual(report.schemaObjects, [])
  assert.equal(report.writesPerformed, false)
})

test('rejects a stale or mismatched binding report', () => {
  assert.throws(() => createD1_04SchemaSnapshotReport({
    liveNameReport: { ...liveNameReport, displayNameMatches: false },
    schemaSnapshot: schemaWithCommerce,
    migrationState: { results: [{ results: [{ name: '0001_orders' }] }] },
  }), /did not prove the admitted D1-04 binding/)
})

test('rejects a changed physical D1-04 UUID', () => {
  assert.throws(() => createD1_04SchemaSnapshotReport({
    liveNameReport: { ...liveNameReport, databaseUuid: 'wrong-uuid' },
    schemaSnapshot: schemaWithCommerce,
    migrationState: { results: [{ results: [{ name: '0001_orders' }] }] },
  }), /did not prove the admitted D1-04 binding/)
})

test('rejects unsafe live database names before use in a Wrangler command', () => {
  for (const databaseName of ['-unexpected-flag', ' padded ', 'x'.repeat(65), 'bad/name']) {
    assert.throws(() => createD1_04SchemaSnapshotReport({
      liveNameReport: { ...liveNameReport, liveDatabaseName: databaseName },
      schemaSnapshot: schemaWithCommerce,
      migrationState: { results: [{ results: [{ name: '0001_orders' }] }] },
    }), /cannot safely be used/)
  }
})

test('fails closed if migration history could not be read when its table exists', () => {
  assert.throws(() => createD1_04SchemaSnapshotReport({
    liveNameReport,
    schemaSnapshot: schemaWithCommerce,
    migrationState: { querySkipped: 'query unexpectedly skipped' },
  }), /history query was skipped/)
})

test('rejects migration entries when no d1_migrations table was reported', () => {
  assert.throws(() => createD1_04SchemaSnapshotReport({
    liveNameReport,
    schemaSnapshot: { results: [{ results: [] }] },
    migrationState: { results: [{ results: [{ name: '0001_orders' }] }] },
  }), /even though sqlite_master has no d1_migrations table/)
})

test('schema preflight runs read-only on main after migration or preflight workflow changes', () => {
  const workflow = fs.readFileSync(new URL('../../../.github/workflows/w07-d1-04-schema-preflight.yml', import.meta.url), 'utf8')
  assert.match(workflow, /^  push:/m)
  assert.match(workflow, /branches: \[main\]/)
  assert.match(workflow, /workers\/W07-subscription-commerce\/migrations-d1-04\/\*\*/)
  assert.match(workflow, /github\.event_name == 'push'/)
  assert.match(workflow, /inputs\.source_sha \|\| github\.sha/)
  assert.match(workflow, /READ_ONLY_D1_04_SCHEMA_PREFLIGHT/)
  assert.match(workflow, /SELECT type, name, tbl_name, sql FROM sqlite_master/)
  assert.match(workflow, /SELECT name FROM d1_migrations/)
  assert.doesNotMatch(workflow, /wrangler(?:@[\w.]+)?\s+deploy/)
  assert.doesNotMatch(workflow, /d1 migrations apply/)
})
