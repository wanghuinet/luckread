#!/usr/bin/env node
/**
 * Mapping 0 — Batch G final sweep (read-only, deterministic).
 *
 * Produces the authoritative orphan / duplicate / non-canonical-scope scan for
 * the Mapping-0 handoff. It NEVER mutates the canonical mapping and NEVER
 * promotes any record. Orphan files and over-scoped reconciliation drafts are
 * reported as informational findings that require a change-control disposition,
 * NOT as canonical mapping corruption.
 *
 * Output: artifacts/mapping-0/batch-g-final-sweep.json + console summary.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const featurePath = path.join(root, 'contracts/alignment/feature-inventory.v1.json')
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')
const batchesDir = path.join(root, 'contracts/alignment/mapping-batches')
const orphanDispositionPath = path.join(root, 'docs/change-control/MAPPING-0-ORPHAN-BATCH-DISPOSITION-REGISTER-2026-09-18.md')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const featureInventory = readJson(featurePath)
const mapping = readJson(mappingPath)
const orphanDispositionText = fs.existsSync(orphanDispositionPath)
  ? fs.readFileSync(orphanDispositionPath, 'utf8')
  : ''

const featureRecords = Array.isArray(featureInventory.features)
  ? featureInventory.features
  : Array.isArray(featureInventory.records) ? featureInventory.records : []
const mappingRecords = Array.isArray(mapping.records) ? mapping.records : []

const canonicalIds = new Set(featureRecords.map((r) => r.featureId).filter(Boolean))
const canonicalByPrefix = {}
for (const id of canonicalIds) {
  const prefix = typeof id === 'string' ? id.replace(/-\d+.*$/, '') : '__INVALID__'
  canonicalByPrefix[prefix] = (canonicalByPrefix[prefix] ?? 0) + 1
}

const referenced = new Set()
for (const record of mappingRecords) {
  for (const ref of (record.evidence ?? [])) referenced.add(path.basename(ref))
}

const files = fs.readdirSync(batchesDir).filter((name) => !name.startsWith('.'))

// Reconciliation range patterns authored by the batch work:
//   single:  PREFIX-001-NNN-real-evidence-reconciliation.v1.md
//   compound: P1-001-N1-P2-001-N2-real-evidence-reconciliation.v1.md
const singleRange = /^([A-Z][A-Z0-9]*)-001-([0-9]{3})-real-evidence-reconciliation\.v1\.md$/
const compoundRange = /^([A-Z][A-Z0-9]*)-001-([0-9]{3})-([A-Z][A-Z0-9]*)-001-([0-9]{3})-real-evidence-reconciliation\.v1\.md$/

const orphanFiles = []
const scopeFindings = []
const referencedFiles = []

for (const name of files) {
  const isReferenced = referenced.has(name)
  if (isReferenced) referencedFiles.push(name)
  else orphanFiles.push(name)

  const single = name.match(singleRange)
  const compound = name.match(compoundRange)
  if (!single && !compound) continue

  const segments = single
    ? [{ prefix: single[1], claimed: parseInt(single[2], 10) }]
    : [
        { prefix: compound[1], claimed: parseInt(compound[2], 10) },
        { prefix: compound[3], claimed: parseInt(compound[4], 10) },
      ]

  for (const { prefix, claimed } of segments) {
    const canonical = canonicalByPrefix[prefix] ?? 0
    if (canonical === 0) {
      scopeFindings.push({ file: name, prefix, canonicalCount: 0, claimedCount: claimed, kind: 'NON_CANONICAL_PREFIX', extra: claimed })
    } else if (claimed > canonical) {
      scopeFindings.push({ file: name, prefix, canonicalCount: canonical, claimedCount: claimed, kind: 'OVER_SCOPE', extra: claimed - canonical })
    }
  }
}

// Duplicate-draft detection: group by normalized base name after stripping
// version/cleanup suffixes, then flag groups with more than one distinct file.
const normalize = (name) => {
  const ext = /(\.md|\.json)$/.exec(name)?.[1] ?? ''
  const base = name.slice(0, name.length - ext.length)
  const stripped = base.replace(/(\.v\d+(?:\.\d+)*|-CLEANUP|-cleanup)$/i, '')
  return stripped + ext
}
const clusters = new Map()
for (const name of files) {
  const base = normalize(name)
  if (!clusters.has(base)) clusters.set(base, [])
  clusters.get(base).push(name)
}
const duplicateClusters = [...clusters.entries()]
  .filter(([, members]) => members.length > 1)
  .map(([base, members]) => ({ base, members: members.sort() }))
  .sort((a, b) => a.base.localeCompare(b.base))

const pendingDispositionCountMatch = orphanDispositionText.match(/`PENDING_CHANGE_CONTROL` remaining:\s*([0-9]+)/)
const pendingDispositionCount = pendingDispositionCountMatch ? Number.parseInt(pendingDispositionCountMatch[1], 10) : null
const orphanGovernanceClosed = orphanFiles.length === 0
  ? true
  : pendingDispositionCount === 0 && /The orphan governance gate is \*\*CLOSED\*\*/i.test(orphanDispositionText)

const report = {
  generatedBys: 'scripts/mapping-0-batch-g-final-sweep.mjs',
  generatedAt: new Date().toISOString(),
  currentCommit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return 'UNKNOWN' } })(),
  canonicalFeatureCount: canonicalIds.size,
  canonicalMappingRecordCount: mappingRecords.length,
  oneToOneAligned: canonicalIds.size === mappingRecords.length
    && mappingRecords.every((r) => canonicalIds.has(r.featureId))
    && mappingRecords.length === new Set(mappingRecords.map((r) => r.featureId)).size,
  batchesFileCount: files.length,
  referencedFileCount: referencedFiles.length,
  orphanFileCount: orphanFiles.length,
  orphanFiles: orphanFiles.slice().sort(),
  nonCanonicalScope: scopeFindings,
  nonCanonicalScopeCount: scopeFindings.length,
  duplicateClusters,
  duplicateClusterCount: duplicateClusters.length,
  orphanGovernance: {
    dispositionRegisterPresent: fs.existsSync(orphanDispositionPath),
    pendingChangeControlCount: pendingDispositionCount,
    closed: orphanGovernanceClosed,
  },
  disposition: orphanGovernanceClosed
    ? 'INFORMATIONAL_READ_ONLY — orphan files are governed by the closed disposition register; canonical mapping remains fail-closed.'
    : 'INFORMATIONAL_READ_ONLY — orphan files and over-scoped drafts require a change-control decision; canonical mapping remains fail-closed.',
}

const outDir = path.join(root, 'artifacts/mapping-0')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'batch-g-final-sweep.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))