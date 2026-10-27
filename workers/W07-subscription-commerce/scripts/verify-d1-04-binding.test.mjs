import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMITTED_D1_04_UUID, verifyW07D1_04Binding } from './verify-d1-04-binding.mjs'

const config = {
  d1_databases: [
    { binding: 'D1_01', database_name: 'luckread', database_id: '2f80471e-3756-49f9-8db1-7707a433ad64', migrations_dir: 'migrations' },
    { binding: 'D1_04', database_name: 'unimportant', database_id: ADMITTED_D1_04_UUID },
  ],
}
const contract = {
  physicalD1Registry: { 'D1-04': ADMITTED_D1_04_UUID },
}
const inventory = [
  { name: 'luckread', uuid: '2f80471e-3756-49f9-8db1-7707a433ad64' },
  { name: 'unimportant', uuid: ADMITTED_D1_04_UUID },
]

test('accepts the admitted UUID when registry, W07 binding and current inventory agree', () => {
  assert.deepEqual(verifyW07D1_04Binding({
    databaseList: inventory,
    wranglerConfig: config,
    boundaryContract: contract,
  }), {
    result: 'PASS',
    binding: 'D1_04',
    databaseUuid: ADMITTED_D1_04_UUID,
    databaseName: 'unimportant',
    source: 'current read-only Cloudflare D1 inventory',
  })
})

test('rejects a missing or different registered UUID', () => {
  assert.throws(() => verifyW07D1_04Binding({
    databaseList: inventory,
    wranglerConfig: config,
    boundaryContract: { physicalD1Registry: { 'D1-04': null } },
  }), /canonical D1-04 registry UUID/)
})

test('rejects a missing or mismatched W07 binding', () => {
  assert.throws(() => verifyW07D1_04Binding({
    databaseList: inventory,
    wranglerConfig: { d1_databases: config.d1_databases.filter((entry) => entry.binding !== 'D1_04') },
    boundaryContract: contract,
  }), /W07 D1_04 binding/)
  assert.throws(() => verifyW07D1_04Binding({
    databaseList: inventory,
    wranglerConfig: { d1_databases: config.d1_databases.map((entry) => entry.binding === 'D1_04' ? { ...entry, database_id: 'unknown' } : entry) },
    boundaryContract: contract,
  }), /W07 D1_04 binding/)
})

test('rejects when the admitted database is absent from current inventory', () => {
  assert.throws(() => verifyW07D1_04Binding({
    databaseList: inventory.filter((entry) => entry.uuid !== ADMITTED_D1_04_UUID),
    wranglerConfig: config,
    boundaryContract: contract,
  }), /exactly one resource/)
})

test('rejects stale display-name configuration even when the UUID exists', () => {
  assert.throws(() => verifyW07D1_04Binding({
    databaseList: [{ name: 'renamed-resource', uuid: ADMITTED_D1_04_UUID }],
    wranglerConfig: config,
    boundaryContract: contract,
  }), /does not match the current resource name/)
})

test('rejects duplicate inventory entries for the same physical UUID', () => {
  assert.throws(() => verifyW07D1_04Binding({
    databaseList: [...inventory, { name: 'duplicate', uuid: ADMITTED_D1_04_UUID }],
    wranglerConfig: config,
    boundaryContract: contract,
  }), /exactly one resource/)
})
