import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPECTED_W01_PAYLOAD_MIGRATION_NAME,
  evaluatePayloadMigrationLedgerRows,
} from './payload-baseline-reconciliation.mjs'

test('accepts exactly the committed W01 Payload baseline migration row', () => {
  assert.deepEqual(
    evaluatePayloadMigrationLedgerRows([
      { name: EXPECTED_W01_PAYLOAD_MIGRATION_NAME },
    ]),
    {
      valid: true,
      expectedName: EXPECTED_W01_PAYLOAD_MIGRATION_NAME,
      actualNames: [EXPECTED_W01_PAYLOAD_MIGRATION_NAME],
      rowCount: 1,
    },
  )
})

test('rejects a different Payload migration identity', () => {
  const result = evaluatePayloadMigrationLedgerRows([{ name: 'unexpected_migration' }])
  assert.equal(result.valid, false)
  assert.deepEqual(result.actualNames, ['unexpected_migration'])
})

test('rejects an absent Payload migration ledger row', () => {
  assert.equal(evaluatePayloadMigrationLedgerRows([]).valid, false)
})

test('rejects duplicate or additional Payload migration ledger rows', () => {
  assert.equal(
    evaluatePayloadMigrationLedgerRows([
      { name: EXPECTED_W01_PAYLOAD_MIGRATION_NAME },
      { name: EXPECTED_W01_PAYLOAD_MIGRATION_NAME },
    ]).valid,
    false,
  )
})

test('treats malformed ledger rows as invalid without exposing row payloads', () => {
  const result = evaluatePayloadMigrationLedgerRows([{ name: null }])
  assert.equal(result.valid, false)
  assert.deepEqual(result.actualNames, [null])
})
