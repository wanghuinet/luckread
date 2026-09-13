#!/usr/bin/env node
/**
 * LuckRead semantic contract gate.
 *
 * This gate verifies cross-domain invariants that structural schema checks
 * cannot prove alone. It is intentionally dependency-free.
 */
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve, relative } from 'node:path'

const ROOT = resolve('contracts')
const PREFIX = 'https://luckread.com/contracts/v1/'
const errors = []
const fail = (message) => errors.push(message)

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(path))
    else if (extname(entry.name) === '.json') out.push(path)
  }
  return out
}

async function json(rel) {
  return JSON.parse(await readFile(join(ROOT, rel), 'utf8'))
}

const enumDocs = new Map()
for (const file of await walk(join(ROOT, 'enums'))) {
  const doc = JSON.parse(await readFile(file, 'utf8'))
  enumDocs.set(doc.$id, doc)
}

const permissionsDoc = await json('authz/permissions.json')
const permissions = new Map((permissionsDoc['x-permissions'] ?? []).map((p) => [p.name, p]))
if (permissions.size === 0) fail('authz/permissions.json: permission catalog is empty')

for (const file of await walk(join(ROOT, 'state-machines'))) {
  const doc = JSON.parse(await readFile(file, 'utf8'))
  const rel = relative(ROOT, file)
  const transitions = doc['x-transitions'] ?? []
  const entity = doc['x-luckread']?.entity
  const enumName = entity === 'User' ? 'account-state.json' : entity === 'Content' ? 'content-state.json' : null

  if (enumName) {
    const enumDoc = enumDocs.get(`${PREFIX}enums/${enumName}`)
    if (enumDoc) {
      const known = new Set(enumDoc.enum ?? [])
      const terminal = new Set(enumDoc['x-luckread']?.['terminal-states'] ?? [])
      const recoverable = new Set(enumDoc['x-luckread']?.['recoverable-tombstone-states'] ?? [])
      for (const t of transitions) {
        for (const state of [t.from, t.to]) {
          if (!known.has(state)) fail(`${rel}: state '${state}' is not defined by ${enumName}`)
        }
        if (terminal.has(t.from)) fail(`${rel}: terminal state '${t.from}' has outgoing transition ${t.from}->${t.to}`)
      }
      for (const state of recoverable) {
        if (terminal.has(state)) fail(`${enumName}: state '${state}' is both terminal and recoverable`)
      }
    }
  }

  for (const t of transitions) {
    if (!t.permission) continue
    if (!permissions.has(t.permission)) fail(`${rel}: unknown permission '${t.permission}'`)
  }
}

const errorDoc = await json('schemas/common/error.json')
if (errorDoc.properties?.code?.$ref !== '../../enums/error-code.json') {
  fail('schemas/common/error.json: code MUST reference canonical ErrorCode enum')
}

const errorResponse = await json('schemas/common/error-response.json')
if (!errorResponse.properties?.traceId) fail('schemas/common/error-response.json: traceId must be declared')

const listResponse = await json('schemas/common/list-response.json')
if (!listResponse.properties?.requestId) fail('schemas/common/list-response.json: requestId must be declared')
if (!listResponse.properties?.traceId) fail('schemas/common/list-response.json: traceId must be declared')
if (!listResponse.properties?.data?.properties?.items) fail('schemas/common/list-response.json: data.items is required')
if (!listResponse.properties?.data?.properties?.nextCursor) fail('schemas/common/list-response.json: data.nextCursor is required')
if (!listResponse.properties?.data?.properties?.hasMore) fail('schemas/common/list-response.json: data.hasMore is required')

const policy = await json('openapi/v1/operation-policy.json')
const policyOps = policy.operations ?? []
if (policy.version !== '1.0.0') fail('openapi/operation-policy.json: version MUST be 1.0.0')

const policyIds = new Set()
for (const op of policyOps) {
  if (policyIds.has(op.operationId)) fail(`openapi/operation-policy.json: duplicate operationId '${op.operationId}'`)
  policyIds.add(op.operationId)
  const mode = op.auth?.mode
  if (!['public', 'permission', 'state-machine', 'authenticated'].includes(mode)) {
    fail(`openapi/operation-policy.json: operation '${op.operationId}' has invalid auth.mode '${mode ?? ''}'`)
  }
  const perms = op.permissions ?? []
  if (!Array.isArray(perms)) fail(`openapi/operation-policy.json: operation '${op.operationId}' permissions must be an array`)
  for (const permission of perms) {
    if (!permissions.has(permission)) fail(`openapi/operation-policy.json: operation '${op.operationId}' references unknown permission '${permission}'`)
  }
  if (mode === 'public' && perms.length !== 0) fail(`openapi/operation-policy.json: public operation '${op.operationId}' must not require a permission`)
  if (mode === 'permission' && perms.length === 0) fail(`openapi/operation-policy.json: permission operation '${op.operationId}' must declare at least one permission`)
  if (mode === 'state-machine' && !['account', 'content'].includes(op.stateMachine)) {
    fail(`openapi/operation-policy.json: state-machine operation '${op.operationId}' must name account or content`)
  }
  if (mode !== 'state-machine' && op.stateMachine !== 'none') {
    fail(`openapi/operation-policy.json: non-state-machine operation '${op.operationId}' must use stateMachine=none`)
  }
  if (perms.some((permission) => permissions.get(permission)?.auditRequired === true) && op.auditRequired !== true) {
    fail(`openapi/operation-policy.json: operation '${op.operationId}' uses an audit-required permission but auditRequired=false`)
  }
}

const openapi = await readFile(join(ROOT, 'openapi/v1/openapi.yaml'), 'utf8')
const operationIds = [...openapi.matchAll(/^\s+operationId:\s*([A-Za-z][A-Za-z0-9_]*)\s*$/gm)].map((m) => m[1])
const actualIds = new Set(operationIds)
if (actualIds.size !== operationIds.length) fail('openapi.yaml: duplicate operationId detected')
for (const id of operationIds) if (!policyIds.has(id)) fail(`openapi.yaml: operationId '${id}' missing from operation-policy.json`)
for (const id of policyIds) if (!actualIds.has(id)) fail(`operation-policy.json: operationId '${id}' is not present in openapi.yaml`)

const publicOps = new Set(policy['x-luckread']?.['public-operations'] ?? [])
for (const id of publicOps) {
  const op = policyOps.find((item) => item.operationId === id)
  if (!op) fail(`operation-policy.json: public operation '${id}' does not exist`)
  else if (op.auth?.mode !== 'public') fail(`operation-policy.json: '${id}' is declared public but auth.mode is not public`)
}

function operationBlock(operationId) {
  const idx = openapi.indexOf(`operationId: ${operationId}`)
  if (idx < 0) return ''
  const prefix = openapi.slice(0, idx)
  const methods = [...prefix.matchAll(/^    (get|post|put|patch|delete|head|options):\s*$/gm)]
  const start = methods.length ? methods.at(-1).index : Math.max(0, idx - 500)
  const suffix = openapi.slice(idx + 1)
  const nextMethod = suffix.search(/^    (get|post|put|patch|delete|head|options):\s*$/m)
  const nextPath = suffix.search(/^  \/[^ ].*:\s*$/m)
  let end = openapi.length
  if (nextMethod >= 0) end = Math.min(end, idx + 1 + nextMethod)
  if (nextPath >= 0) end = Math.min(end, idx + 1 + nextPath)
  return openapi.slice(start ?? 0, end)
}

for (const op of policyOps) {
  const block = operationBlock(op.operationId)
  if (!block) {
    fail(`openapi.yaml: operation '${op.operationId}' could not be located for policy binding`)
    continue
  }
  if (op.idempotencyRequired && !block.includes("#/components/parameters/IdempotencyKey")) {
    fail(`openapi.yaml: idempotency-required operation '${op.operationId}' does not declare Idempotency-Key`)
  }
  if (op.optimisticLockRequired && !block.includes("#/components/parameters/IfMatch")) {
    fail(`openapi.yaml: optimistic-lock-required operation '${op.operationId}' does not declare If-Match`)
  }
}

if (errors.length) {
  console.error('Contract Semantic CI RED — semantic admission gate FAILED:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(`Contract Semantic CI GREEN — state machines, permissions, errors, pagination and ${operationIds.length} OpenAPI operations cross-checked`)
