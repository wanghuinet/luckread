#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..')

const paths = {
  featureInventory: 'contracts/alignment/feature-inventory.v1.json',
  capabilityRegistry: 'contracts/capability/reconciliation-batches/V-governance-appeals.v1.json',
  sourceApiInventory: 'contracts/api/api-inventory.v1.json',
  generatedApiInventory: 'contracts/alignment/api-inventory.v1.json',
  codeEvidence: 'contracts/alignment/code-evidence-inventory.v1.json',
}

const expectedGovernanceFeatures = {
  'GOV-001': 'report',
  'GOV-002': 'report evidence',
  'GOV-003': 'moderation queue',
  'GOV-004': 'enforcement case',
  'GOV-005': 'appeal',
  'GOV-006': 'policy versioning',
  'GOV-007': 'community guidelines',
  'GOV-008': 'creator policy',
  'GOV-009': 'advertising policy',
  'GOV-010': 'transparency/audit reporting',
}

const expectedOperationFeatureIds = {
  listModerationCases: ['GOV-003'],
  listModerationQueue: ['GOV-003'],
  getModerationCase: ['GOV-004'],
  decideModerationCase: ['GOV-004'],
  createReport: ['GOV-001', 'GOV-002'],
  createAppeal: ['GOV-005'],
}

const expectedOperationSchemaRefs = {
  listModerationCases: '',
  listModerationQueue: 'contracts/api/moderation-operation-policy.v1.json#/operations/0',
  getModerationCase: 'contracts/api/moderation-operation-policy.v1.json#/operations/1',
  decideModerationCase: 'contracts/api/moderation-operation-policy.v1.json#/operations/2',
  createReport: 'contracts/api/report-appeal.v1.json#/operations/0',
  createAppeal: 'contracts/api/report-appeal.v1.json#/operations/1',
}

const fail = (message) => {
  throw new Error(message)
}

function readJson(readSource, relativePath) {
  const raw = readSource(relativePath)
  if (typeof raw !== 'string') fail(`Missing governance feature-mapping source: ${relativePath}`)
  try {
    return JSON.parse(raw)
  } catch (error) {
    fail(`Invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function sameArray(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
}

export function verifyGovernanceFeatureIdAlignment({
  readSource = (relativePath) => {
    try {
      return readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
    } catch {
      return null
    }
  },
} = {}) {
  const featureInventory = readJson(readSource, paths.featureInventory)
  const capabilityRegistry = readJson(readSource, paths.capabilityRegistry)
  const sourceApiInventory = readJson(readSource, paths.sourceApiInventory)
  const generatedApiInventory = readJson(readSource, paths.generatedApiInventory)
  const codeEvidence = readJson(readSource, paths.codeEvidence)

  const canonicalFeatures = new Map(
    (featureInventory.features ?? []).map((feature) => [feature.featureId, feature.name]),
  )
  for (const [featureId, expectedName] of Object.entries(expectedGovernanceFeatures)) {
    if (canonicalFeatures.get(featureId) !== expectedName) {
      fail(`Blueprint feature inventory mismatch for ${featureId}: expected '${expectedName}', got '${canonicalFeatures.get(featureId) ?? 'missing'}'`)
    }
  }

  const capabilityRecords = capabilityRegistry.records ?? []
  for (const [featureId, expectedName] of Object.entries(expectedGovernanceFeatures)) {
    const matches = capabilityRecords.filter((record) => record.featureId === featureId)
    if (matches.length !== 1) fail(`Governance capability registry must contain exactly one ${featureId} record; got ${matches.length}`)
    if (matches[0].name !== expectedName) {
      fail(`Governance capability name drift for ${featureId}: expected '${expectedName}', got '${matches[0].name}'`)
    }
    if (matches[0].reconciliationState !== 'BLUEPRINT_ONLY' || matches[0].admissionState !== null) {
      fail(`Governance reconciliation ${featureId} must remain BLUEPRINT_ONLY until independent evidence is admitted`)
    }
  }
  if (capabilityRegistry.status !== 'NOT_GREEN') {
    fail('Governance capability registry must remain NOT_GREEN; feature-name reconciliation is not implementation evidence')
  }

  const sourceMap = sourceApiInventory.operation_feature_map ?? {}
  for (const [operationId, expectedFeatureIds] of Object.entries(expectedOperationFeatureIds)) {
    const mapping = sourceMap[operationId]
    if (!mapping || !sameArray(mapping.feature_ids, expectedFeatureIds)) {
      fail(`Canonical API feature map mismatch for ${operationId}: expected [${expectedFeatureIds.join(', ')}]`)
    }
    if (typeof mapping.schema_ref !== 'string') {
      fail(`Canonical API feature map ${operationId} must declare schema_ref as a string`)
    }
    if (mapping.schema_ref !== expectedOperationSchemaRefs[operationId]) {
      fail(`Canonical API schemaRef mismatch for ${operationId}: expected '${expectedOperationSchemaRefs[operationId]}'`)
    }
  }

  const expectedApiSources = [
    'contracts/openapi/v1/openapi.yaml',
    'contracts/api/api-inventory.v1.json',
    paths.featureInventory,
  ]
  if (generatedApiInventory.sourceOfTruth !== expectedApiSources.join(' + ')) {
    fail('Generated API inventory sourceOfTruth must include OpenAPI, API inventory, and canonical feature inventory')
  }

  const generatedByOperation = new Map(
    (generatedApiInventory.records ?? []).map((record) => [record.operationId, record]),
  )
  for (const [operationId, expectedFeatureIds] of Object.entries(expectedOperationFeatureIds)) {
    const sourceMapping = sourceMap[operationId]
    const generated = generatedByOperation.get(operationId)
    if (!generated) fail(`Generated API alignment inventory is missing ${operationId}`)
    if (!sameArray(generated.featureIds, expectedFeatureIds)) {
      fail(`Generated API inventory did not preserve the feature IDs for ${operationId}`)
    }
    if (generated.schemaRef !== sourceMapping.schema_ref) {
      fail(`Generated API inventory schemaRef drift for ${operationId}`)
    }
    if (!generated.sourceRefs?.includes(paths.featureInventory)) {
      fail(`Generated API inventory for ${operationId} must retain the canonical feature inventory source reference`)
    }
  }

  const appealEvidence = (codeEvidence.records ?? []).filter(
    (record) => record.evidenceId === 'API_OPERATION:createAppeal',
  )
  if (appealEvidence.length !== 1) fail('Code evidence inventory must contain exactly one createAppeal record')
  const appeal = appealEvidence[0]
  if (appeal.implementationStatus !== 'UNRESOLVED' ||
      (appeal.implementationRefs ?? []).length !== 0 ||
      (appeal.testRefs ?? []).length !== 0 ||
      (appeal.schemaEvidenceRefs ?? []).length !== 0) {
    fail('Feature-ID mapping must not promote createAppeal to implemented or schema-admitted without executable evidence')
  }

  return {
    governanceFeaturesChecked: Object.keys(expectedGovernanceFeatures).length,
    apiOperationsMapped: Object.keys(expectedOperationFeatureIds).length,
    appealFeatureId: 'GOV-005',
    appealImplementationStatus: appeal.implementationStatus,
    capabilityRegistryStatus: capabilityRegistry.status,
    implementationStatusChanged: false,
  }
}

function run() {
  const result = verifyGovernanceFeatureIdAlignment()
  process.stdout.write('GOVERNANCE_FEATURE_ID_ALIGNMENT_PASS ' + JSON.stringify(result) + '\\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
