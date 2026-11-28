import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0004_w07_founding_offer_reservations.sql')
const templatePath = resolve(scriptDirectory, 'templates/w07-founding-offer-reservations-postgres.sql')
const sql = readFileSync(templatePath, 'utf8')
const required = [
  'ALTER TABLE membership_plan_versions',
  "DEFAULT 'STANDARD'",
  "offer_kind IN ('STANDARD', 'FOUNDING')",
  'founding_capacity',
  "price_mode = 'FIXED'",
  'w07_guard_founding_offer_plan_version',
  'FOR UPDATE',
  'membership_plan_versions_founding_offer_immutable',
  'CREATE TABLE membership_founding_reservations',
  'UNIQUE (subscriber_id, idempotency_key)',
  'membership_founding_reservation_payment_events',
  'BEGIN;',
  'COMMIT;',
]
for (const token of required) {
  if (!sql.includes(token)) throw new Error('W07 founding reservation template missing: ' + token)
}
const executableLines = sql.split(/\r?\n/).map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'))
if (executableLines[0] !== 'BEGIN;' || executableLines.at(-1) !== 'COMMIT;') {
  throw new Error('W07 founding reservation migration must retain one exact outer transaction wrapper')
}
if (/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(?:orders?|order_items?|payments?|refunds?|wallets?|ledger|ledger_entries)\b/i.test(sql)) {
  throw new Error('D1-04 financial/order tables must not enter W07 D1-01')
}
mkdirSync(dirname(outputPath), { recursive: true })
const header = [
  '-- GENERATED FILE. Do not hand-edit.',
  '-- Regenerate with scripts/neon/generate-w07-founding-offer-reservations-postgres-migration.mjs.',
  '-- Source template: scripts/neon/templates/w07-founding-offer-reservations-postgres.sql.',
  '',
].join('\n')
writeFileSync(outputPath, header + '\n' + sql)
console.log('W07_FOUNDING_OFFER_RESERVATIONS_POSTGRES_MIGRATION_GENERATION_PASS')
