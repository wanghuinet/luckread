#!/usr/bin/env node
/**
 * Deterministically enrich canonical AUTH mapping records from already-frozen
 * contract sources.
 *
 * This step is contract reconciliation only. It MUST NOT:
 * - infer API operation IDs that are not already canonical;
 * - copy stale operation IDs from persistence-only mappings;
 * - infer physical D1 table/column names;
 * - promote status to GREEN;
 * - create runtime/code/test evidence;
 * - alter unrelated mapping fields.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const mappingPath = path.join(root, 'contracts/alignment/cross-system-mapping.v1.json')
const jsonBindingPath = path.join(root, 'contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json')
const auth010BindingPath = path.join(root, 'contracts/alignment/mapping-batches/AUTH-010-session-field-binding.v1.md')
const auth011GatePath = path.join(root, 'contracts/alignment/mapping-batches/AUTH-011-runtime-gate.v1.md')
const authDtoContractPath = path.join(root, 'contracts/dto/auth-dto-contract.v1.json')

const apiContractPaths = {
  'AUTH-003': path.join(root, 'contracts/api/AUTH-003-credential-management-contract.v1.json'),
  'AUTH-004': path.join(root, 'contracts/api/AUTH-004-password-recovery-contract.v1.json'),
  'AUTH-005': path.join(root, 'contracts/api/AUTH-005-identity-verification-contract.v1.json'),
  'AUTH-006': path.join(root, 'contracts/api/AUTH-006-passkey-webauthn-contract.v1.json'),
}

const featureEvidencePaths = {
  'AUTH-007': 'contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md',
  'AUTH-008': 'contracts/alignment/mapping-batches/AUTH-008-real-evidence-reconciliation.v1.md',
  'AUTH-009': 'contracts/alignment/mapping-batches/AUTH-009-reconciliation.v1.md',
  'AUTH-012': 'contracts/alignment/mapping-batches/AUTH-012-risk-contract-closure-gate.v1.md',
  'AUTH-013': 'contracts/alignment/mapping-batches/AUTH-013-real-evidence-reconciliation.v1.md',
  'AUTH-014': 'contracts/alignment/mapping-batches/AUTH-014-real-evidence-reconciliation.v1.md',
  'AUTH-015': 'contracts/alignment/mapping-batches/AUTH-015-real-evidence-reconciliation.v1.md',
  'AUTH-016': 'contracts/alignment/mapping-batches/AUTH-016-real-evidence-reconciliation.v1.md',
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const readText = (file) => fs.readFileSync(file, 'utf8')
const mapping = readJson(mappingPath)
const jsonBinding = readJson(jsonBindingPath)
const authDtoContract = readJson(authDtoContractPath)

if (!Array.isArray(mapping.records)) throw new Error('canonical mapping records must be an array')
if (!Array.isArray(jsonBinding.bindings)) throw new Error('AUTH-002..006 binding records must be an array')
if (!Array.isArray(authDtoContract.records)) throw new Error('AUTH DTO contract records must be an array')

const entityRefsByFeature = new Map()
const apiOperationIdsByFeature = new Map()
const evidenceRefsByFeature = new Map()

const addEvidenceRef = (featureId, ref) => {
  if (typeof featureId !== 'string' || typeof ref !== 'string' || ref.length === 0) {
    throw new Error('evidence binding requires non-empty featureId and ref')
  }
  const current = evidenceRefsByFeature.get(featureId) ?? []
  if (!current.includes(ref)) current.push(ref)
  evidenceRefsByFeature.set(featureId, current)
}

for (const [featureId, ref] of Object.entries(featureEvidencePaths)) {
  const absolute = path.join(root, ref)
  if (!fs.existsSync(absolute)) throw new Error(`${featureId}: expected Feature evidence source is missing: ${ref}`)
  addEvidenceRef(featureId, ref)
}

const addEntityBinding = (featureId, entityRefs, source) => {
  if (!Array.isArray(entityRefs) || entityRefs.length === 0) {
    throw new Error(`${featureId}: ${source} did not expose entity references`)
  }
  if (entityRefs.some((value) => typeof value !== 'string' || !/^ENT-[A-Z0-9-]+$/.test(value))) {
    throw new Error(`${featureId}: ${source} contains invalid entity reference`)
  }
  if (entityRefsByFeature.has(featureId)) throw new Error(`duplicate entity contract binding: ${featureId}`)
  entityRefsByFeature.set(featureId, [...new Set(entityRefs)].sort())
}

for (const record of jsonBinding.bindings) {
  if (['AUTH-002', 'AUTH-003', 'AUTH-004', 'AUTH-005', 'AUTH-006'].includes(record?.featureId)) {
    addEntityBinding(record.featureId, record.entityRefs, 'AUTH-002..006 persistence/API/entity/field contract')
    addEvidenceRef(record.featureId, 'contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json')
  }
}

const dtoRecordsByFeature = new Map()
for (const record of authDtoContract.records) {
  if (!record?.featureId) continue
  const current = dtoRecordsByFeature.get(record.featureId) ?? []
  current.push(record)
  dtoRecordsByFeature.set(record.featureId, current)
}

for (const featureId of ['AUTH-001', 'AUTH-002', 'AUTH-010']) {
  const records = dtoRecordsByFeature.get(featureId) ?? []
  if (records.length === 0) throw new Error(`${featureId}: AUTH DTO contract exposes no records`)

  const dtoOperationIds = records
    .map((record) => record.operationId)
    .filter((value) => typeof value === 'string' && value.length > 0)
  if (dtoOperationIds.length !== new Set(dtoOperationIds).size) {
    throw new Error(`${featureId}: AUTH DTO contract contains duplicate operationId bindings`)
  }

  const entityRefs = [...new Set(records.flatMap((record) => Array.isArray(record.entityIds) ? record.entityIds : []))]
  if (featureId === 'AUTH-001') {
    addEntityBinding(featureId, entityRefs, 'AUTH DTO contract')
  }

  for (const operationId of dtoOperationIds) {
    if (apiOperationIdsByFeature.has(featureId)) continue
    apiOperationIdsByFeature.set(featureId, dtoOperationIds)
  }
  addEvidenceRef(featureId, 'contracts/dto/auth-dto-contract.v1.json')
}

const addApiContractBinding = (featureId, file) => {
  const contract = readJson(file)
  if (contract.featureId !== featureId) throw new Error(`${featureId}: API contract featureId mismatch`)
  if (!Array.isArray(contract.operations) || contract.operations.length === 0) {
    throw new Error(`${featureId}: API contract exposes no operations`)
  }
  const operationIds = contract.operations.map((operation) => operation?.operationId)
  if (operationIds.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error(`${featureId}: API contract contains an invalid operationId`)
  }
  if (new Set(operationIds).size !== operationIds.length) {
    throw new Error(`${featureId}: API contract contains duplicate operationId`)
  }
  apiOperationIdsByFeature.set(featureId, operationIds)
  addEvidenceRef(featureId, path.relative(root, file).replaceAll(path.sep, '/'))
}

for (const [featureId, file] of Object.entries(apiContractPaths)) addApiContractBinding(featureId, file)

const auth010Text = readText(auth010BindingPath)
const auth010Entity = auth010Text.match(/- Entity:\s+`(ENT-[A-Z0-9-]+)`/)
if (!auth010Entity) throw new Error('AUTH-010 field binding did not expose an Entity reference')
addEntityBinding('AUTH-010', [auth010Entity[1]], 'AUTH-010 session field binding')
addEvidenceRef('AUTH-010', 'contracts/alignment/mapping-batches/AUTH-010-session-field-binding.v1.md')

const auth011Text = readText(auth011GatePath)
const requiredChain = auth011Text.match(/## Required contract chain\n\n([^\n]+)/)?.[1] ?? ''
const auth011Entities = [...new Set(requiredChain.match(/ENT-[A-Z0-9-]+/g) ?? [])]
if (auth011Entities.length === 0) throw new Error('AUTH-011 runtime gate did not expose entity references in the required contract chain')
addEntityBinding('AUTH-011', auth011Entities, 'AUTH-011 runtime gate required contract chain')
addEvidenceRef('AUTH-011', 'contracts/alignment/mapping-batches/AUTH-011-runtime-gate.v1.md')

const mappingById = new Map()
for (const record of mapping.records) {
  if (!record?.featureId) continue
  if (mappingById.has(record.featureId)) throw new Error(`duplicate canonical mapping record: ${record.featureId}`)
  mappingById.set(record.featureId, record)
}

for (const [featureId, dtoRecords] of dtoRecordsByFeature) {
  if (!['AUTH-001', 'AUTH-002', 'AUTH-010'].includes(featureId)) continue
  const mappingRecord = mappingById.get(featureId)
  if (!mappingRecord) throw new Error(`missing canonical mapping record: ${featureId}`)
  const dtoOperationIds = dtoRecords.map((record) => record.operationId).filter((value) => typeof value === 'string' && value.length > 0)
  const current = Array.isArray(mappingRecord.apiOperationIds) ? mappingRecord.apiOperationIds : []
  const expected = new Set(current)
  for (const operationId of dtoOperationIds) expected.add(operationId)
  const invalidMissingFromDto = current.filter((value) => !dtoOperationIds.includes(value))
  if (invalidMissingFromDto.length > 0 && featureId === 'AUTH-001') {
    throw new Error(`${featureId}: canonical API operation IDs are not represented by the DTO contract: ${invalidMissingFromDto.join(', ')}`)
  }
  mappingRecord.apiOperationIds = [...expected]
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
    changes.push({ featureId, field: 'entityIds', before, after })
  }
}

for (const [featureId, canonicalOperationIds] of apiOperationIdsByFeature) {
  const mappingRecord = mappingById.get(featureId)
  if (!mappingRecord) throw new Error(`missing canonical mapping record: ${featureId}`)
  if (!Array.isArray(mappingRecord.apiOperationIds)) throw new Error(`${featureId}: apiOperationIds must be an array`)

  const current = [...mappingRecord.apiOperationIds]
  const allowed = new Set(canonicalOperationIds)
  const staleCurrent = current.filter((value) => !allowed.has(value))
  if (staleCurrent.length > 0) {
    throw new Error(`${featureId}: canonical mapping already contains non-canonical API operation IDs: ${staleCurrent.join(', ')}`)
  }

  const after = [...new Set([...current, ...canonicalOperationIds])]
  if (JSON.stringify(current) !== JSON.stringify(after)) {
    mappingRecord.apiOperationIds = after
    changes.push({ featureId, field: 'apiOperationIds', before: current, after })
  }
}

for (const [featureId, refs] of evidenceRefsByFeature) {
  const mappingRecord = mappingById.get(featureId)
  if (!mappingRecord) throw new Error(`missing canonical mapping record: ${featureId}`)
  if (!Array.isArray(mappingRecord.evidence)) throw new Error(`${featureId}: evidence must be an array`)

  const before = [...mappingRecord.evidence]
  const after = [...new Set([...before, ...refs])]
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    mappingRecord.evidence = after
    changes.push({ featureId, field: 'evidence', before, after })
  }
}

if (changes.length > 0) {
  fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`)
}

console.log(JSON.stringify({
  status: changes.length ? 'ENRICHED_CONTRACT_MAPPING' : 'NO_CHANGE',
  entityBindingFeatureCount: entityRefsByFeature.size,
  apiContractBindingFeatureCount: apiOperationIdsByFeature.size,
  dtoContractBindingFeatureCount: 3,
  evidenceBindingFeatureCount: evidenceRefsByFeature.size,
  enrichedChangeCount: changes.length,
  changes,
  rules: {
    canonicalApiIdsFromFeatureSpecificContracts: true,
    stalePersistenceOnlyApiIdsRejected: true,
    dtoBindingsMustMatchCanonicalSurface: true,
    featureEvidenceSourcesOnly: true,
    contractEvidenceSourcesOnly: true,
    physicalPersistenceNamesUntouched: true,
    runtimeEvidenceUntouched: true,
    statusUntouched: true,
    noInference: true,
  },
}, null, 2))
