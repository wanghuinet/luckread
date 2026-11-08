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


test('ignores tables outside the W01 Payload snapshot but still requires every W01 table', async () => {
  const { evaluateW01PayloadTableCatalog } = await import('./payload-baseline-reconciliation.mjs')
  const result = evaluateW01PayloadTableCatalog(
    ['users', 'media', 'payload_migrations'],
    ['users', 'media', 'payload_migrations', 'user', 'session', 'membership_plans', 'neon_schema_migration_ledger'],
  )

  assert.equal(result.valid, true)
  assert.deepEqual(result.missingTables, [])
  assert.deepEqual(result.tablesOutsideW01Snapshot, [
    'membership_plans',
    'neon_schema_migration_ledger',
    'session',
    'user',
  ])
})

test('fails when a W01-owned Payload table is missing', async () => {
  const { evaluateW01PayloadTableCatalog } = await import('./payload-baseline-reconciliation.mjs')
  const result = evaluateW01PayloadTableCatalog(
    ['users', 'media', 'payload_migrations'],
    ['users', 'payload_migrations', 'user'],
  )

  assert.equal(result.valid, false)
  assert.deepEqual(result.missingTables, ['media'])
})

test('ignores foreign keys declared by non-W01 source tables', async () => {
  const { evaluateW01PayloadForeignKeyCatalog } = await import('./payload-baseline-reconciliation.mjs')
  const w01ForeignKey = {
    constraintName: 'payload_relationship_parent_fk',
    tableName: 'payload_relationships',
    referencedTable: 'users',
    columnsFrom: ['user_id'],
    columnsTo: ['id'],
    onDelete: 'cascade',
    onUpdate: 'no action',
  }
  const otherWorkerForeignKey = {
    constraintName: 'role_assignment_user_fk',
    tableName: 'role_assignments',
    referencedTable: 'user',
    columnsFrom: ['subject_id'],
    columnsTo: ['id'],
    onDelete: 'restrict',
    onUpdate: 'no action',
  }

  const result = evaluateW01PayloadForeignKeyCatalog(
    [w01ForeignKey],
    [otherWorkerForeignKey, w01ForeignKey],
    ['users', 'payload_relationships'],
  )

  assert.equal(result.valid, true)
  assert.deepEqual(result.actual, [w01ForeignKey])
  assert.equal(result.ignoredForeignKeyCount, 1)
})

test('still rejects an unexpected foreign key declared by a W01 source table', async () => {
  const { evaluateW01PayloadForeignKeyCatalog } = await import('./payload-baseline-reconciliation.mjs')
  const expectedForeignKey = {
    constraintName: 'payload_relationship_parent_fk',
    tableName: 'payload_relationships',
    referencedTable: 'users',
    columnsFrom: ['user_id'],
    columnsTo: ['id'],
    onDelete: 'cascade',
    onUpdate: 'no action',
  }
  const unexpectedW01ForeignKey = {
    constraintName: 'payload_relationship_media_fk',
    tableName: 'payload_relationships',
    referencedTable: 'media',
    columnsFrom: ['media_id'],
    columnsTo: ['id'],
    onDelete: 'cascade',
    onUpdate: 'no action',
  }

  const result = evaluateW01PayloadForeignKeyCatalog(
    [expectedForeignKey],
    [expectedForeignKey, unexpectedW01ForeignKey],
    ['users', 'media', 'payload_relationships'],
  )

  assert.equal(result.valid, false)
  assert.deepEqual(result.actual, [expectedForeignKey, unexpectedW01ForeignKey])
})
