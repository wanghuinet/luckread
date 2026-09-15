#!/usr/bin/env node
/**
 * Deterministic capability-graph coverage builder.
 *
 * This is a coverage bridge only. It MUST NOT infer API, entity, persistence,
 * permission, lifecycle, event, worker, D1, or implementation evidence.
 * Every generated record therefore remains PROPOSED until those bindings are
 * explicitly contracted in downstream mapping work.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const featureInventoryPath = path.join(root, 'contracts/alignment/feature-inventory.v1.json')
const batchDir = path.join(root, 'contracts/alignment/mapping-batches')
const outputPath = path.join(root, 'contracts/capability/capability-contract-graph.v1.json')

const inventory = JSON.parse(fs.readFileSync(featureInventoryPath, 'utf8'))
const featureIds = (inventory.features ?? []).map((x) => x.featureId).filter(Boolean).sort()

const files = fs.readdirSync(batchDir).filter((name) => name.endsWith('.json')).sort()
const batchRecords = []
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(batchDir, file), 'utf8'))
  for (const record of data.records ?? []) batchRecords.push({ ...record, __batch: file })
}

const byId = new Map()
for (const record of batchRecords) {
  if (!record.featureId) continue
  if (byId.has(record.featureId)) {
    throw new Error(`duplicate feature ownership in mapping batches: ${record.featureId}`)
  }
  byId.set(record.featureId, record)
}

const missing = featureIds.filter((id) => !byId.has(id))
const unknown = [...byId.keys()].filter((id) => !featureIds.includes(id)).sort()
if (missing.length || unknown.length) {
  throw new Error(JSON.stringify({ missing, unknown }, null, 2))
}

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
    ...(source.apiOperationIds?.length ? { apiOperationIds: [...source.apiOperationIds].sort() } : {}),
    ...(source.entityIds?.length ? { domainEntityIds: [...source.entityIds].sort() } : {}),
    evidenceIds: [...(source.evidence ?? [])].sort(),
  }
})

const output = {
  contractVersion: '1.0',
  sourceOfTruth: 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md',
  status: 'NOT_GREEN',
  features,
}

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify({ status: output.status, featureCount: features.length, sourceBatchCount: files.length }, null, 2))
