#!/usr/bin/env node
/**
 * Read-only evidence freshness metrics.
 *
 * This reports evidence-record freshness and feature-level freshness coverage
 * without changing evidence status, canonical mapping status, or any contract.
 * Missing/expired evidence is a downstream closure signal, not a Mapping 0
 * structural failure by itself.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const evidenceRoot = path.join(root, 'contracts/evidence')
const now = new Date()

const jsonFiles = []
const walk = (dir) => {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.isFile() && entry.name.endsWith('.json')) jsonFiles.push(full)
  }
}
walk(evidenceRoot)

const records = []
const visit = (value, sourceRef) => {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, sourceRef)
    return
  }
  if (!value || typeof value !== 'object') return

  if ((typeof value.evidenceId === 'string' || typeof value.claimId === 'string') && typeof value.validUntil === 'string') {
    records.push({
      evidenceId: value.evidenceId ?? null,
      claimId: value.claimId ?? null,
      subjectId: value.subjectId ?? value.featureId ?? null,
      status: value.status ?? null,
      result: value.result ?? null,
      validUntil: value.validUntil,
      sourceRef,
    })
  }

  for (const child of Object.values(value)) visit(child, sourceRef)
}

for (const file of jsonFiles) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/')
  try {
    visit(JSON.parse(fs.readFileSync(file, 'utf8')), relative)
  } catch (error) {
    throw new Error(`invalid evidence JSON ${relative}: ${error.message}`)
  }
}

const fresh = []
const expired = []
const invalid = []
for (const record of records) {
  const until = new Date(record.validUntil)
  if (Number.isNaN(until.getTime())) invalid.push(record)
  else if (until < now) expired.push(record)
  else fresh.push(record)
}

expired.sort((a, b) => a.validUntil.localeCompare(b.validUntil))
fresh.sort((a, b) => b.validUntil.localeCompare(a.validUntil))

const featureState = new Map()
for (const record of records) {
  if (typeof record.subjectId !== 'string' || !record.subjectId) continue
  const state = featureState.get(record.subjectId) ?? { fresh: 0, expired: 0, invalid: 0 }
  const until = new Date(record.validUntil)
  if (Number.isNaN(until.getTime())) state.invalid += 1
  else if (until < now) state.expired += 1
  else state.fresh += 1
  featureState.set(record.subjectId, state)
}

const featureIdsWithFreshEvidence = [...featureState.entries()]
  .filter(([, state]) => state.fresh > 0)
  .map(([subjectId]) => subjectId)
  .sort()
const featureIdsWithOnlyExpiredEvidence = [...featureState.entries()]
  .filter(([, state]) => state.fresh === 0 && state.expired > 0 && state.invalid === 0)
  .map(([subjectId]) => subjectId)
  .sort()
const featureIdsWithInvalidEvidenceDate = [...featureState.entries()]
  .filter(([, state]) => state.invalid > 0)
  .map(([subjectId]) => subjectId)
  .sort()

console.log(JSON.stringify({
  evaluatedAt: now.toISOString(),
  evidenceJsonFileCount: jsonFiles.length,
  evidenceRecordCount: records.length,
  freshCount: fresh.length,
  expiredCount: expired.length,
  invalidDateCount: invalid.length,
  featureLevelFreshness: {
    featureCountWithEvidenceRecords: featureState.size,
    featureCountWithFreshEvidence: featureIdsWithFreshEvidence.length,
    featureCountWithOnlyExpiredEvidence: featureIdsWithOnlyExpiredEvidence.length,
    featureCountWithInvalidEvidenceDate: featureIdsWithInvalidEvidenceDate.length,
    featureIdsWithFreshEvidence,
    featureIdsWithOnlyExpiredEvidence,
    featureIdsWithInvalidEvidenceDate,
  },
  expiredClaimIds: expired.slice(0, 25).map((record) => ({
    evidenceId: record.evidenceId,
    claimId: record.claimId,
    subjectId: record.subjectId,
    validUntil: record.validUntil,
    sourceRef: record.sourceRef,
  })),
  rule: 'Descriptive only; evidence freshness never promotes mapping or implementation status.',
}, null, 2))
