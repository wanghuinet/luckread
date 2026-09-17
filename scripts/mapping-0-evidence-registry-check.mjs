#!/usr/bin/env node
/**
 * Fail-closed validator for the canonical Mapping 0 Evidence Registry.
 * This checks registry integrity and canonical Feature binding. It never
 * manufactures evidence and intentionally rejects an empty registry.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const registryPath = path.join(root, 'contracts/evidence/mapping-0-evidence-registry.v1.json')
const schemaPath = path.join(root, 'contracts/evidence/mapping-0-evidence-registry.v1.schema.json')
const featurePath = path.join(root, 'contracts/alignment/feature-inventory.v1.json')

const fail = (message) => {
  console.error(`MAPPING_0_EVIDENCE_REGISTRY_BLOCKED: ${message}`)
  process.exit(1)
}
const readJson = (file) => {
  if (!fs.existsSync(file)) fail(`missing ${path.relative(root, file)}`)
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) { fail(`invalid JSON ${path.relative(root, file)}: ${error.message}`) }
}

const registry = readJson(registryPath)
const schema = readJson(schemaPath)
const featureInventory = readJson(featurePath)
const features = Array.isArray(featureInventory.features)
  ? featureInventory.features
  : Array.isArray(featureInventory.records)
    ? featureInventory.records
    : []
const featureIds = new Set(features.map((feature) => feature.featureId).filter(Boolean))

if (schema.$id !== 'https://luckread.com/contracts/evidence/mapping-0-evidence-registry.v1.schema.json') {
  fail('canonical registry schema $id mismatch')
}
if (registry.version !== '1.0') fail(`version mismatch: ${registry.version ?? 'missing'}`)
if (registry.status !== 'NOT_GREEN' && registry.status !== 'GREEN') fail(`invalid registry status: ${registry.status ?? 'missing'}`)
if (registry.sourceOfTruth !== 'docs/176-EVIDENCE-REGISTRY-ACCEPTANCE-TRACEABILITY-CONTRACT-v1.0.md') fail('sourceOfTruth mismatch')
if (!Array.isArray(registry.records)) fail('records must be an array')
if (registry.records.length === 0) fail('canonical Evidence Registry is empty')

const evidenceIds = new Set()
const claims = new Map()
const failures = []
const hex40 = /^[0-9a-f]{40}$/
const types = new Set(['DOCUMENT', 'CODE', 'UNIT_TEST', 'INTEGRATION_TEST', 'CL', 'CI', 'SMOKE', 'DEPLOYMENT', 'OBSERVABILITY', 'PERFORMANCE', 'SECURITY', 'USER_ACCEPTANCE'])
const results = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_APPLICABLE'])
const statuses = new Set(['CREATED', 'VERIFIED', 'ACTIVE', 'SUPERSEDED', 'EXPIRED', 'INVALIDATED'])

for (const record of registry.records) {
  if (!record || typeof record !== 'object') { failures.push('record must be an object'); continue }
  for (const field of ['evidenceId', 'type', 'claimId', 'subjectType', 'subjectId', 'source', 'sourceRef', 'commitSha', 'timestamp', 'producer', 'result', 'status']) {
    if (typeof record[field] !== 'string' || record[field].length === 0) failures.push(`missing required field: ${field}`)
  }
  if (evidenceIds.has(record.evidenceId)) failures.push(`duplicate evidenceId: ${record.evidenceId}`)
  evidenceIds.add(record.evidenceId)
  if (!types.has(record.type)) failures.push(`invalid evidence type: ${record.evidenceId}`)
  if (!featureIds.has(record.subjectId)) failures.push(`evidence subject is not a canonical Feature ID: ${record.evidenceId} -> ${record.subjectId}`)
  if (!hex40.test(record.commitSha ?? '')) failures.push(`commitSha must be 40 lowercase hex chars: ${record.evidenceId}`)
  if (Number.isNaN(Date.parse(record.timestamp ?? ''))) failures.push(`invalid timestamp: ${record.evidenceId}`)
  if (!results.has(record.result)) failures.push(`invalid result: ${record.evidenceId}`)
  if (!statuses.has(record.status)) failures.push(`invalid status: ${record.evidenceId}`)
  const key = `${record.subjectId}::${record.claimId}`
  const list = claims.get(key) ?? []
  list.push(record)
  claims.set(key, list)
}

for (const [key, records] of claims) {
  const hasExecutablePass = records.some((record) => record.result === 'PASS' && record.type !== 'DOCUMENT')
  const hasAnyPass = records.some((record) => record.result === 'PASS')
  if (hasAnyPass && !hasExecutablePass) failures.push(`documentation-only PASS evidence is insufficient: ${key}`)
  if (records.some((record) => record.result === 'PASS') && records.every((record) => ['EXPIRED', 'INVALIDATED', 'SUPERSEDED'].includes(record.status))) {
    failures.push(`PASS claim has no active/verified evidence: ${key}`)
  }
}

if (failures.length) {
  console.error('MAPPING_0_EVIDENCE_REGISTRY_RED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`MAPPING_0_EVIDENCE_REGISTRY_GREEN: records=${registry.records.length}; featureIds=${featureIds.size}; claims=${claims.size}`)
