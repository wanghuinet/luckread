import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyW09D103OwnerReconciliation } from './verify-d1-03-w09-owner-reconciliation.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const readSource = (relativePath) => {
  try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
}

function readWithOverrides(overrides) {
  return (relativePath) => {
    if (Object.hasOwn(overrides, relativePath)) return overrides[relativePath]
    return readSource(relativePath)
  }
}

function jsonOverride(pathName, mutate) {
  const value = JSON.parse(readSource(pathName))
  mutate(value)
  return JSON.stringify(value)
}

test('reconciles all W09 D1-03 logical owners into admitted or explicitly deferred schema entities', () => {
  const result = verifyW09D103OwnerReconciliation({ readSource })
  assert.equal(result.logicalOwnerEntities, 5)
  assert.deepEqual(result.admittedPhysicalSchemaEntities, ['AuditEvent', 'NotificationPushEndpoint'])
  assert.deepEqual(result.deferredPhysicalSchemaEntities, [
    'PlatformRuntime',
    'ReconciliationOperation',
    'RecoveryOperation',
  ])
  assert.equal(result.unclassifiedEntities, 0)
  assert.equal(result.inventedTables, 0)
  assert.equal(result.remoteNeonDdlExecuted, false)
})

test('fails closed when a W09 logical owner is omitted from the reconciliation manifest', () => {
  const override = jsonOverride('contracts/transport/d1-03-entity-owner-boundary.v1.json', (value) => {
    value.owners.W09.push('UnclassifiedW09Entity')
  })
  assert.throws(() => verifyW09D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/transport/d1-03-entity-owner-boundary.v1.json': override,
    }),
  }), /W09 logical owner entities are not completely classified/)
})

test('fails closed when an unadmitted W09 entity is added to the physical schema contract', () => {
  const override = jsonOverride('contracts/database/neon-d1-03-w09-platform-schema.v1.json', (value) => {
    value.schema.tables.platform_runtime = { entity: 'PlatformRuntime', columns: [], explicitIndexes: [] }
  })
  assert.throws(() => verifyW09D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/database/neon-d1-03-w09-platform-schema.v1.json': override,
    }),
  }), /W09 physical schema tables contain missing, extra, or unadmitted logical entities/)
})

test('fails closed if a deferred entity starts claiming source-migration evidence', () => {
  const override = jsonOverride('contracts/database/neon-d1-03-w09-owner-reconciliation.v1.json', (value) => {
    value.deferredPhysicalSchemaEntities[0].admissionEvidence.sourceMigration =
      'workers/W09-platform/migrations-d1-03/0002_platform_runtime.sql'
  })
  assert.throws(() => verifyW09D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/database/neon-d1-03-w09-owner-reconciliation.v1.json': override,
    }),
  }), /must not claim unadmitted source or translation evidence/)
})

test('fails closed if an unadmitted entity is removed from the deferred owner set', () => {
  const override = jsonOverride('contracts/database/neon-d1-03-w09-owner-reconciliation.v1.json', (value) => {
    value.deferredPhysicalSchemaEntities =
      value.deferredPhysicalSchemaEntities.filter((entry) => entry.entity !== 'RecoveryOperation')
  })
  assert.throws(() => verifyW09D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/database/neon-d1-03-w09-owner-reconciliation.v1.json': override,
    }),
  }), /W09 admitted and deferred entities must partition the logical owner set exactly once/)
})

test('fails closed if owner reconciliation is changed into a remote or runtime mutation', () => {
  const override = jsonOverride('contracts/database/neon-d1-03-w09-owner-reconciliation.v1.json', (value) => {
    value.safety.remoteNeonDdlExecuted = true
  })
  assert.throws(() => verifyW09D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/database/neon-d1-03-w09-owner-reconciliation.v1.json': override,
    }),
  }), /must remain inventory-only and schema-source-only/)
})
