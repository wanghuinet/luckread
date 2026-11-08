import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildW03PostgresMigration } from './generate-d1-02-postgres-migration.mjs'

const root = process.cwd()
const inventory = JSON.parse(readFileSync(path.join(root, 'contracts/database/neon-d1-02-schema-sources.v1.json'), 'utf8'))
const contentContract = JSON.parse(readFileSync(path.join(root, 'contracts/persistence/CONTENT-ARTICLE-d1-02-persistence.v1.json'), 'utf8'))
const template = readFileSync(path.join(root, 'workers/W03-content/scripts/neon/templates/d1-02-content-postgres.sql'), 'utf8')

function readSource(relativePath) {
  try { return readFileSync(path.join(root, relativePath), 'utf8') } catch { return null }
}

test('W03 source authority is pinned to D1-02 luckreadpro and fifteen migration inputs', () => {
  const result = buildW03PostgresMigration({ inventory, contentContract, readSource, template })
  assert.match(result.artifact, /W03 \/ D1-02/)
  assert.equal(result.sourceReport.migrationCount, 15)
  assert.equal(result.sourceReport.sourceMigrations.length, 15)
})

test('the native schema contains the complete nine-table empty-database final state', () => {
  const { artifact } = buildW03PostgresMigration({ inventory, contentContract, readSource, template })
  const tables = [...artifact.matchAll(/^CREATE TABLE ([a-z_][a-z0-9_]*)/gim)].map((m) => m[1])
  assert.deepEqual(tables.sort(), [
    'contents','content_mutation_idempotency','content_outbox_events','content_txn_guard',
    'content_revisions','content_relationships','content_series','content_collections',
    'content_id_snowflake_state',
  ].sort())
})

test('all source outbox trigger families and indexes are preserved', () => {
  const { artifact } = buildW03PostgresMigration({ inventory, contentContract, readSource, template })
  assert.equal((artifact.match(/^CREATE TRIGGER /gim) ?? []).length, 8)
  assert.equal((artifact.match(/^CREATE (?:UNIQUE )?INDEX /gim) ?? []).length, 28)
  assert.match(artifact, /json_build_object\(/)
  assert.match(artifact, /gen_random_uuid\(\)/)
  assert.match(artifact, /payload_json TEXT NOT NULL/)
  assert.match(artifact, /media_refs_json TEXT NOT NULL DEFAULT '\[\]'/)
})

test('SQLite/D1 DDL syntax and implicit foreign keys are excluded', () => {
  const { artifact } = buildW03PostgresMigration({ inventory, contentContract, readSource, template })
  assert.doesNotMatch(artifact, /\bPRAGMA\b|\bAUTOINCREMENT\b|\bstrftime\s*\(|\bjulianday\s*\(|\bjson_object\s*\(|\brandomblob\s*\(|\bRAISE\s*\(\s*ABORT/i)
  const ddlStatements = artifact.replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(ddlStatements, /\bFOREIGN\s+KEY\b|\bREFERENCES\s+[a-z_]/i)
})

test('W05 and D1-03 sources are not included in the W03 migration artifact', () => {
  const { artifact } = buildW03PostgresMigration({ inventory, contentContract, readSource, template })
  assert.doesNotMatch(artifact, /workers\/W05-social\//)
  assert.doesNotMatch(artifact, /D1_03|secondary/)
})

test('source inventory drift fails closed', () => {
  const changed = structuredClone(inventory)
  changed.owners.find((owner) => owner.worker === 'W03').sqlMigrations.push('0016_unreviewed.sql')
  assert.throws(() => buildW03PostgresMigration({ inventory: changed, contentContract, readSource, template }),
    /exactly the frozen fifteen D1-02 source migrations/)
})

test('W03 D1-02 binding drift fails closed', () => {
  const changed = structuredClone(inventory)
  changed.owners.find((owner) => owner.worker === 'W03').physicalBindings[0].databaseUuid = 'wrong'
  assert.throws(() => buildW03PostgresMigration({ inventory: changed, contentContract, readSource, template }),
    /physical binding/)
})
