import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveExpectedSchemaDatabase } from './verify-schema-database-target.mjs'

test('defaults W02 schema verification to the disposable local rehearsal database', () => {
  assert.equal(resolveExpectedSchemaDatabase({}), 'luckread_schema')
})

test('accepts only the explicit D1-01 Neon database for remote verification', () => {
  assert.equal(resolveExpectedSchemaDatabase({ W02_SCHEMA_EXPECTED_DATABASE: 'luckread' }), 'luckread')
})

test('rejects any unapproved W02 schema verification database', () => {
  for (const value of ['luckreadpro', 'luckread_finance', 'allluck', 'postgres', '']) {
    assert.throws(
      () => resolveExpectedSchemaDatabase({ W02_SCHEMA_EXPECTED_DATABASE: value }),
      /W02_SCHEMA_EXPECTED_DATABASE must be luckread_schema/,
    )
  }
})
