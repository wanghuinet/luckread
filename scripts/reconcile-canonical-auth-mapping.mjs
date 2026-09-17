#!/usr/bin/env node
/**
 * Deterministically enrich canonical AUTH-002..006 mapping records from the
 * already-frozen AUTH-002..006 persistence/API/entity/field contract.
 *
 * This step is contract reconciliation only. It MUST NOT:
 * - infer API operation IDs that are not already canonical;
 * - infer physical D1 table/column names;
 * - promote status to GREEN;
 * - create runtime/code/test evidence;
 * - alter existing non-entity mapping fields.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')
const bindingPath = path.join(root, 'contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const mapping = readJson(mappingPath)
const binding = readJson(bindingPath)

if (!Array.isArray(mapping.records)) throw new Error('canonical mapping records must be an array')
if (!Array.isArray(binding.bindings)) throw new Error('AUTH-002..006 binding records must be an array')

const targetIds = ['AUTH-002', 'AUTH-003', 'AUTH-004', 'AUTH-005', 'AUTH-006']
const target = new Set(targetIds)
const bindingById = new Map()

for (const record of binding.bindings) {
  if (!target.has(record?.featureId)) continue
  if (bindingById.has(record.featureId)) throw new Error(`duplicate binding: ${record.featureId}`)
  if (!Array.isArray(record.entityRefs)) throw new Error(`${record.featureId}: entityRefs must be an array`)
  bindingById.set(record.featureId, record)
}

const mappingById = new Map()
for (const record of mapping.records) {
  if (!record?.featureId) continue
  if (mappingById.has(record.featureId)) throw new Error(`duplicate canonical mapping record: ${record.featureId}`)
  mappingById.set(record.featureId, record)
}

const changes = []
for (const featureId of targetIds) {
  const mappingRecord = mappingById.get(featureId)
  const bindingRecord = bindingById.get(featureId)
  if (!mappingRecord) throw new Error(`missing canonical mapping record: ${featureId}`)
  if (!bindingRecord) throw new Error(`missing frozen binding contract: ${featureId}`)
  if (!Array.isArray(mappingRecord.entityIds)) throw new Error(`${featureId}: entityIds must be an array`)

  const before = [...mappingRecord.entityIds]
  const after = [...new Set([...before, ...bindingRecord.entityRefs])].sort()
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    mappingRecord.entityIds = after
    changes.push({ featureId, before, after })
  }
}

if (changes.length > 0) {
  fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`)
}

console.log(JSON.stringify({
  status: changes.length ? 'ENRICHED_CONTRACT_MAPPING' : 'NO_CHANGE',
  targetFeatureCount: targetIds.length,
  enrichedFeatureCount: changes.length,
  changes,
  rules: {
    canonicalApiIdsUntouched: true,
    physicalPersistenceNamesUntouched: true,
    runtimeEvidenceUntouched: true,
    statusUntouched: true,
    noInference: true,
  },
}, null, 2))
