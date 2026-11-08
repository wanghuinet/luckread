import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildW07D104OrderPaymentMigration } from './generate-w07-order-payment-postgres-migration.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const artifactPath = path.resolve(scriptDir, '../../src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql')

test('W07 D1-04 order/payment migration is deterministic and matches its committed artifact', () => {
  const first = buildW07D104OrderPaymentMigration()
  const second = buildW07D104OrderPaymentMigration()
  assert.equal(first.migration, second.migration)
  assert.equal(first.migration, readFileSync(artifactPath, 'utf8'))
  assert.equal(first.sliceTotals.tables, 6)
  assert.equal(first.sliceTotals.explicitIndexes, 14)
  assert.equal(first.sliceTotals.triggers, 24)
  assert.equal(first.sliceTotals.triggerFunctions, 1)
  assert.equal(first.sliceTotals.foreignKeys, 0)
  assert.deepEqual(first.contract.schema.totals, {
    tables: 8, explicitIndexes: 18, triggers: 36, triggerFunctions: 2, foreignKeys: 0,
  })
  for (const value of Object.values(first.hashes)) assert.match(value, /^[a-f0-9]{64}$/)
})

test('W07 slice is limited to the first two D1-04 source migrations', () => {
  const result = buildW07D104OrderPaymentMigration()
  for (const name of [
    'orders',
    'order_lines',
    'order_create_idempotency',
    'payments',
    'payment_provider_events',
    'payment_provider_event_conflicts',
  ]) assert.ok(result.migration.includes('CREATE TABLE ' + name + ' ('))
  for (const name of [
    'saved_payment_methods',
    'payment_mandates',
    'subscription_renewal_cycles',
    'subscription_renewal_scheduler_state',
    'revenuecat_webhook_events',
    'revenuecat_webhook_event_conflicts',
    'refunds',
    'billing_documents',
    'payment_method_revocation_requests',
    'entitlements',
    'ledger_entries',
    'payment_intents',
    'users',
    'media',
  ]) assert.ok(!result.migration.includes('CREATE TABLE ' + name + ' ('))
  assert.match(result.migration, /CREATE UNIQUE INDEX ux_payments_single_live_or_successful_per_order/)
  assert.match(result.migration, /CREATE FUNCTION w07_d104_order_payment_source_guard/)
  assert.match(result.migration, /CREATE TRIGGER payment_provider_event_conflicts_reference_first_receipt/)
  assert.equal(result.contract.target.databaseName, 'luckread_finance')
  assert.equal(result.contract.primaryOwner.worker, 'W07')
})

test('W07 generator fails closed when any admitted source is missing', () => {
  assert.throws(
    () => buildW07D104OrderPaymentMigration({ readSource: () => null }),
    /Missing required W07 D1-04 schema source/,
  )
})
