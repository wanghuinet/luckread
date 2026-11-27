import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0002_w07_subscription_lifecycle.sql')
const templatePath = resolve(scriptDirectory, 'templates/w07-subscription-lifecycle-postgres.sql')
const sql = readFileSync(templatePath, 'utf8')
const required = [
  'ALTER TABLE membership_subscriptions',
  'pause_started_at',
  'pause_period_end_snapshot',
  'pause_remaining_seconds',
  'membership_subscription_lifecycle_operation_receipts',
  'ux_membership_lifecycle_receipts_subscriber_idempotency',
  'membership_subscription_lifecycle_audit',
  'membership_subscription_lifecycle_audit_no_update_delete',
  'membership_subscription_lifecycle_audit_no_truncate',
]
for (const token of required) {
  if (!sql.includes(token)) throw new Error('W07 lifecycle PostgreSQL template missing: ' + token)
}
const executableLines = sql.split(/\r?\n/).map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'))
if (executableLines[0] !== 'BEGIN;' || executableLines.at(-1) !== 'COMMIT;') {
  throw new Error('W07 lifecycle migration must retain one exact outer transaction wrapper')
}
if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(?:orders?|order_items?|payments?|refunds?|wallets?|ledger|ledger_entries)\b/i.test(sql)) {
  throw new Error('D1-04 financial/order tables must not enter W07 D1-01')
}
mkdirSync(dirname(outputPath), { recursive: true })
const header = [
  '-- GENERATED FILE. Do not hand-edit.',
  '-- Regenerate with scripts/neon/generate-w07-lifecycle-postgres-migration.mjs.',
  '-- Source template: scripts/neon/templates/w07-subscription-lifecycle-postgres.sql.',
  '',
].join('\n')
writeFileSync(outputPath, header + '\n' + sql)
console.log('W07_SUBSCRIPTION_LIFECYCLE_POSTGRES_MIGRATION_GENERATION_PASS')
