import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildD105W11Migration } from './generate-d1-05-w11-postgres-migration.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../../../..')
const readSource = (relativePath) => {
  try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
}

test('generates the exact W11 D1-05 six-table PostgreSQL 18 baseline', () => {
  const result = buildD105W11Migration({ readSource })
  assert.equal(result.tableNames.length, 6)
  assert.equal(result.indexNames.length, 8)
  assert.equal(result.sourceMigrationCount, 4)
  assert.equal(
    result.admissionStatus,
    'BLOCKED_MISSING_RETENTION_DELETION_AND_CONSENT_PURPOSE_POLICIES',
  )
  assert.match(result.sql, /CREATE TABLE analytics_event_dedupe/)
  assert.match(result.sql, /CREATE TABLE analytics_projection_rebuild_state/)
  assert.doesNotMatch(result.sql, /CREATE TABLE (?:campaigns|growth_operations)/i)
  assert.doesNotMatch(result.sql, /\b(?:actor_id|visitor_id|session_id)\b/i)
})

test('fails closed when any source D1 migration changes', () => {
  const sourcePath = 'workers/W11-growth-campaign-analytics-operations/migrations/0001_analytics_projection.sql'
  const original = readSource(sourcePath)
  assert.ok(original)
  assert.throws(
    () => buildD105W11Migration({
      readSource: (relativePath) => relativePath === sourcePath
        ? original + '\n-- unreviewed source drift\n'
        : readSource(relativePath),
    }),
    /source migration drift/,
  )
})

test('fails closed if retention/deletion/consent requirements are incorrectly marked admitted', () => {
  const contractPath = 'contracts/database/neon-d1-05-w11-analytics-schema.v1.json'
  const contract = JSON.parse(readSource(contractPath))
  contract.admission.status = 'ADMITTED'
  assert.throws(
    () => buildD105W11Migration({
      readSource: (relativePath) => relativePath === contractPath
        ? JSON.stringify(contract)
        : readSource(relativePath),
    }),
    /cannot be admitted while retention, deletion and consent\/purpose evidence is missing/,
  )
})

test('fails closed when the W11 runtime acquires an unapproved D1 binding', () => {
  const wranglerPath = 'workers/W11-growth-campaign-analytics-operations/wrangler.jsonc'
  const wrangler = JSON.parse(readSource(wranglerPath))
  wrangler.d1_databases.push({
    binding: 'D1_03',
    database_name: 'luckread_governance',
    database_id: 'unapproved',
    migrations_dir: 'migrations-d1-03',
  })
  assert.throws(
    () => buildD105W11Migration({
      readSource: (relativePath) => relativePath === wranglerPath
        ? JSON.stringify(wrangler)
        : readSource(relativePath),
    }),
    /single D1_05 binding/,
  )
})
