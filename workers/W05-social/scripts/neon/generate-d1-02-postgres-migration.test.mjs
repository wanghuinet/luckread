import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildW05PostgresMigration } from './generate-d1-02-postgres-migration.mjs'

const root = process.cwd()
const inventory = JSON.parse(readFileSync(path.join(root, 'contracts/database/neon-d1-02-schema-sources.v1.json'), 'utf8'))
const socialContract = JSON.parse(readFileSync(path.join(root, 'contracts/persistence/SOCIAL-001-follow-relationship-persistence-contract.v1.json'), 'utf8'))
const template = readFileSync(path.join(root, 'workers/W05-social/scripts/neon/templates/d1-02-social-postgres.sql'), 'utf8')

function readSource(relativePath) {
  try { return readFileSync(path.join(root, relativePath), 'utf8') } catch { return null }
}

test('W05 schema source provenance remains pinned while the production runtime uses Neon-only bindings', () => {
  const owner = inventory.owners.find((item) => item.worker === 'W05')
  const d102Source = owner.physicalBindings.find((item) => item.binding === 'DB')
  const d103Source = owner.physicalBindings.find((item) => item.binding === 'D1_03')
  assert.equal(d102Source?.logicalDomain, 'D1-02')
  assert.equal(d102Source?.included, true)
  assert.equal(d103Source?.logicalDomain, 'D1-03')
  assert.equal(d103Source?.included, false)
  assert.equal(d103Source?.reason?.includes('Separate governance/platform domain'), true)

  const config = JSON.parse(readSource(owner.wrangler))
  assert.equal(config.d1_databases?.length ?? 0, 0)
  assert.equal(config.vars?.W05_DATABASE_DRIVER, 'neon')
  assert.equal(config.vars?.W05_PUSH_ENDPOINT_DATABASE_DRIVER, 'neon')
  assert.ok(config.hyperdrive.some((item) => item.binding === 'HYPERDRIVE_D1_02' && item.id === 'c55183e1cc3446409c9c1075832c6615'))
  assert.ok(config.hyperdrive.some((item) => item.binding === 'HYPERDRIVE_D1_03' && item.id === '7c8831416c18494faee04b96aa551cb9'))

  const { sourceReport } = buildW05PostgresMigration({ inventory, socialContract, readSource, template })
  assert.equal(sourceReport.targetDatabase, 'luckreadpro')
  assert.equal(sourceReport.sourceOwner, 'W05')
  assert.equal(sourceReport.migrationCount, 15)
  assert.equal(sourceReport.safety.d1_03SchemaImported, false)
  assert.equal(sourceReport.safety.productionCutoverAuthorized, false)
})

test('W05 migration source set is frozen and fully readable', () => {
  const { sourceReport } = buildW05PostgresMigration({ inventory, socialContract, readSource, template })
  assert.equal(sourceReport.sourceMigrations.length, 15)
  assert.ok(sourceReport.sourceMigrations.every((row) => /^[a-f0-9]{64}$/.test(row.sha256)))
})

test('native schema defines the nineteen final-state W05 tables and thirty-five indexes', () => {
  const { artifact } = buildW05PostgresMigration({ inventory, socialContract, readSource, template })
  assert.equal([...artifact.matchAll(/^CREATE TABLE /gim)].length, 19)
  assert.equal([...artifact.matchAll(/^CREATE (?:UNIQUE )?INDEX /gim)].length, 35)
  assert.equal([...artifact.matchAll(/^CREATE TRIGGER /gim)].length, 1)
})

test('SQLite rebuild migrations are folded into final-state PostgreSQL tables without replay', () => {
  const { artifact } = buildW05PostgresMigration({ inventory, socialContract, readSource, template })
  assert.match(artifact, /target_type TEXT NOT NULL CHECK \(target_type IN \('content', 'comment'\)\)/)
  assert.match(artifact, /'AUTHOR_DELETED'/)
  assert.match(artifact, /duration_minutes INTEGER NOT NULL DEFAULT 1440/)
  assert.doesNotMatch(artifact, /interaction_likes_v2|social_comments_v2|INSERT INTO interaction_likes_v2|INSERT INTO social_comments_v2/)
})

test('W05 notification push delivery retains atomic D1-02 outbox semantics and no D1-03 endpoint table', () => {
  const { artifact } = buildW05PostgresMigration({ inventory, socialContract, readSource, template })
  assert.match(artifact, /CREATE TABLE social_notification_push_outbox/)
  assert.match(artifact, /CREATE TABLE social_notification_push_deliveries/)
  assert.match(artifact, /ON CONFLICT \(notification_id\) DO NOTHING/)
  assert.doesNotMatch(artifact, /CREATE TABLE notification_push_endpoints/)
  assert.doesNotMatch(artifact, /bda1d247-a371-4244-91ae-aef96034db7f|notification_push_endpoints/)
})

test('generator rejects Cloudflare D1 bindings reintroduced into the W05 Neon production config', () => {
  const configPath = inventory.owners.find((item) => item.worker === 'W05').wrangler
  const original = JSON.parse(readSource(configPath))
  const invalidConfig = {
    ...original,
    d1_databases: [{ binding: 'DB', database_name: 'luckreadpro', database_id: '6c342634-97f6-4248-9f4a-85772af4f22c' }],
  }
  const readWithInvalidConfig = (relativePath) =>
    relativePath === configPath ? JSON.stringify(invalidConfig) : readSource(relativePath)
  assert.throws(
    () => buildW05PostgresMigration({ inventory, socialContract, readSource: readWithInvalidConfig, template }),
    /production Wrangler must be D1-free/
  )
})

test('generator rejects a W05 source inventory that imports D1-03 governance tables', () => {
  const invalid = structuredClone(inventory)
  const owner = invalid.owners.find((item) => item.worker === 'W05')
  owner.physicalBindings.find((item) => item.binding === 'D1_03').included = true
  assert.throws(
    () => buildW05PostgresMigration({ inventory: invalid, socialContract, readSource, template }),
    /D1-02 schema source provenance must retain/
  )
})

test('generator rejects foreign keys, SQLite syntax and source inventory drift', () => {
  assert.throws(
    () => buildW05PostgresMigration({
      inventory, socialContract, readSource,
      template: template.replace('relationship_id TEXT PRIMARY KEY NOT NULL,', 'relationship_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),')
    }),
    /no cross-domain or implicit foreign keys/
  )
  assert.throws(
    () => buildW05PostgresMigration({
      inventory, socialContract, readSource,
      template: template.replace('BEGIN;', 'BEGIN;\nPRAGMA foreign_keys=ON;')
    }),
    /SQLite-only syntax/
  )
  assert.throws(
    () => buildW05PostgresMigration({
      inventory,
      socialContract,
      readSource: (relativePath) =>
        relativePath.startsWith(inventory.owners.find((item) => item.worker === 'W05').migrationDirectory + '/')
          ? null
          : readSource(relativePath),
      template,
    }),
    /Missing source migration/
  )
})
