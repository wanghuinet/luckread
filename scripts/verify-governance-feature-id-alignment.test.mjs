import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyGovernanceFeatureIdAlignment } from './verify-governance-feature-id-alignment.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readSource = (relativePath) => {
  try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
}

function jsonOverride(relativePath, mutate) {
  const value = JSON.parse(readSource(relativePath))
  mutate(value)
  return JSON.stringify(value)
}

function readWithOverrides(overrides) {
  return (relativePath) => Object.hasOwn(overrides, relativePath)
    ? overrides[relativePath]
    : readSource(relativePath)
}

test('aligns GOV feature names and W06 moderation / appeal operations to Blueprint IDs', () => {
  const result = verifyGovernanceFeatureIdAlignment({ readSource })
  assert.equal(result.governanceFeaturesChecked, 10)
  assert.equal(result.apiOperationsMapped, 6)
  assert.equal(result.appealFeatureId, 'GOV-005')
  assert.equal(result.appealImplementationStatus, 'UNRESOLVED')
  assert.equal(result.capabilityRegistryStatus, 'NOT_GREEN')
  assert.equal(result.implementationStatusChanged, false)
})

test('fails closed when the capability registry renames a Blueprint feature', () => {
  const override = jsonOverride('contracts/capability/reconciliation-batches/V-governance-appeals.v1.json', (value) => {
    value.records.find((record) => record.featureId === 'GOV-005').name = 'appeal review'
  })
  assert.throws(() => verifyGovernanceFeatureIdAlignment({
    readSource: readWithOverrides({
      'contracts/capability/reconciliation-batches/V-governance-appeals.v1.json': override,
    }),
  }), /Governance capability name drift for GOV-005/)
})

test('fails closed when createAppeal is mapped to a non-canonical feature', () => {
  const override = jsonOverride('contracts/api/api-inventory.v1.json', (value) => {
    value.operation_feature_map.createAppeal.feature_ids = ['GOV-004']
  })
  assert.throws(() => verifyGovernanceFeatureIdAlignment({
    readSource: readWithOverrides({
      'contracts/api/api-inventory.v1.json': override,
    }),
  }), /Canonical API feature map mismatch for createAppeal/)
})

test('fails closed when the appeal schema reference points to another operation', () => {
  const override = jsonOverride('contracts/api/api-inventory.v1.json', (value) => {
    value.operation_feature_map.createAppeal.schema_ref =
      'contracts/api/report-appeal.v1.json#/operations/0'
  })
  assert.throws(() => verifyGovernanceFeatureIdAlignment({
    readSource: readWithOverrides({
      'contracts/api/api-inventory.v1.json': override,
    }),
  }), /Canonical API schemaRef mismatch for createAppeal/)
})

test('fails closed when generated API alignment output is stale', () => {
  const override = jsonOverride('contracts/alignment/api-inventory.v1.json', (value) => {
    value.records.find((record) => record.operationId === 'createAppeal').featureIds = []
  })
  assert.throws(() => verifyGovernanceFeatureIdAlignment({
    readSource: readWithOverrides({
      'contracts/alignment/api-inventory.v1.json': override,
    }),
  }), /Generated API inventory did not preserve the feature IDs for createAppeal/)
})

test('fails closed if mapping-only work falsely marks Appeal implemented', () => {
  const override = jsonOverride('contracts/alignment/code-evidence-inventory.v1.json', (value) => {
    const record = value.records.find((entry) => entry.evidenceId === 'API_OPERATION:createAppeal')
    record.implementationStatus = 'IMPLEMENTED'
    record.implementationRefs = ['workers/W06-governance/src/moderation-runtime.ts']
  })
  assert.throws(() => verifyGovernanceFeatureIdAlignment({
    readSource: readWithOverrides({
      'contracts/alignment/code-evidence-inventory.v1.json': override,
    }),
  }), /must not promote createAppeal/)
})
