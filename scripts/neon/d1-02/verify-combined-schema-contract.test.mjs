import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { verifyCombinedSchemaContract } from './verify-combined-schema-contract.mjs'

const root = process.cwd()
const contract = JSON.parse(readFileSync(path.join(root, 'contracts/database/neon-d1-02-combined-schema.v1.json'), 'utf8'))
const inventory = JSON.parse(readFileSync(path.join(root, 'contracts/database/neon-d1-02-schema-sources.v1.json'), 'utf8'))
const artifacts = new Map(contract.owners.map((owner) => [owner.worker, readFileSync(path.join(root, owner.artifactPath), 'utf8')]))
const loadArtifact = (file) => {
  const owner = contract.owners.find((item) => item.artifactPath === file)
  return owner ? artifacts.get(owner.worker) : null
}
const clone = (value) => structuredClone(value)

test('combined W03 and W05 schema exactly matches D1-02 object totals', () => {
  const report = verifyCombinedSchemaContract({ contract, inventory, loadArtifact })
  assert.deepEqual(report.totals, { owners:2, migrationSources:30, tables:28, explicitIndexes:63, triggers:9, triggerFunctions:10 })
  assert.equal(report.safety.neonConnectionAttempted, false)
  assert.equal(report.safety.d1_03SchemaIncluded, false)
})

test('combined contract rejects W05 D1-03 marked included in source inventory', () => {
  const invalid = clone(inventory)
  invalid.owners.find((item) => item.worker === 'W05').physicalBindings.find((item) => item.binding === 'D1_03').included = true
  assert.throws(() => verifyCombinedSchemaContract({ contract, inventory:invalid, loadArtifact }), /W05 DB only; W05 D1_03/)
})

test('combined contract rejects foreign keys, endpoint table and SQLite syntax', () => {
  const original = artifacts.get('W05')
  try {
    artifacts.set('W05', original.replace(
      'relationship_id TEXT PRIMARY KEY NOT NULL,',
      'relationship_id TEXT PRIMARY KEY NOT NULL REFERENCES contents(id),'
    ))
    assert.throws(() => verifyCombinedSchemaContract({ contract, inventory, loadArtifact }), /unapproved foreign key/)
    artifacts.set('W05', original.replace(
      'CREATE TABLE social_notifications (',
      'CREATE TABLE notification_push_endpoints ('
    ))
    assert.throws(() => verifyCombinedSchemaContract({ contract, inventory, loadArtifact }), /tables count drift|D1-03\/W09 endpoint/)
    artifacts.set('W05', original.replace('BEGIN;', 'PRAGMA foreign_keys=ON;\nBEGIN;'))
    assert.throws(() => verifyCombinedSchemaContract({ contract, inventory, loadArtifact }), /SQLite-only syntax/)
  } finally { artifacts.set('W05', original) }
})

test('combined contract rejects cross-owner object name collisions', () => {
  const original = artifacts.get('W05')
  try {
    artifacts.set('W05', original.replace('CREATE UNIQUE INDEX uq_social_follow_follower_target','CREATE UNIQUE INDEX contents_state_idx'))
    assert.throws(() => verifyCombinedSchemaContract({ contract, inventory, loadArtifact }), /cross-owner duplicate explicitIndexes/)
  } finally { artifacts.set('W05', original) }
})

test('combined contract rejects source inventory count drift', () => {
  const invalid = clone(inventory)
  invalid.owners.find((item) => item.worker === 'W03').sqlMigrations.pop()
  assert.throws(() => verifyCombinedSchemaContract({ contract, inventory:invalid, loadArtifact }), /migration source inventory drift/)
})
