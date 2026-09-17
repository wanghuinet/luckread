#!/usr/bin/env node
/**
 * Materialize one canonical Mapping 0 record for every Feature Inventory ID.
 *
 * This script is deliberately non-inferential: existing mapping records are
 * preserved byte-for-byte at the object level, while missing canonical feature
 * IDs receive explicit UNRESOLVED records. No API/entity/persistence/code/test
 * mapping is invented here. Downstream reconciliation owns those facts.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const featurePath = path.join(root, 'contracts/alignment/feature-inventory.v1.json')
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const featureInventory = readJson(featurePath)
const mapping = readJson(mappingPath)

const features = Array.isArray(featureInventory.features)
  ? featureInventory.features
  : Array.isArray(featureInventory.records) ? featureInventory.records : []
const expectedIds = features.map((feature) => feature?.featureId).filter(Boolean)
const expectedSet = new Set(expectedIds)
if (expectedIds.length === 0 || expectedSet.size !== expectedIds.length) {
  throw new Error('Feature Inventory must contain a non-empty unique canonical featureId set')
}

if (!Array.isArray(mapping.records)) {
  throw new Error('cross-system-mapping.v1.json must contain records[]')
}

const existingIds = new Set()
for (const record of mapping.records) {
  if (!record?.featureId) throw new Error('Existing mapping record is missing featureId')
  if (existingIds.has(record.featureId)) throw new Error(`Duplicate existing mapping record: ${record.featureId}`)
  existingIds.add(record.featureId)
}

const missing = expectedIds.filter((id) => !existingIds.has(id))
if (missing.length === 0) {
  console.log(JSON.stringify({ status: 'NO_CHANGE', canonicalFeatureCount: expectedSet.size, mappingRecordCount: mapping.records.length, missingRecordCount: 0 }, null, 2))
  process.exit(0)
}

const unresolvedRecord = (featureId) => ({
  featureId,
  status: 'UNRESOLVED',
  apiOperationIds: [],
  entityIds: [],
  payloadCollections: [],
  codeEvidenceRefs: [],
  evidence: ['docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md'],
  blockers: [
    'Canonical Mapping record is materialized; API/Entity/Field/Persistence/Runtime mapping remains unresolved and must be closed in downstream reconciliation.'
  ]
})

mapping.records.push(...missing.map(unresolvedRecord))
mapping.status = 'NOT_GREEN'
mapping.generatedBy = 'scripts/materialize-canonical-mapping.mjs'
mapping.sourceOfTruth = 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md + contracts/alignment/feature-inventory.v1.json'

fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8')

console.log(JSON.stringify({
  status: 'MATERIALIZED',
  canonicalFeatureCount: expectedSet.size,
  previousMappingRecordCount: existingIds.size,
  addedUnresolvedRecordCount: missing.length,
  mappingRecordCount: mapping.records.length,
  remainingCanonicalMissingCount: 0
}, null, 2))
