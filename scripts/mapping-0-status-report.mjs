#!/usr/bin/env node
/**
 * Read-only Mapping 0 status report. This never promotes a mapping and never
 * changes canonical status. It summarizes the current evidence closure state
 * so each verification run has a reproducible progress snapshot.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const files = {
  feature: 'contracts/alignment/feature-inventory.v1.json',
  mapping: 'contracts/alignment/cross-system-mapping.v1.json',
  persistence: 'contracts/capability/feature-entity-persistence-registry.v1.json',
  evidence: 'contracts/evidence/mapping-0-evidence-registry.v1.json',
}
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))

const featureInventory = readJson(files.feature)
const mapping = readJson(files.mapping)
const persistence = readJson(files.persistence)
const evidence = readJson(files.evidence)
const featureRecords = Array.isArray(featureInventory.features)
  ? featureInventory.features
  : Array.isArray(featureInventory.records)
    ? featureInventory.records
    : []
const mappingRecords = Array.isArray(mapping.records) ? mapping.records : []
const persistenceRecords = Array.isArray(persistence.records) ? persistence.records : []
const evidenceRecords = Array.isArray(evidence.records) ? evidence.records : []

const blockingStatuses = new Set(['UNRESOLVED', 'MISSING', 'CONFLICT', 'DUPLICATE', 'DRIFT', 'EXTRA', 'BLOCKED', 'PARTIAL', 'NOT_GREEN'])
const statusCounts = (records) => records.reduce((acc, record) => {
  // Feature inventory uses alignmentState, while mapping/persistence/evidence
  // registries use status. Treat both as first-class status fields so the
  // report does not create false MISSING_STATUS blockers for discovered features.
  const status = record?.status ?? record?.alignmentState ?? 'MISSING_STATUS'
  acc[status] = (acc[status] ?? 0) + 1
  return acc
}, {})

const blockerReasons = mappingRecords.flatMap((record) => (record?.blockers ?? []).map((blocker) => ({
  featureId: record.featureId,
  blocker,
})))
const blockerCounts = blockerReasons.reduce((acc, item) => {
  acc[item.blocker] = (acc[item.blocker] ?? 0) + 1
  return acc
}, {})

let currentCommit = 'UNKNOWN'
try { currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}

const report = {
  generatedAt: new Date().toISOString(),
  currentCommit,
  canonicalMappingStatus: mapping.status ?? 'MISSING',
  canonicalFeatureCount: featureRecords.length,
  canonicalMappingRecordCount: mappingRecords.length,
  canonicalMappingStatusCounts: statusCounts(mappingRecords),
  canonicalBlockingRecordCount: mappingRecords.filter((record) => blockingStatuses.has(record?.status) || (record?.blockers ?? []).length > 0).length,
  featureInventoryStatusCounts: statusCounts(featureRecords),
  persistenceRegistryStatus: persistence.status ?? 'MISSING',
  persistenceRegistryRecordCount: persistenceRecords.length,
  persistenceRegistryStatusCounts: statusCounts(persistenceRecords),
  evidenceRegistryStatus: evidence.status ?? 'MISSING',
  evidenceRegistryRecordCount: evidenceRecords.length,
  evidenceByFeatureCount: new Set(evidenceRecords.map((record) => record?.subjectId).filter(Boolean)).size,
  topBlockerReasons: Object.entries(blockerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([blocker, count]) => ({ blocker, count })),
}

const outDir = path.join(root, 'artifacts/mapping-0')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'mapping-0-status-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))