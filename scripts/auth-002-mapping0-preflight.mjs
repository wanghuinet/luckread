import { readFileSync, existsSync } from 'node:fs'

const mappingPath = 'contracts/alignment/mapping-batches/AUTH-002-006-persistence-api-entity-field-mapping.v1.json'
const dtoPath = 'contracts/dto/auth-dto-records.v1.json'
const entityPath = 'contracts/entity/entity-field-contract.v1.json'

const fail = (message) => {
  console.error(`AUTH-002_MAPPING0_PREFLIGHT_REJECTED: ${message}`)
  process.exitCode = 1
}

const readJson = (path) => {
  if (!existsSync(path)) {
    fail(`missing canonical file: ${path}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(`invalid JSON: ${path}`)
    return null
  }
}

const mapping = readJson(mappingPath)
const dtoRegistry = readJson(dtoPath)
const entityContract = readJson(entityPath)
if (!mapping || !dtoRegistry || !entityContract) process.exit(1)

const auth002 = mapping.bindings?.find((binding) => binding.featureId === 'AUTH-002')
if (!auth002) fail('AUTH-002 binding is missing')

const dtoIds = new Set((dtoRegistry.records ?? []).map((record) => record.dtoId).filter(Boolean))
for (const dtoRef of auth002?.dtoRefs ?? []) {
  if (!dtoIds.has(dtoRef)) fail(`AUTH-002 DTO reference is unresolved: ${dtoRef}`)
}

const entitiesById = new Map((entityContract.records ?? []).map((record) => [record.entityId, record]))
for (const entityId of auth002?.entityRefs ?? []) {
  const entity = entitiesById.get(entityId)
  if (!entity) {
    fail(`AUTH-002 entity reference is unresolved: ${entityId}`)
    continue
  }
  if (!Array.isArray(entity.fields) || entity.fields.length === 0) {
    fail(`AUTH-002 entity has no canonical fields: ${entityId}`)
  }
  if (entity.status === 'PROPOSED') {
    fail(`AUTH-002 entity remains PROPOSED: ${entityId}`)
  }
}

const requiredFieldAuthorities = [
  'contracts/entity/AUTH-003-identity-field-contract.v1.json#fields',
  'contracts/entity/AUTH-003-credential-field-contract.v1.json#fieldAuthority',
  'contracts/entity/AUTH-002-session-field-contract.v1.json#fields',
]
for (const authorityRef of requiredFieldAuthorities) {
  if (!(auth002?.fieldAuthorityRefs ?? []).some((ref) => ref === authorityRef)) {
    fail(`AUTH-002 missing required field authority: ${authorityRef}`)
  }
}

if (auth002?.persistenceOwnerStatus !== 'REQUIRES_VERIFICATION') {
  fail('AUTH-002 persistence owner status must remain REQUIRES_VERIFICATION until real evidence is accepted')
}

if (auth002?.migrationId !== 'MIG-AUTH-002-SESSION-V1') {
  fail('AUTH-002 migration identifier drifted')
}

if (process.exitCode) {
  console.error('AUTH-002_MAPPING0_PREFLIGHT_BLOCKED')
  console.error('No runtime or persistence status has been promoted by this preflight.')
  process.exit(1)
}

console.log('AUTH-002_MAPPING0_PREFLIGHT_PASS')
console.log('Canonical AUTH-002 DTO/entity/field references are structurally resolvable. Runtime, persistence, migration, security, concurrency, Evidence Registry and final Mapping0 verification remain required.')
