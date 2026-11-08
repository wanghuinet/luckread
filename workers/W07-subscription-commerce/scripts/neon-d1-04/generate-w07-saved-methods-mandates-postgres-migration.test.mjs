import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildW07D104SavedMethodsMandatesMigration } from './generate-w07-saved-methods-mandates-postgres-migration.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const artifactPath = path.resolve(scriptDir, '../../src/neon-postgres-migrations-d1-04/0002_w07_d1_04_saved_methods_mandates.sql')

test('W07 D1-04 saved-method/mandate migration is deterministic and matches its committed artifact', () => {
  const first = buildW07D104SavedMethodsMandatesMigration()
  const second = buildW07D104SavedMethodsMandatesMigration()
  assert.equal(first.migration, second.migration)
  assert.equal(first.migration, readFileSync(artifactPath, 'utf8'))
  assert.deepEqual(first.contract.schema.totals, {
    tables: 2, explicitIndexes: 4, triggers: 12, triggerFunctions: 1, foreignKeys: 0,
  })
  for (const value of Object.values(first.hashes)) assert.match(value, /^[a-f0-9]{64}$/)
})

test('PAY-003 slice is additive and excludes deferred finance modules', () => {
  const result = buildW07D104SavedMethodsMandatesMigration()
  assert.match(result.migration, /CREATE TABLE saved_payment_methods \(/)
  assert.match(result.migration, /CREATE TABLE payment_mandates \(/)
  for (const name of [
    'payment_method_revocation_requests','subscription_renewal_cycles',
    'subscription_renewal_scheduler_state','revenuecat_webhook_events',
    'revenuecat_webhook_event_conflicts','refunds','billing_documents',
    'ledger_entries','entitlements','payment_intents','users','media',
  ]) assert.ok(!result.migration.includes('CREATE TABLE ' + name + ' ('))
  assert.match(result.migration, /CREATE FUNCTION w07_d104_saved_mandate_source_guard/)
  assert.match(result.migration, /CREATE UNIQUE INDEX ux_payment_mandates_provider_mandate_id/)
  assert.match(result.migration, /NEW.status <> 'PENDING_PROVIDER_CONFIRMATION'/)
})

test('W07 PAY-003 generator fails closed when an admitted source is missing', () => {
  assert.throws(
    () => buildW07D104SavedMethodsMandatesMigration({ readSource: () => null }),
    /Missing required W07 D1-04 saved-method\/mandate source/,
  )
})
