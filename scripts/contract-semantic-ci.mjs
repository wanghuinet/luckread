#!/usr/bin/env node
/**
 * LuckRead semantic contract gate.
 *
 * This supplements the dependency-free structural validator with cross-domain
 * invariants that must never be allowed to drift silently.
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
  const path = join(ROOT, rel)
  return JSON.parse(await readFile(path, 'utf8'))
}

function idSet(items) {
  return new Set(items)
}

const enumDocs = new Map()
for (const file of await walk(join(ROOT, 'enums'))) {
  const doc = JSON.parse(await readFile(file, 'utf8'))
  enumDocs.set(doc.$id, doc)
}

const permissionsDoc = await json('authz/permissions.json')
const permissions = new Map((permissionsDoc['x-permissions'] ?? []).map((p) => [p.name, p]))

for (const file of await walk(join(ROOT, 'state-machines'))) {
  const doc = JSON.parse(await readFile(file, 'utf8'))
  const rel = relative(ROOT, file)
  const transitions = doc['x-transitions'] ?? []
  const entity = doc['x-luckread']?.entity
  const enumName = entity === 'User' ? 'account-state.json' : entity === 'Content' ? 'content-state.json' : null
  if (enumName) {
    const enumDoc = enumDocs.get(`${PREFIX}enums/${enumName}`)
    if (enumDoc) {
      const known = idSet(enumDoc.enum ?? [])
      const terminal = idSet(enumDoc['x-luckread']?.['terminal-states'] ?? [])
      const recoverable = idSet(enumDoc['x-luckread']?.['recoverable-tombstone-states'] ?? [])
      for (const t of transitions) {
        for (const state of [t.from, t.to]) {
          if (!known.has(state)) fail(`${rel}: state '${state}' is not defined by ${enumName}`)
        }
        if (terminal.has(t.from)) fail(`${rel}: terminal state '${t.from}' has outgoing transition ${t.from}->${t.to}`)
      }
      for (const state of recoverable) {
        if (terminal.has(state)) fail(`${rel}: state '${state}' is both terminal and recoverable`)
      }
    }
  }
  for (const t of transitions) {
    if (!t.permission) continue
    if (!permissions.has(t.permission)) fail(`${rel}: unknown permission '${t.permission}'`)
  }
}

const errorDoc = await json('schemas/common/error.json')
const code = errorDoc.properties?.code
const canonicalErrorRef = '../../enums/error-code.json'
if (code?.$ref !== canonicalErrorRef) {
  fail(`common/error.json: code MUST reference canonical ErrorCode enum via ${canonicalErrorRef}`)
}

const errorResponse = await json('schemas/common/error-response.json')
if (!errorResponse.properties?.traceId) fail('common/error-response.json: traceId property is required for trace-capable responses')

const policy = await json('openapi/v1/operation-policy.json')
const policyOps = policy.operations ?? []
const policyIds = new Set()
for (const op of policyOps) {
  if (policyIds.has(op.operationId)) fail(`openapi/operation-policy.json: duplicate operationId '${op.operationId}'`)
  policyIds.add(op.operationId)
  for (const permission of op.permissions ?? []) {
    if (!permissions.has(permission)) fail(`openapi/operation-policy.json: operation '${op.operationId}' references unknown permission '${permission}'`)
  }
  if (op.auth?.mode === 'public' && (op.permissions ?? []).length !== 0) {
    fail(`openapi/operation-policy.json: public operation '${op.operationId}' must not require a permission`)
  }
}

const openapi = await readFile(join(ROOT, 'openapi/v1/openapi.yaml'), 'utf8')
const operationIds = [...openapi.matchAll(/^\s+operationId:\s*([A-Za-z][A-Za-z0-9_]*)\s*$/gm)].map((m) => m[1])
const actualIds = new Set(operationIds)
if (actualIds.size !== operationIds.length) fail('openapi.yaml: duplicate operationId detected')
for (const id of operationIds) if (!policyIds.has(id)) fail(`openapi.yaml: operationId '${id}' missing from operation-policy.json`)
for (const id of policyIds) if (!actualIds.has(id)) fail(`operation-policy.json: operationId '${id}' is not present in openapi.yaml`)

function operationBlock(operationId) {
  const idx = openapi.indexOf(`operationId: ${operationId}`)
  if (idx < 0) return ''
  const methodMatches = [...openapi.slice(0, idx).matchAll(/^    (get|post|put|patch|delete|head|options):\s*$/gm)]
  const start = methodMatches.length ? methodMatches.at(-1).index : Math.max(0, idx - 500)
  const nextMethod = openapi.slice(idx + 1).search(/^    (get|post|put|patch|delete|head|options):\s*$/m)
  const nextPath = openapi.slice(idx + 1).search(/^  \/[^ ].*:\s*$/m)
  let end = openapi.length
  if (nextMethod >= 0) end = Math.min(end, idx + 1 + nextMethod)
  if (nextPath >= 0) end = Math.min(end, idx + 1 + nextPath)
  return openapi.slice(start ?? 0, end)
}

for (const op of policyOps.filter((item) => item.idempotencyRequired)) {
  const block = operationBlock(op.operationId)
  if (!block.includes("#/components/parameters/IdempotencyKey")) {
    fail(`openapi.yaml: idempotency-required operation '${op.operationId}' does not declare Idempotency-Key`)
  }
}

for (const op of policyOps.filter((item) => item.optimisticLockRequired)) {
  const block = operationBlock(op.operationId)
  if (!block.includes("#/components/parameters/IfMatch")) {
    fail(`openapi.yaml: optimistic-lock-required operation '${op.operationId}' does not declare If-Match`)
  }
}

if (errors.length) {
  console.error('Contract Semantic CI RED — semantic admission gate FAILED:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(`Contract Semantic CI GREEN — state machines, permissions, errors and ${operationIds.length} OpenAPI operations cross-checked`)
