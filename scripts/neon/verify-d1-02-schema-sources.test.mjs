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

test('W03 production runtime is Neon while its D1-02 migration source remains pinned', () => {
  const owner = contract.owners[0]
  assert.ok(owner.physicalBindings.some((item) =>
    item.binding === 'D1_02' && item.logicalDomain === 'D1-02' && item.included === true))
  const config = JSON.parse(readSource(owner.wrangler))
  assert.equal(config.d1_databases?.length ?? 0, 0)
  assert.equal(config.vars?.W03_CONTENT_READ_DRIVER, 'neon')
  assert.ok(config.hyperdrive?.some((item) =>
    item.binding === 'HYPERDRIVE_CONTENT_PG' && item.id === 'c55183e1cc3446409c9c1075832c6615'))
  assert.deepEqual(validateWorkerBindings(config, owner), [])
})

test('W05 historical schema source remains pinned while the production Worker uses Neon only', () => {
  const owner = contract.owners[1]
  assert.deepEqual(
    owner.physicalBindings.filter((item) => item.included).map((item) => item.logicalDomain),
    ['D1-02'],
  )
  assert.deepEqual(
    owner.physicalBindings.filter((item) => !item.included).map((item) => item.logicalDomain),
    ['D1-03'],
  )
  const config = JSON.parse(readSource(owner.wrangler))
  assert.equal(config.d1_databases?.length ?? 0, 0)
  assert.equal(config.vars?.W05_DATABASE_DRIVER, 'neon')
  assert.equal(config.vars?.W05_PUSH_ENDPOINT_DATABASE_DRIVER, 'neon')
  assert.deepEqual(validateWorkerBindings(config, owner), [])
})

test('binding validators reject Neon target drift and any W05 production D1 reintroduction', () => {
  const w03Owner = contract.owners[0]
  const w03Config = JSON.parse(readSource(w03Owner.wrangler))
  const wrongW03Target = {
    ...w03Config,
    hyperdrive: w03Config.hyperdrive.map((item) =>
      item.binding === 'HYPERDRIVE_CONTENT_PG' ? { ...item, id: 'wrong-target' } : item),
  }
  assert.ok(validateWorkerBindings(wrongW03Target, w03Owner).some((error) => error.includes('HYPERDRIVE_CONTENT_PG target mismatch')))
  const w03D1Reintroduced = { ...w03Config, d1_databases: [{ binding: 'D1_02' }] }
  assert.ok(validateWorkerBindings(w03D1Reintroduced, w03Owner).some((error) => error.includes('zero D1 bindings')))

  const w05Owner = contract.owners[1]
  const w05Config = JSON.parse(readSource(w05Owner.wrangler))
  const extraBinding = {
    ...w05Config,
    d1_databases: [{ binding: 'UNREVIEWED_DB', database_name: 'unexpected', database_id: 'unexpected' }],
  }
  assert.ok(validateWorkerBindings(extraBinding, w05Owner).some((error) => error.includes('zero D1 bindings')))
  const wrongHyperdrive = {
    ...w05Config,
    hyperdrive: w05Config.hyperdrive.map((item) =>
      item.binding === 'HYPERDRIVE_D1_02' ? { ...item, id: 'wrong-target' } : item),
  }
  assert.ok(validateWorkerBindings(wrongHyperdrive, w05Owner).some((error) => error.includes('HYPERDRIVE_D1_02 target mismatch')))
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
  assert.equal(result.report.ownerSummaries.find((item) => item.worker === 'W05').runtimeProvider, 'neon')
  assert.equal(result.report.safety.neonConnectionAttempted, false)
  assert.equal(result.report.safety.remoteDdlExecuted, false)
  assert.equal(result.report.safety.productionD1Touched, false)
  assert.equal(result.report.safety.workerRuntimeOrBindingChanged, true)
})
