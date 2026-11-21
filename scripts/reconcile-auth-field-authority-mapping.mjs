#!/usr/bin/env node
/**
 * Reconcile the explicit AUTH-002..006 canonical field-authority chain into
 * the Canonical Mapping evidence links.
 *
 * Contract/reconciliation only. This script MUST NOT:
 * - promote feature/entity/field/runtime status;
 * - invent API, DTO, persistence, Payload, code, or test evidence;
 * - invent physical D1 tables or columns;
 * - treat field contracts as runtime evidence.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')
const authorityPath = path.join(root, 'contracts/entity/AUTH-002-006-canonical-field-authority.v1.json')

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const mapping = readJson(mappingPath)
const authority = readJson(authorityPath)

if (!Array.isArray(mapping.records)) throw new Error('canonical mapping records must be an array')
if (!Array.isArray(authority.records)) throw new Error('canonical field authority records must be an array')
if (authority.status !== 'CONTRACTED_NOT_VERIFIED') {
  throw new Error(`canonical field authority status must remain CONTRACTED_NOT_VERIFIED, got ${authority.status}`)
}
if (authority.promotionRules?.fieldContractIsNotImplementationEvidence !== true) {
  throw new Error('canonical field authority must explicitly prohibit implementation-evidence promotion')
}

const mappingById = new Map()
for (const record of mapping.records) {
  if (!record?.featureId) continue
  if (mappingById.has(record.featureId)) throw new Error(`duplicate canonical mapping record: ${record.featureId}`)
  mappingById.set(record.featureId, record)
}

const expectedFeatureIds = ['AUTH-002', 'AUTH-003', 'AUTH-004', 'AUTH-005', 'AUTH-006']
const authorityByFeature = new Map()
for (const record of authority.records) {
  if (!expectedFeatureIds.includes(record?.featureId)) continue
  if (record.status !== 'CONTRACTED_NOT_VERIFIED') {
    throw new Error(`${record.featureId}: field authority status must remain CONTRACTED_NOT_VERIFIED`)
  }
  if (!Array.isArray(record.fieldContractRefs) || record.fieldContractRefs.length === 0) {
    throw new Error(`${record.featureId}: fieldContractRefs must be non-empty`)
  }
  for (const ref of record.fieldContractRefs) {
    if (typeof ref !== 'string' || !ref.endsWith('.json')) throw new Error(`${record.featureId}: invalid fieldContractRef ${ref}`)
    const file = path.join(root, ref)
    if (!fs.existsSync(file)) throw new Error(`${record.featureId}: field contract file missing: ${ref}`)
    const fieldContract = readJson(file)
    if (fieldContract.status !== 'CONTRACTED_NOT_VERIFIED') {
      throw new Error(`${record.featureId}: referenced field contract ${ref} is not CONTRACTED_NOT_VERIFIED`)
    }
  }
  if (authorityByFeature.has(record.featureId)) throw new Error(`duplicate canonical field authority record: ${record.featureId}`)
  authorityByFeature.set(record.featureId, record)
}

for (const featureId of expectedFeatureIds) {
  if (!authorityByFeature.has(featureId)) throw new Error(`canonical field authority record missing: ${featureId}`)
}

const changes = []
for (const featureId of expectedFeatureIds) {
  const mappingRecord = mappingById.get(featureId)
  if (!mappingRecord) throw new Error(`missing canonical mapping record: ${featureId}`)
  if (!Array.isArray(mappingRecord.evidence)) throw new Error(`${featureId}: evidence must be an array`)

  const authorityRecord = authorityByFeature.get(featureId)
  const refs = [
    'contracts/entity/AUTH-002-006-canonical-field-authority.v1.json',
    ...authorityRecord.fieldContractRefs,
  ]
  const before = [...mappingRecord.evidence]
  const after = [...new Set([...before, ...refs])]
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    mappingRecord.evidence = after
    changes.push({ featureId, field: 'evidence', before, after })
  }
}

if (changes.length > 0) fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`)

console.log(JSON.stringify({
  status: changes.length ? 'ENRICHED_CONTRACT_MAPPING' : 'NO_CHANGE',
  featureCount: expectedFeatureIds.length,
  changedFeatureCount: changes.length,
  changes,
  rules: {
    authorityStatusUntouched: true,
    fieldContractStatusUntouched: true,
    featureStatusUntouched: true,
    apiEdgesUntouched: true,
    persistenceAndRuntimeEvidenceUntouched: true,
    physicalSchemaUntouched: true,
    noInference: true,
  },
}, null, 2))
