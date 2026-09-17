#!/usr/bin/env node
/**
 * Mapping 0 R4 evidence-gap report.
 *
 * Joins only explicit repository mappings. It never infers Feature→Entity or
 * Entity→Persistence relationships. The report is advisory and exits 0 so CI
 * can preserve the artifact even when the authoritative R4 gate is red.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const featurePath = path.join(root, 'contracts/alignment/feature-inventory.v1.json')
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')
const persistencePath = path.join(root, 'contracts/alignment/database-entity-persistence-inventory.v1.json')
const outPath = path.join(root, 'artifacts/mapping-0/r4-evidence-gap-report.json')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const featureInventory = readJson(featurePath)
const canonicalMapping = readJson(mappingPath)
const persistenceInventory = readJson(persistencePath)

const features = Array.isArray(featureInventory.features)
  ? featureInventory.features
  : Array.isArray(featureInventory.records)
    ? featureInventory.records
    : []

const mappings = new Map((canonicalMapping.records ?? []).map((record) => [record.featureId, record]))
const entities = new Map((persistenceInventory.records ?? []).map((record) => [record.entityId, record]))

const rows = features.map((feature) => {
  const mapping = mappings.get(feature.featureId)
  const entityIds = [...(mapping?.entityIds ?? [])]
  const entityEvidence = entityIds.flatMap((entityId) => {
    const entity = entities.get(entityId)
    return entity ? [{
      entityId,
      entityStatus: entity.entityStatus,
      persistenceStatus: entity.persistenceStatus,
      migrationRefs: entity.migrationRefs ?? [],
      evidenceRefs: entity.evidenceRefs ?? [],
    }] : [{
      entityId,
      entityStatus: 'UNRESOLVED_ENTITY_REFERENCE',
      persistenceStatus: 'UNRESOLVED_ENTITY_REFERENCE',
      migrationRefs: [],
      evidenceRefs: [],
    }]
  })

  const blockers = []
  if (!mapping) blockers.push('MISSING_CANONICAL_FEATURE_MAPPING')
  if (mapping?.status === 'UNRESOLVED' || mapping?.status === 'BLOCKED') blockers.push(`CANONICAL_MAPPING_STATUS_${mapping.status}`)
  if (entityIds.length === 0) blockers.push('ENTITY_BINDING_NOT_ESTABLISHED')
  for (const entity of entityEvidence) {
    if (entity.persistenceStatus !== 'VERIFIED') blockers.push(`PERSISTENCE_NOT_VERIFIED:${entity.entityId}`)
    if (!entity.migrationRefs.length && entity.persistenceStatus !== 'NOT_APPLICABLE') blockers.push(`MIGRATION_EVIDENCE_MISSING:${entity.entityId}`)
  }
  if ((mapping?.blockers ?? []).length) blockers.push(...mapping.blockers.map((value) => `MAPPING_BLOCKER:${value}`))

  return {
    featureId: feature.featureId,
    mappingStatus: mapping?.status ?? 'MISSING',
    entityIds,
    entityEvidence,
    evidenceRefs: [...(mapping?.evidence ?? [])].sort(),
    blockers: [...new Set(blockers)].sort(),
    closure: blockers.length === 0 ? 'READY_FOR_R4_VALIDATION' : 'BLOCKED_NOT_GREEN',
  }
})

const counts = rows.reduce((acc, row) => {
  acc.total += 1
  if (row.closure === 'READY_FOR_R4_VALIDATION') acc.ready += 1
  else acc.blocked += 1
  if (row.entityIds.length === 0) acc.missingEntityBinding += 1
  if (row.entityEvidence.some((entity) => entity.persistenceStatus !== 'VERIFIED')) acc.persistenceNotVerified += 1
  return acc
}, { total: 0, ready: 0, blocked: 0, missingEntityBinding: 0, persistenceNotVerified: 0 })

const report = {
  version: '1.0',
  status: counts.blocked === 0 ? 'READY_FOR_R4_VALIDATION' : 'NOT_GREEN',
  sourceOfTruth: 'docs/00-LUCKREAD-ULTIMATE-FEATURE-BLUEPRINT-v2.0.md',
  inputs: {
    featureInventory: 'contracts/alignment/feature-inventory.v1.json',
    canonicalMapping: 'contracts/alignment/cross-system-mapping.v1.json',
    persistenceInventory: 'contracts/alignment/database-entity-persistence-inventory.v1.json',
  },
  noInference: true,
  counts,
  records: rows,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`R4_EVIDENCE_GAP_REPORT: ${report.status}; total=${counts.total}; ready=${counts.ready}; blocked=${counts.blocked}; missing-entity-binding=${counts.missingEntityBinding}; persistence-not-verified=${counts.persistenceNotVerified}`)
