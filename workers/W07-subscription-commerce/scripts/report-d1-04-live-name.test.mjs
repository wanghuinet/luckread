import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMITTED_D1_04_UUID, inspectW07D1_04LiveName } from './report-d1-04-live-name.mjs'

const config = {
  d1_databases: [
    { binding: 'D1_01', database_name: 'luckread', database_id: '2f80471e-3756-49f9-8db1-7707a433ad64', migrations_dir: 'migrations' },
    { binding: 'D1_04', database_name: 'unimportant', database_id: ADMITTED_D1_04_UUID },
  ],
}
const contract = { physicalD1Registry: { 'D1-04': ADMITTED_D1_04_UUID } }

test('reports the current live name when the configured display label is stale', () => {
  const report = inspectW07D1_04LiveName({
    databaseList: [
      { name: 'luckread', uuid: '2f80471e-3756-49f9-8db1-7707a433ad64' },
      { name: 'real-finance-db', uuid: ADMITTED_D1_04_UUID },
    ],
    wranglerConfig: config,
    boundaryContract: contract,
  })
  assert.equal(report.result, 'LIVE_NAME_IDENTIFIED')
  assert.equal(report.liveDatabaseName, 'real-finance-db')
  assert.equal(report.configuredDatabaseName, 'unimportant')
  assert.equal(report.displayNameMatches, false)
  assert.equal(report.readOnly, true)
  assert.equal(report.migrationApplied, false)
  assert.equal(report.deploymentPerformed, false)
})

test('reports a matching configured name without claiming that any migration or deployment occurred', () => {
  const report = inspectW07D1_04LiveName({
    databaseList: [{ name: 'unimportant', uuid: ADMITTED_D1_04_UUID }],
    wranglerConfig: config,
    boundaryContract: contract,
  })
  assert.equal(report.displayNameMatches, true)
  assert.match(report.nextAction, /still require their separate reviewed gates/)
  assert.equal(report.migrationApplied, false)
  assert.equal(report.deploymentPerformed, false)
})

test('accepts inventory resources expressed with database_id instead of uuid', () => {
  const report = inspectW07D1_04LiveName({
    databaseList: [{ database_name: 'real-finance-db', database_id: ADMITTED_D1_04_UUID }],
    wranglerConfig: config,
    boundaryContract: contract,
  })
  assert.equal(report.liveDatabaseName, 'real-finance-db')
})

test('rejects a canonical registry UUID mismatch', () => {
  assert.throws(() => inspectW07D1_04LiveName({
    databaseList: [{ name: 'real-finance-db', uuid: ADMITTED_D1_04_UUID }],
    wranglerConfig: config,
    boundaryContract: { physicalD1Registry: { 'D1-04': 'wrong-uuid' } },
  }), /canonical D1-04 registry UUID/)
})

test('rejects a missing or mismatched W07 D1_04 binding UUID', () => {
  assert.throws(() => inspectW07D1_04LiveName({
    databaseList: [{ name: 'real-finance-db', uuid: ADMITTED_D1_04_UUID }],
    wranglerConfig: { d1_databases: config.d1_databases.filter((entry) => entry.binding !== 'D1_04') },
    boundaryContract: contract,
  }), /W07 D1_04 binding/)

  assert.throws(() => inspectW07D1_04LiveName({
    databaseList: [{ name: 'real-finance-db', uuid: ADMITTED_D1_04_UUID }],
    wranglerConfig: { d1_databases: config.d1_databases.map((entry) => entry.binding === 'D1_04' ? { ...entry, database_id: 'wrong-uuid' } : entry) },
    boundaryContract: contract,
  }), /W07 D1_04 binding/)
})

test('fails closed if the live inventory has no exact UUID match', () => {
  assert.throws(() => inspectW07D1_04LiveName({
    databaseList: [{ name: 'real-finance-db', uuid: 'different-uuid' }],
    wranglerConfig: config,
    boundaryContract: contract,
  }), /exactly one resource/)
})

test('fails closed if the live inventory contains duplicate exact UUID matches', () => {
  assert.throws(() => inspectW07D1_04LiveName({
    databaseList: [
      { name: 'real-finance-db', uuid: ADMITTED_D1_04_UUID },
      { name: 'duplicate', uuid: ADMITTED_D1_04_UUID },
    ],
    wranglerConfig: config,
    boundaryContract: contract,
  }), /exactly one resource/)
})

test('rejects empty, padded, overlong, or control-character remote names', () => {
  for (const name of ['', ' ', ' padded ', 'x'.repeat(257), 'line\nbreak']) {
    assert.throws(() => inspectW07D1_04LiveName({
      databaseList: [{ name, uuid: ADMITTED_D1_04_UUID }],
      wranglerConfig: config,
      boundaryContract: contract,
    }), /valid D1-04 display name/)
  }
})
