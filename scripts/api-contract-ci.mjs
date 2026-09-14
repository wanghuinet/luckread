#!/usr/bin/env node
/**
 * LuckRead API Contract CI.
 * Validates machine-readable contracts/api/*.json and contracts/evidence/*.json.
 * Also enforces exact RC -> Canonical OpenAPI operation mapping.
 * This gate is intentionally independent from Payload implementation code.
 */
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const root = resolve('contracts')
const errors = []
const fail = (message) => errors.push(message)
const idPrefix = 'https://luckread.com/contracts/v1/'

async function jsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile() && extname(entry.name) === '.json').map((entry) => join(dir, entry.name)).sort()
}

async function load(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { fail(`${file}: invalid JSON (${error.message})`); return null }
}

const apiDir = join(root, 'api')
const evidenceDir = join(root, 'evidence')
const apiFiles = await jsonFiles(apiDir)
const evidenceFiles = await jsonFiles(evidenceDir)
const apiIds = new Map()
const apiPaths = new Map()

for (const file of apiFiles) {
  const doc = await load(file)
  if (!doc) continue
  const rel = file.replace(`${root}/`, '')
  if (doc.$schema !== 'https://json-schema.org/draft/2020-12/schema') fail(`${rel}: missing Draft 2020-12 schema declaration`)
  if (typeof doc.$id !== 'string' || !doc.$id.startsWith(`${idPrefix}api/`)) fail(`${rel}: invalid api $id`)
  if (apiIds.has(doc.$id)) fail(`${rel}: duplicate $id ${doc.$id}`)
  apiIds.set(doc.$id, rel)
  if (!Array.isArray(doc.operations) || doc.operations.length === 0) { fail(`${rel}: operations must be a non-empty array`); continue }
  const operationIds = new Set()
  for (const op of doc.operations) {
    if (!op.operationId || !/^[A-Za-z][A-Za-z0-9]+$/.test(op.operationId)) fail(`${rel}: invalid operationId`)
    if (operationIds.has(op.operationId)) fail(`${rel}: duplicate operationId ${op.operationId}`)
    operationIds.add(op.operationId)
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(op.method)) fail(`${rel}: unsupported method ${op.method}`)
    if (!op.path || !op.path.startsWith('/')) fail(`${rel}: operation ${op.operationId} has invalid path`)
    const key = `${op.method} ${op.path}`
    if (apiPaths.has(key)) fail(`${rel}: duplicate API operation ${key} (already in ${apiPaths.get(key)})`)
    apiPaths.set(key, rel)
    if (!op.auth || typeof op.auth.required !== 'boolean') fail(`${rel}: operation ${op.operationId} must declare auth.required explicitly`)
    if (!op.success?.status) fail(`${rel}: operation ${op.operationId} must declare success.status`)
    if (!Array.isArray(op.errors)) fail(`${rel}: operation ${op.operationId} must declare errors[]`)
  }
  if (!doc.greenEvidence || typeof doc.greenEvidence !== 'object') fail(`${rel}: greenEvidence is required`)
}

const evidenceIds = new Map()
const evidenceByContract = new Map()
for (const file of evidenceFiles) {
  const doc = await load(file)
  if (!doc) continue
  const rel = file.replace(`${root}/`, '')
  if (doc.$schema !== 'https://json-schema.org/draft/2020-12/schema') fail(`${rel}: missing Draft 2020-12 schema declaration`)
  if (typeof doc.$id !== 'string' || !doc.$id.startsWith(`${idPrefix}evidence/`)) fail(`${rel}: invalid evidence $id`)
  if (evidenceIds.has(doc.$id)) fail(`${rel}: duplicate $id ${doc.$id}`)
  evidenceIds.set(doc.$id, rel)
  if (!doc.contract || (typeof doc.contract !== 'string' && !Array.isArray(doc.contract))) fail(`${rel}: contract reference is required`)
  else {
    const refs = Array.isArray(doc.contract) ? doc.contract : doc.contract.split(/\s*\+\s*/).map((value) => value.trim()).filter(Boolean)
    for (const contract of refs) {
      if (!apiFiles.some((filePath) => filePath.replace(`${root}/`, '') === contract)) fail(`${rel}: contract reference does not resolve to an API contract: ${contract}`)
      else { const list = evidenceByContract.get(contract) ?? []; list.push(rel); evidenceByContract.set(contract, list) }
    }
  }
  const required = doc.requiredEvidence
  if (!Array.isArray(required) || required.length === 0) fail(`${rel}: requiredEvidence must be non-empty`)
  else {
    const ids = new Set()
    for (const item of required) {
      if (!item.id || !item.requirement) fail(`${rel}: evidence item must declare id and requirement`)
      if (ids.has(item.id)) fail(`${rel}: duplicate evidence id ${item.id}`)
      ids.add(item.id)
      if (item.status !== 'PENDING' && item.status !== 'PASS') fail(`${rel}: evidence ${item.id} has invalid status ${item.status}`)
    }
  }
  if (!['BLOCKED_ON_IMPLEMENTATION_BASELINE', 'BLOCKED_ON_CANONICAL_OPENAPI_ALIGNMENT', 'GREEN'].includes(doc.status)) fail(`${rel}: invalid gate status ${doc.status}`)
}

for (const file of apiFiles) {
  const rel = file.replace(`${root}/`, '')
  if (!evidenceByContract.has(rel)) fail(`${rel}: no evidence gate references this API contract`)
}

const requiredRc = [
  'contracts/api/block-mute.v1.json',
  'contracts/api/report-appeal.v1.json',
  'contracts/api/revision.v1.json',
  'contracts/api/rc-04-06-share-subscription-entitlement.v1.json',
  'contracts/api/organization-members.v1.json',
  'contracts/api/ip-content.v1.json',
  'contracts/api/feed-delivery.v1.json',
  'contracts/api/search-feed-consistency.v1.json'
]
for (const required of requiredRc) if (!apiFiles.includes(join(apiDir, required.split('/').pop()))) fail(`missing required RC API contract: ${required}`)

// Canonical OpenAPI uses /api/v1 as a server base; RC paths intentionally omit it.
const openapiPath = join(root, 'openapi/v1/openapi.yaml')
let openapiText = ''
try { openapiText = await readFile(openapiPath, 'utf8') }
catch (error) { fail(`openapi/v1/openapi.yaml: unable to read (${error.message})`) }

const openapiOps = new Map()
let currentPath = null
let currentMethod = null
for (const line of openapiText.split(/\r?\n/)) {
  const pathMatch = line.match(/^  (\/[^:]+):\s*$/)
  if (pathMatch) { currentPath = pathMatch[1]; currentMethod = null; continue }
  const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/i)
  if (methodMatch && currentPath) { currentMethod = methodMatch[1].toUpperCase(); continue }
  const operationMatch = line.match(/^      operationId:\s*([A-Za-z][A-Za-z0-9]+)\s*$/)
  if (operationMatch && currentPath && currentMethod) openapiOps.set(`${currentMethod} ${currentPath}`, operationMatch[1])
}

const mappingEvidence = await load(join(evidenceDir, 'rc-openapi-mapping.v1.json'))
if (mappingEvidence) {
  for (const contract of mappingEvidence.contract ?? []) {
    const doc = await load(resolve(contract))
    if (!doc?.operations) continue
    for (const op of doc.operations) {
      const key = `${op.method} ${op.path}`
      const actual = openapiOps.get(key)
      if (!actual) fail(`${contract}: missing Canonical OpenAPI operation ${key} (${op.operationId})`)
      else if (actual !== op.operationId) fail(`${contract}: OpenAPI operationId mismatch for ${key}: expected ${op.operationId}, found ${actual}`)
    }
  }
}

if (errors.length) {
  console.error('API Contract CI RED')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(`API Contract CI GREEN — api=${apiFiles.length} evidence=${evidenceFiles.length} operations=${apiPaths.size} openapiOperations=${openapiOps.size}`)
