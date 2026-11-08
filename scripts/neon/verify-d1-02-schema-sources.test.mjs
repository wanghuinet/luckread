import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  buildD1_02Inventory,
  compareFileSets,
  scanSqlPortability,
  validateWorkerBindings,
} from './verify-d1-02-schema-sources.mjs'

const root = process.cwd()
const contract = JSON.parse(readFileSync(
  path.join(root, 'contracts/database/neon-d1-02-schema-sources.v1.json'),
  'utf8',
))

function readSource(relativePath) {
  try { return readFileSync(path.join(root, relativePath), 'utf8') } catch { return null }
}

function listSqlFiles(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory)
  const files = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile() && entry.name.endsWith('.sql')) {
        files.push(path.relative(absoluteDirectory, absolute).split(path.sep).join('/'))
      }
    }
  }
  walk(absoluteDirectory)
  return files.sort()
}

test('D1-02 contract freezes the two owner source sets and excludes D1-03', () => {
  assert.equal(contract.target.domainId, 'D1-02')
  assert.equal(contract.target.databaseName, 'luckreadpro')
  assert.equal(contract.owners.length, 2)
  assert.equal(contract.owners[0].worker, 'W03')
  assert.equal(contract.owners[0].sqlMigrations.length, 15)
  assert.equal(contract.owners[1].worker, 'W05')
  assert.equal(contract.owners[1].sqlMigrations.length, 15)

  const w05Bindings = contract.owners[1].physicalBindings
  assert.deepEqual(
    w05Bindings.filter((item) => item.included).map((item) => item.logicalDomain),
    ['D1-02'],
  )
  assert.deepEqual(
    w05Bindings.filter((item) => !item.included).map((item) => item.logicalDomain),
    ['D1-03'],
  )
})

test('W03 Wrangler binding is pinned to the admitted D1-02 database', () => {
  const config = JSON.parse(readSource(contract.owners[0].wrangler))
  assert.deepEqual(validateWorkerBindings(config, contract.owners[0]), [])
})

test('W05 D1-02 binding is included while its D1-03 binding stays separately excluded', () => {
  const config = JSON.parse(readSource(contract.owners[1].wrangler))
  assert.deepEqual(validateWorkerBindings(config, contract.owners[1]), [])
})

test('binding validator rejects UUID drift and an unreviewed extra database binding', () => {
  const owner = contract.owners[1]
  const correct = JSON.parse(readSource(owner.wrangler))
  const wrongTarget = {
    ...correct,
    d1_databases: correct.d1_databases.map((item) =>
      item.binding === 'DB' ? { ...item, database_id: 'wrong-target' } : item),
  }
  assert.ok(validateWorkerBindings(wrongTarget, owner).some((error) => error.includes('database_id mismatch')))

  const extraBinding = {
    ...correct,
    d1_databases: [...correct.d1_databases, {
      binding: 'UNREVIEWED_DB',
      database_name: 'unexpected',
      database_id: 'unexpected',
    }],
  }
  assert.ok(validateWorkerBindings(extraBinding, owner).some((error) => error.includes('unexpected=[UNREVIEWED_DB]')))
})

test('SQLite portability scanner detects JSON1, randomblob, triggers, INSERT OR IGNORE and table rebuilds', () => {
  const sql = `
    CREATE TABLE sample_v2 (id TEXT PRIMARY KEY);
    CREATE TRIGGER sample_trigger AFTER INSERT ON sample BEGIN
      INSERT OR IGNORE INTO outbox(payload) VALUES (json_object('id', NEW.id, 'key', lower(hex(randomblob(16)))));
    END;
    DROP TABLE sample;
    ALTER TABLE sample_v2 RENAME TO sample;
  `
  const result = scanSqlPortability(sql)
  const features = Object.fromEntries(result.sqliteSpecificFeatures.map((item) => [item.name, item.count]))
  assert.equal(features.json1_function, 1)
  assert.equal(features.randomblob, 1)
  assert.equal(features.insert_or_ignore, 1)
  assert.equal(features.trigger_definition, 1)
  assert.equal(features.table_rebuild_sequence, 1)
  assert.equal(result.requiresManualPostgresPort, true)
})

test('file-set comparison reports missing and unexpected migration sources', () => {
  assert.deepEqual(compareFileSets(['a.sql', 'b.sql'], ['a.sql', 'c.sql']), {
    missing: ['b.sql'],
    unexpected: ['c.sql'],
  })
})

test('repository inventory resolves exactly 30 current D1-02 migration sources without touching databases', () => {
  const result = buildD1_02Inventory({ contract, readSource, listSqlFiles })
  assert.deepEqual(result.failures, [])
  assert.equal(result.report.status, 'SOURCE_INVENTORY_VALID_PORTABILITY_REVIEW_REQUIRED')
  assert.equal(result.report.migrationSummary.migrationCount, 30)
  assert.equal(result.report.ownerSummaries.find((item) => item.worker === 'W03').migrationCount, 15)
  assert.equal(result.report.ownerSummaries.find((item) => item.worker === 'W05').migrationCount, 15)
  assert.equal(result.report.safety.neonConnectionAttempted, false)
  assert.equal(result.report.safety.remoteDdlExecuted, false)
  assert.equal(result.report.safety.productionD1Touched, false)
})
