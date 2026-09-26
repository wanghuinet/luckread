#!/usr/bin/env node
/**
 * Final fail-closed validator for Mapping 0 Evidence Registry admission.
 * This validator is intentionally stricter than the compatibility checker:
 * GREEN is admissible only when the canonical Mapping 0 graph is GREEN and
 * every canonical Feature has current, executable, active/verified PASS evidence.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const registryPath = path.join(root, 'contracts/evidence/mapping-0-evidence-registry.v1.json')
const schemaPath = path.join(root, 'contracts/evidence/mapping-0-evidence-registry.v1.schema.json')
const featurePath = path.join(root, 'contracts/alignment/feature-inventory.v1.json')
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')

const failures = []
const fail = (message) => failures.push(message)
const readJson = (file) => {
  if (!fs.existsSync(file)) {
    fail(`missing ${path.relative(root, file)}`)
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`invalid JSON ${path.relative(root, file)}: ${error.message}`)
    return null
  }
}

const registry = readJson(registryPath)
const schema = readJson(schemaPath)
const featureInventory = readJson(featurePath)
const canonicalMapping = readJson(mappingPath)
let currentCommit = ''
try {
  currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch (error) {
  fail(`cannot resolve current commit: ${error.message}`)
}
const hex40 = /^[0-9a-f]{40}$/
const evidenceRegistryRelPath = 'contracts/evidence/mapping-0-evidence-registry.v1.json'
const testedCommit = registry?.testedCommitSha || currentCommit

if (!registry || !schema || !featureInventory || !canonicalMapping) {
  console.error('MAPPING_0_EVIDENCE_FINAL_RED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

if (schema.$id !== 'https://luckread.com/contracts/evidence/mapping-0-evidence-registry.v1.schema.json') {
  fail('canonical registry schema $id mismatch')
}
if (registry.version !== '1.0') fail(`registry version mismatch: ${registry.version ?? 'missing'}`)
if (registry.status !== 'GREEN') fail(`canonical Evidence Registry status is ${registry.status ?? 'missing'}`)
if (!hex40.test(testedCommit)) fail(`invalid testedCommitSha: ${testedCommit ?? 'missing'}`)
if (registry.status === 'GREEN' && !registry.testedCommitSha) fail('GREEN Evidence Registry must declare testedCommitSha')
if (registry.testedCommitSha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', testedCommit, currentCommit], { stdio: 'ignore' })
  } catch {
    fail(`testedCommitSha is not an ancestor of current HEAD: ${testedCommit}`)
  }
  try {
    const changedAfterAnchor = execFileSync('git', ['diff', '--name-only', `${testedCommit}..${currentCommit}`], { encoding: 'utf8' })
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
    for (const file of changedAfterAnchor) {
      if (file !== evidenceRegistryRelPath) fail(`non-registry change after testedCommitSha: ${file}`)
    }
  } catch (error) {
    fail(`cannot validate post-anchor changes: ${error.message}`)
  }
}
if (registry.sourceOfTruth !== 'docs/176-EVIDENCE-REGISTRY-ACCEPTANCE-TRACEABILITY-CONTRACT-v1.0.md') fail('registry sourceOfTruth mismatch')
if (canonicalMapping.status !== 'GREEN') fail(`canonical Mapping 0 status is ${canonicalMapping.status ?? 'missing'}`)
if (!Array.isArray(registry.records) || registry.records.length === 0) fail('canonical Evidence Registry must contain non-empty records')

const features = Array.isArray(featureInventory.features)
  ? featureInventory.features
  : Array.isArray(featureInventory.records)
    ? featureInventory.records
    : []
if (features.length === 0) fail('canonical Feature Inventory is empty')
const featureIds = new Set(features.map((feature) => feature.featureId).filter(Boolean))

const mappingRecords = Array.isArray(canonicalMapping.records) ? canonicalMapping.records : []
const mappingByFeature = new Map()
for (const record of mappingRecords) {
  const list = mappingByFeature.get(record.featureId) ?? []
  list.push(record)
  mappingByFeature.set(record.featureId, list)
}
for (const featureId of featureIds) {
  const records = mappingByFeature.get(featureId) ?? []
  if (records.length === 0) fail(`canonical Feature is absent from Mapping 0: ${featureId}`)
  for (const record of records) {
    if (record.status !== 'GREEN') fail(`canonical Feature is not GREEN: ${featureId} -> ${record.status ?? 'missing'}`)
    if (Array.isArray(record.blockers) && record.blockers.length > 0) fail(`canonical Feature retains blockers: ${featureId}`)
  }
}

const evidenceIds = new Set()
const claims = new Map()
const results = new Set(['PASS'])
const activeStatuses = new Set(['ACTIVE', 'VERIFIED'])
const historicalStatuses = new Set(['SUPERSEDED', 'EXPIRED', 'INVALIDATED'])
const executableTypes = new Set(['CODE', 'UNIT_TEST', 'INTEGRATION_TEST', 'CL', 'CI', 'SMOKE', 'DEPLOYMENT', 'OBSERVABILITY', 'PERFORMANCE', 'SECURITY', 'USER_ACCEPTANCE'])

const cleanSourceRef = (sourceRef) => sourceRef
  .replace(/#L\d+(?:-L\d+)?$/, '')
  .replace(/:L\d+(?:-L\d+)?$/, '')

const sourceRefResolvable = (sourceRef) => {
  if (typeof sourceRef !== 'string' || sourceRef.length === 0) return false
  if (/^https?:\/\//.test(sourceRef)) return true
  const clean = cleanSourceRef(sourceRef)
  const allowed = ['contracts/', 'docs/', 'scripts/', 'src/', 'tests/', '.github/', 'artifacts/']
  if (!allowed.some((prefix) => clean.startsWith(prefix))) return false
  return fs.existsSync(path.join(root, clean))
}

for (const record of registry.records) {
  if (!record || typeof record !== 'object') {
    fail('evidence record must be an object')
    continue
  }
  const required = ['evidenceId', 'type', 'claimId', 'subjectType', 'subjectId', 'source', 'sourceRef', 'commitSha', 'timestamp', 'producer', 'result', 'status']
  for (const field of required) {
    if (typeof record[field] !== 'string' || record[field].length === 0) fail(`missing required field: ${field}`)
  }

  if (evidenceIds.has(record.evidenceId)) fail(`duplicate evidenceId: ${record.evidenceId}`)
  evidenceIds.add(record.evidenceId)
  if (!featureIds.has(record.subjectId)) fail(`evidence references non-canonical Feature: ${record.evidenceId} -> ${record.subjectId}`)
  if (!hex40.test(record.commitSha ?? '')) fail(`invalid commitSha: ${record.evidenceId}`)
  if (Number.isNaN(Date.parse(record.timestamp ?? ''))) fail(`invalid timestamp: ${record.evidenceId}`)

  const isHistorical = historicalStatuses.has(record.status)
  if (!isHistorical) {
    if (record.commitSha !== testedCommit) fail(`stale evidence commit: ${record.evidenceId}`)
    if (!results.has(record.result)) fail(`evidence result must be PASS: ${record.evidenceId}`)
    if (!activeStatuses.has(record.status)) fail(`evidence must be ACTIVE or VERIFIED: ${record.evidenceId}`)
    if (!executableTypes.has(record.type)) fail(`evidence type is not executable: ${record.evidenceId}`)
    if (!sourceRefResolvable(record.sourceRef)) fail(`sourceRef is not resolvable: ${record.evidenceId}`)
  } else if (!record.sourceRef) {
    fail(`historical evidence is missing sourceRef: ${record.evidenceId}`)
  }

  // Only current ACTIVE/VERIFIED evidence participates in claim-level PASS admission.
  if (activeStatuses.has(record.status)) {
    const claimKey = `${record.subjectId}::${record.claimId}`
    const list = claims.get(claimKey) ?? []
    list.push(record)
    claims.set(claimKey, list)
  }
}

for (const featureId of featureIds) {
  const featureEvidence = registry.records.filter((record) => record?.subjectId === featureId)
  if (featureEvidence.length === 0) {
    fail(`Feature has no evidence records: ${featureId}`)
    continue
  }
  const executablePass = featureEvidence.some((record) =>
    executableTypes.has(record.type) &&
    record.result === 'PASS' &&
    activeStatuses.has(record.status) &&
    record.commitSha === testedCommit
  )
  if (!executablePass) fail(`Feature has no current executable PASS evidence: ${featureId}`)
}

for (const [claimKey, records] of claims) {
  if (!records.some((record) => executableTypes.has(record.type) && activeStatuses.has(record.status) && record.result === 'PASS' && record.commitSha === currentCommit)) {
    fail(`claim has no current executable PASS evidence: ${claimKey}`)
  }
}

if (failures.length) {
  console.error('MAPPING_0_EVIDENCE_FINAL_RED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`MAPPING_0_EVIDENCE_FINAL_GREEN: records=${registry.records.length}; features=${featureIds.size}; claims=${claims.size}; testedCommit=${testedCommit}; head=${currentCommit}`)
