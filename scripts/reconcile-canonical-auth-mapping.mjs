#!/usr/bin/env node
/**
 * Deterministically enrich canonical AUTH mapping records from already-frozen
 * contract sources.
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
const jsonBindingPath = path.join(root, 'contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json')
const auth010BindingPath = path.join(root, 'contracts/alignment/mapping-batches/AUTH-010-session-field-binding.v1.md')
const auth011GatePath = path.join(root, 'contracts/alignment/mapping-batches/AUTH-011-runtime-gate.v1.md')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const readText = (file) => fs.readFileSync(file, 'utf8')
const mapping = readJson(mappingPath)
const jsonBinding = readJson(jsonBindingPath)

if (!Array.isArray(mapping.records)) throw new Error('canonical mapping records must be an array')
if (!Array.isArray(jsonBinding.bindings)) throw new Error('AUTH-002..006 binding records must be an array')

const entityRefsByFeature = new Map()
const addBinding = (featureId, entityRefs, source) => {
  if (!Array.isArray(entityRefs) || entityRefs.length === 0) {
    throw new Error(`${featureId}: ${source} did not expose entity references`)
  }
  if (entityRefs.some((value) => typeof value !== 'string' || !/^ENT-[A-Z0-9-]+$/.test(value))) {
    throw new Error(`${featureId}: ${source} contains invalid entity reference`)
  }
  if (entityRefsByFeature.has(featureId)) throw new Error(`duplicate contract binding: ${featureId}`)
  entityRefsByFeature.set(featureId, [...new Set(entityRefs)].sort())
}

for (const record of jsonBinding.bindings) {
  if (['AUTH-002', 'AUTH-003', 'AUTH-004', 'AUTH-005', 'AUTH-006'].includes(record?.featureId)) {
    addBinding(record.featureId, record.entityRefs, 'AUTH-002..006 persistence/API/entity/field contract')
  }
}

const auth010Text = readText(auth010BindingPath)
const auth010Entity = auth010Text.match(/- Entity:\s+`(ENT-[A-Z0-9-]+)`/)
if (!auth010Entity) throw new Error('AUTH-010 field binding did not expose an Entity reference')
addBinding('AUTH-010', [auth010Entity[1]], 'AUTH-010 session field binding')

const auth011Text = readText(auth011GatePath)
const requiredChain = auth011Text.match(/## Required contract chain\n\n([^\n]+)/)?.[1] ?? ''
const auth011Entities = [...new Set(requiredChain.match(/ENT-[A-Z0-9-]+/g) ?? [])]
if (auth011Entities.length === 0) throw new Error('AUTH-011 runtime gate did not expose entity references in the required contract chain')
addBinding('AUTH-011', auth011Entities, 'AUTH-011 runtime gate required contract chain')

const mappingById = new Map()
for (const record of mapping.records) {
  if (!record?.featureId) continue
  if (mappingById.has(record.featureId)) throw new Error(`duplicate canonical mapping record: ${record.featureId}`)
  mappingById.set(record.featureId, record)
}

const changes = []
for (const [featureId, entityRefs] of entityRefsByFeature) {
  const mappingRecord = mappingById.get(featureId)
  if (!mappingRecord) throw new Error(`missing canonical mapping record: ${featureId}`)
  if (!Array.isArray(mappingRecord.entityIds)) throw new Error(`${featureId}: entityIds must be an array`)

  const before = [...mappingRecord.entityIds]
  const after = [...new Set([...before, ...entityRefs])].sort()
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
  targetFeatureCount: entityRefsByFeature.size,
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
