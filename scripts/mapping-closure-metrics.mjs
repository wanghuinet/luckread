#!/usr/bin/env node
/**
 * Read-only metrics for canonical mapping closure.
 * This script never changes canonical mapping status or data.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')
const featurePath = path.join(root, 'contracts/alignment/feature-inventory.v1.json')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const mapping = readJson(mappingPath)
const inventory = readJson(featurePath)
const records = Array.isArray(mapping.records) ? mapping.records : []
const features = Array.isArray(inventory.features)
  ? inventory.features
  : Array.isArray(inventory.records)
    ? inventory.records
    : []

if (records.length !== features.length) {
  throw new Error(`canonical feature/mapping count mismatch: ${features.length} vs ${records.length}`)
}

const nonEmpty = (record, key) => Array.isArray(record?.[key]) && record[key].length > 0
const count = (key) => records.filter((record) => nonEmpty(record, key)).length
const pct = (value) => Number(((value / records.length) * 100).toFixed(2))

const metrics = {
  canonicalFeatureCount: features.length,
  canonicalMappingRecordCount: records.length,
  canonicalMappingStatus: mapping.status ?? 'MISSING',
  evidenceReferenceCoverage: { count: count('evidence'), percent: pct(count('evidence')) },
  apiOperationEdgeCoverage: { count: count('apiOperationIds'), percent: pct(count('apiOperationIds')) },
  entityEdgeCoverage: { count: count('entityIds'), percent: pct(count('entityIds')) },
  payloadCollectionEdgeCoverage: { count: count('payloadCollections'), percent: pct(count('payloadCollections')) },
  codeEvidenceEdgeCoverage: { count: count('codeEvidenceRefs'), percent: pct(count('codeEvidenceRefs')) },
  fullyTechnicalMappedByCurrentShape: {
    count: records.filter((record) =>
      nonEmpty(record, 'apiOperationIds') &&
      nonEmpty(record, 'entityIds') &&
      nonEmpty(record, 'payloadCollections') &&
      nonEmpty(record, 'codeEvidenceRefs')
    ).length,
  },
  statusCounts: records.reduce((acc, record) => {
    const status = record?.status ?? 'MISSING_STATUS'
    acc[status] = (acc[status] ?? 0) + 1
    return acc
  }, {}),
  rule: 'Metrics are descriptive only; no promotion or inference is performed.',
}

metrics.fullyTechnicalMappedByCurrentShape.percent = pct(metrics.fullyTechnicalMappedByCurrentShape.count)
console.log(JSON.stringify(metrics, null, 2))
