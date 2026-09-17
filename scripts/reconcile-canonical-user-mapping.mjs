#!/usr/bin/env node
/**
 * Reconcile only explicitly verified USER mapping edges into the canonical
 * Mapping registry. No status promotion or runtime evidence is performed.
 * Trigger note: deterministic, non-functional verification rerun.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')
const deltaPath = path.join(root, 'contracts/alignment/mapping-batches/USER-001-006-evidence-bound-mapping-delta-2026-09-17.v1.json')
const deltaRelativePath = 'contracts/alignment/mapping-batches/USER-001-006-evidence-bound-mapping-delta-2026-09-17.v1.json'

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const mapping = readJson(mappingPath)
const delta = readJson(deltaPath)

if (!Array.isArray(mapping.records)) throw new Error('canonical mapping records must be an array')
if (!Array.isArray(delta.features)) throw new Error('USER evidence-bound mapping delta must contain features[]')
if (delta.evidencePolicy !== 'fail-closed; no inference') {
  throw new Error('USER evidence delta does not declare fail-closed/no-inference policy')
}

const verifiedByFeature = new Map()
for (const feature of delta.features) {
  if (!['USER-001', 'USER-006'].includes(feature?.featureId)) continue
  const verified = feature.verified ?? {}
  const apiOperationIds = Array.isArray(verified.apiOperationIds) ? verified.apiOperationIds : []
  const entityIds = Array.isArray(verified.entityIds) ? verified.entityIds : []
  verifiedByFeature.set(feature.featureId, {
    apiOperationIds: [...new Set(apiOperationIds)],
    entityIds: [...new Set(entityIds)],
  })
}

const mappingById = new Map()
for (const record of mapping.records) {
  if (!record?.featureId) continue
  if (mappingById.has(record.featureId)) throw new Error(`duplicate canonical mapping record: ${record.featureId}`)
  mappingById.set(record.featureId, record)
}

const changes = []
for (const [featureId, verified] of verifiedByFeature) {
  const record = mappingById.get(featureId)
  if (!record) throw new Error(`missing canonical mapping record: ${featureId}`)
  if (!Array.isArray(record.apiOperationIds)) throw new Error(`${featureId}: apiOperationIds must be an array`)
  if (!Array.isArray(record.entityIds)) throw new Error(`${featureId}: entityIds must be an array`)
  if (!Array.isArray(record.evidence)) throw new Error(`${featureId}: evidence must be an array`)

  const beforeApis = [...record.apiOperationIds]
  const afterApis = [...new Set([...beforeApis, ...verified.apiOperationIds])]
  if (JSON.stringify(beforeApis) !== JSON.stringify(afterApis)) {
    record.apiOperationIds = afterApis
    changes.push({ featureId, field: 'apiOperationIds', before: beforeApis, after: afterApis })
  }

  const beforeEntities = [...record.entityIds]
  const afterEntities = [...new Set([...beforeEntities, ...verified.entityIds])].sort()
  if (JSON.stringify(beforeEntities) !== JSON.stringify(afterEntities)) {
    record.entityIds = afterEntities
    changes.push({ featureId, field: 'entityIds', before: beforeEntities, after: afterEntities })
  }

  if (!record.evidence.includes(deltaRelativePath)) {
    const beforeEvidence = [...record.evidence]
    record.evidence = [...new Set([...beforeEvidence, deltaRelativePath])]
    changes.push({ featureId, field: 'evidence', before: beforeEvidence, after: record.evidence })
  }
}

if (changes.length > 0) fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`)

console.log(JSON.stringify({
  status: changes.length ? 'ENRICHED_CONTRACT_MAPPING' : 'NO_CHANGE',
  verifiedFeatureCount: verifiedByFeature.size,
  changedEdgeCount: changes.length,
  changes,
  rules: {
    onlyEvidenceDeltaVerifiedEdges: true,
    evidenceDeltaRetainedAsCanonicalSource: true,
    statusUntouched: true,
    dtoPersistenceCodeRuntimeEvidenceUntouched: true,
    noInference: true,
  },
}, null, 2))
