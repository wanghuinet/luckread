#!/usr/bin/env node
/**
 * Deterministically attach repository-grounded feature evidence references to
 * canonical mapping records.
 *
 * This is reference reconciliation only. It MUST NOT:
 * - infer API, DTO, Entity, Field, Persistence, Worker, D1, Code or Test edges;
 * - infer feature IDs from numeric ranges in filenames;
 * - promote canonical mapping status;
 * - create or alter runtime evidence;
 * - mutate fields other than the canonical mapping `evidence` arrays.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')
const evidenceRoot = path.join(root, 'contracts/alignment/mapping-batches')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const mapping = readJson(mappingPath)

if (!Array.isArray(mapping.records)) throw new Error('canonical mapping records must be an array')

const mappingById = new Map()
for (const record of mapping.records) {
  if (!record?.featureId) continue
  if (mappingById.has(record.featureId)) throw new Error(`duplicate canonical mapping record: ${record.featureId}`)
  mappingById.set(record.featureId, record)
}

const shouldScan = (name) => {
  if (!name.endsWith('.md')) return false
  return /(?:real-evidence-reconciliation|reconciliation\.v1|closure-gate\.v1|field-binding\.v1)/i.test(name)
}

const walk = (dir) => {
  const files = []
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(absolute))
    else if (entry.isFile() && shouldScan(entry.name)) files.push(absolute)
  }
  return files.sort()
}

const featureIdPattern = /(?:^|\n)\s*(?:[-*]|\|)\s*([A-Z][A-Z0-9]*-\d+)\b/g
const explicitFeaturePattern = /(?:Feature|feature):\s*`([A-Z][A-Z0-9]*-\d+)`/g

const refsByFeature = new Map()
const scannedFiles = []
const ignoredNonCanonical = []

for (const absolute of walk(evidenceRoot)) {
  const rel = path.relative(root, absolute).replaceAll(path.sep, '/')
  const text = fs.readFileSync(absolute, 'utf8')
  const ids = new Set()

  for (const match of text.matchAll(featureIdPattern)) ids.add(match[1])
  for (const match of text.matchAll(explicitFeaturePattern)) ids.add(match[1])

  if (ids.size === 0) continue
  scannedFiles.push({ file: rel, extractedFeatureCount: ids.size })

  for (const featureId of [...ids].sort()) {
    if (!mappingById.has(featureId)) {
      ignoredNonCanonical.push({ file: rel, featureId })
      continue
    }
    const refs = refsByFeature.get(featureId) ?? []
    refs.push(rel)
    refsByFeature.set(featureId, refs)
  }
}

const changes = []
for (const [featureId, refs] of [...refsByFeature.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const record = mappingById.get(featureId)
  if (!Array.isArray(record.evidence)) throw new Error(`${featureId}: evidence must be an array`)

  const before = [...record.evidence]
  const after = [...new Set([...before, ...refs])].sort()
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    record.evidence = after
    changes.push({ featureId, field: 'evidence', added: after.filter((ref) => !before.includes(ref)) })
  }
}

if (changes.length > 0) fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`)

console.log(JSON.stringify({
  status: changes.length ? 'ENRICHED_FEATURE_EVIDENCE_REFS' : 'NO_CHANGE',
  scannedFileCount: scannedFiles.length,
  featureCountWithEvidenceSources: refsByFeature.size,
  changedFeatureCount: changes.length,
  ignoredNonCanonicalCount: ignoredNonCanonical.length,
  changes,
  scannedFiles,
  ignoredNonCanonical,
  rules: {
    explicitFeatureIdsOnly: true,
    noFilenameRangeInference: true,
    nonCanonicalIdsIgnoredAndReported: true,
    evidenceFieldOnly: true,
    apiEntityPersistenceWorkerD1CodeTestUntouched: true,
    statusUntouched: true,
    noInference: true,
  },
}, null, 2))
