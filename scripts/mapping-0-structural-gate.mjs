#!/usr/bin/env node
/**
 * Mapping 0 stage gate.
 *
 * GREEN here means structural/contract mapping closure only. It deliberately
 * does not require business implementation, runtime evidence, or executable
 * PASS evidence. Those remain downstream gates.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const featurePath = path.join(root, 'contracts/alignment/feature-inventory.v1.json')
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')

const fail = (message) => failures.push(message)
const failures = []
const readJson = (file) => {
  if (!fs.existsSync(file)) {
    fail(`missing ${path.relative(root, file)}`)
    return null
  }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) {
    fail(`invalid JSON ${path.relative(root, file)}: ${error.message}`)
    return null
  }
}

const featureInventory = readJson(featurePath)
const mapping = readJson(mappingPath)
if (!featureInventory || !mapping) process.exit(1)

const features = Array.isArray(featureInventory.features)
  ? featureInventory.features
  : Array.isArray(featureInventory.records) ? featureInventory.records : []
const expected = features.map((r) => r.featureId).filter(Boolean)
const expectedSet = new Set(expected)
if (expected.length === 0) fail('canonical Feature Inventory is empty')
if (expectedSet.size !== expected.length) fail('canonical Feature Inventory contains duplicate Feature IDs')

const records = Array.isArray(mapping.records) ? mapping.records : []
const byId = new Map()
for (const record of records) {
  if (!record?.featureId) {
    fail('mapping record is missing featureId')
    continue
  }
  if (byId.has(record.featureId)) fail(`duplicate canonical mapping record: ${record.featureId}`)
  byId.set(record.featureId, record)
  if (!expectedSet.has(record.featureId)) fail(`orphan mapping record: ${record.featureId}`)

  for (const field of ['apiOperationIds', 'entityIds', 'payloadCollections', 'codeEvidenceRefs', 'evidence', 'blockers']) {
    if (!Array.isArray(record[field])) fail(`${record.featureId}: ${field} must be an array`)
  }
  if (typeof record.status !== 'string' || record.status.length === 0) fail(`${record.featureId}: status is missing`)
}

const missing = expected.filter((id) => !byId.has(id))
for (const id of missing) fail(`missing canonical mapping record: ${id}`)

const unresolved = records.filter((r) => expectedSet.has(r.featureId) && ['UNRESOLVED', 'BLOCKED', 'PARTIAL', 'MISSING'].includes(r.status)).length
const mapped = records.filter((r) => expectedSet.has(r.featureId) && ['GREEN', 'MAPPED', 'VERIFIED'].includes(r.status)).length

const report = {
  gate: 'MAPPING-0-STRUCTURAL',
  status: failures.length ? 'NOT_GREEN' : 'GREEN',
  canonicalFeatureCount: expectedSet.size,
  mappingRecordCount: records.length,
  missingRecordCount: missing.length,
  orphanRecordCount: records.filter((r) => !expectedSet.has(r.featureId)).length,
  unresolvedDownstreamGapCount: unresolved,
  structurallyMappedCount: mapped,
  canonicalGraphStatus: mapping.status ?? 'missing',
  note: 'A GREEN structural Mapping 0 does not promote implementation/runtime/test evidence. Downstream gaps remain explicit and must be closed in later stages.'
}

console.log(JSON.stringify(report, null, 2))
if (failures.length) {
  console.error('\nMAPPING_0_STRUCTURAL_NOT_GREEN')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nMAPPING_0_STRUCTURAL_GREEN')
