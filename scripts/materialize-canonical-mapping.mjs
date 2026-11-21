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

// Derive top-level metadata deterministically. Existing records (including any
// evidence references attached by downstream reconciliation) are preserved
// byte-for-byte at the object level; this script never invents API/entity/
// field/persistence/payload/code evidence.
const BLOCKING_STATUS = new Set(['MISSING', 'EXTRA', 'DRIFT', 'CONFLICT', 'DUPLICATE', 'UNRESOLVED', 'BLOCKED', 'PARTIAL'])
const blockingCount = mapping.records.filter((record) => BLOCKING_STATUS.has(record.status) || (record.blockers ?? []).length > 0).length

const output = {
  version: mapping.version ?? '1.0.0',
  status: blockingCount === 0 ? 'GREEN' : 'NOT_GREEN',
  sourceOfTruth: 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md + contracts/alignment/feature-inventory.v1.json',
  generatedBy: 'scripts/materialize-canonical-mapping.mjs',
  generatedDeterministically: true,
  recordCount: mapping.records.length,
  blockers: Array.isArray(mapping.blockers) && mapping.blockers.length
    ? mapping.blockers
    : (blockingCount ? [`Canonical mapping is NOT_GREEN: ${blockingCount} Feature IDs retain blocking status or explicit blockers.`] : []),
  records: mapping.records,
}

fs.writeFileSync(mappingPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')

console.log(JSON.stringify({
  status: missing.length ? 'MATERIALIZED' : 'NO_CHANGE',
  canonicalFeatureCount: expectedSet.size,
  previousMappingRecordCount: existingIds.size,
  addedUnresolvedRecordCount: missing.length,
  mappingRecordCount: mapping.records.length,
  remainingCanonicalMissingCount: 0,
  blockingRecordCount: blockingCount
}, null, 2))
