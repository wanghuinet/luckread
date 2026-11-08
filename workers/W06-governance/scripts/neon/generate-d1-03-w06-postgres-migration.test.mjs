import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildD103W06Migration } from './generate-d1-03-w06-postgres-migration.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const artifactPath = path.resolve(scriptDir, '../../src/neon-postgres-migrations/0001_w06_d1_03_moderation_schema.sql')

test('W06 D1-03 migration is deterministic and matches its committed artifact', () => {
  const first = buildD103W06Migration()
  const second = buildD103W06Migration()
  assert.equal(first.migration, second.migration)
  assert.equal(first.migration, readFileSync(artifactPath, 'utf8'))
  assert.equal(first.contract.schema.totals.tables, 7)
  assert.equal(first.contract.schema.totals.explicitIndexes, 11)
  assert.equal(first.contract.schema.totals.foreignKeys, 0)
  for (const value of Object.values(first.hashes)) assert.match(value, /^[a-f0-9]{64}$/)
})

test('W06 schema is limited to admitted moderation/report sources', () => {
  const result = buildD103W06Migration()
  for (const name of [
    'moderation_cases',
    'moderation_decisions',
    'moderation_decision_idempotency',
    'moderation_txn_guard',
    'moderation_enforcement_outbox',
    'moderation_reports',
    'moderation_report_idempotency',
  ]) assert.ok(result.migration.includes('CREATE TABLE ' + name + ' ('))
  assert.ok(!result.migration.includes('CREATE TABLE audit_events'))
  assert.ok(!result.migration.includes('CREATE TABLE appeals'))
  assert.ok(result.migration.includes('evidence_refs_json JSONB'))
  assert.ok(result.migration.includes("jsonb_typeof(evidence_refs_json) = 'array'"))
  assert.equal(result.contract.scope.excludedEntities.find((item) => item.entity === 'Appeal')?.entity, 'Appeal')
  assert.ok(result.contract.scope.excludedEntities.find((item) => item.entity === 'AuditEvent')?.reason.includes('W09-owned'))
})

test('W06 generator fails closed when any admitted source is missing', () => {
  assert.throws(
    () => buildD103W06Migration({ readSource: () => null }),
    /Missing required W06 D1-03 schema source/,
  )
})
