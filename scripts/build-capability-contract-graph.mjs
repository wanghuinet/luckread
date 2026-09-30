#!/usr/bin/env node
/**
 * Deterministic capability-graph coverage builder.
 *
 * Coverage bridge only. It MUST NOT infer API, entity, persistence,
 * permission, lifecycle, event, worker, D1, or implementation evidence.
 * Every generated record remains PROPOSED until explicitly contracted.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const featureInventoryPath = path.join(root, 'contracts/alignment/feature-inventory.v1.json')
const batchDir = path.join(root, 'contracts/alignment/mapping-batches')
const outputPath = path.join(root, 'contracts/capability/capability-contract-graph.v1.json')

const inventory = JSON.parse(fs.readFileSync(featureInventoryPath, 'utf8'))
const featureIds = (inventory.features ?? []).map((x) => x.featureId).filter(Boolean).sort()
if (featureIds.length === 0) throw new Error('Feature Inventory is empty')

const files = fs.readdirSync(batchDir).filter((name) => name.endsWith('.json')).sort()
const batchRecords = []
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(batchDir, file), 'utf8'))
  for (const record of data.records ?? []) batchRecords.push({ ...record, __batch: file })
}

const byId = new Map()
const duplicate = []
for (const record of batchRecords) {
  if (!record.featureId) continue
  if (byId.has(record.featureId)) {
    duplicate.push(record.featureId)
    continue
  }
  byId.set(record.featureId, record)
}

const canonicalSet = new Set(featureIds)
const unknown = [...byId.keys()].filter((id) => !canonicalSet.has(id)).sort()
const duplicateIds = [...new Set(duplicate)].sort()

const features = featureIds.map((featureId) => {
  const source = byId.get(featureId)
  return {
    featureId,
    hierarchy: { l1: 'PENDING', l2: 'PENDING', l3: 'PENDING', l4: 'PENDING' },
    name: featureId,
    description: 'Coverage-only bridge record. Canonical API/data/security/lifecycle bindings remain downstream work.',
    owner: 'UNASSIGNED_PENDING_CONTRACT',
    status: 'PROPOSED',
    exposure: 'INTERNAL',
    ...(source?.apiOperationIds?.length ? { apiOperationIds: [...source.apiOperationIds].sort() } : {}),
    ...(source?.entityIds?.length ? { domainEntityIds: [...source.entityIds].sort() } : {}),
    evidenceIds: [...(source?.evidence ?? [])].sort(),
  }
})

const output = {
  contractVersion: '1.0',
  sourceOfTruth: 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md',
  status: 'NOT_GREEN',
  coverageOnly: true,
  warnings: { unknownMappingFeatureIds: unknown, duplicateMappingFeatureIds: duplicateIds },
  features,
}

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify({
  status: output.status,
  featureCount: features.length,
  mappedCount: features.filter((x) => byId.has(x.featureId)).length,
  pendingCount: features.filter((x) => !byId.has(x.featureId)).length,
  unknownMappingFeatureIds: unknown.length,
  duplicateMappingFeatureIds: duplicateIds.length,
}, null, 2))
