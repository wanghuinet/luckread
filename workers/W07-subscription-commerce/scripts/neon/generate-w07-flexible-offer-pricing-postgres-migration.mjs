import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workerRoot = resolve(scriptDirectory, '../..')
const outputPath = resolve(workerRoot, 'src/neon-postgres-migrations/0003_w07_flexible_offer_pricing.sql')
const templatePath = resolve(scriptDirectory, 'templates/w07-flexible-offer-pricing-postgres.sql')
const sql = readFileSync(templatePath, 'utf8')
const required = [
  'ALTER TABLE membership_plan_versions',
  "DEFAULT 'FIXED'",
  "price_mode IN ('FIXED', 'FLEXIBLE')",
  'minimum_price_minor',
  'suggested_price_minor',
  'maximum_price_minor',
  'membership_plan_versions_price_mode_values_check',
  'BEGIN;',
  'COMMIT;',
]
for (const token of required) {
  if (!sql.includes(token)) throw new Error('W07 flexible offer pricing template missing: ' + token)
}
const executableLines = sql.split(/\r?\n/).map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'))
if (executableLines[0] !== 'BEGIN;' || executableLines.at(-1) !== 'COMMIT;') {
  throw new Error('W07 flexible offer pricing migration must retain one exact outer transaction wrapper')
}
if (/CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?(?:orders?|order_items?|payments?|refunds?|wallets?|ledger|ledger_entries)\\b/i.test(sql)) {
  throw new Error('D1-04 financial/order tables must not enter W07 D1-01')
}
mkdirSync(dirname(outputPath), { recursive: true })
const header = [
  '-- GENERATED FILE. Do not hand-edit.',
  '-- Regenerate with scripts/neon/generate-w07-flexible-offer-pricing-postgres-migration.mjs.',
  '-- Source template: scripts/neon/templates/w07-flexible-offer-pricing-postgres.sql.',
  '',
].join('\n')
writeFileSync(outputPath, header + '\n' + sql)
console.log('W07_FLEXIBLE_OFFER_PRICING_POSTGRES_MIGRATION_GENERATION_PASS')
