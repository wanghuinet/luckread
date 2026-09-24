#!/usr/bin/env node
/**
 * LuckRead Contract CI — dependency-free contract validator.
 *
 * Usage:
 *   node scripts/contract-ci.mjs            # validate every domain
 *   node scripts/contract-ci.mjs common     # validate one domain
 *
 * Domains: common (JSON Schemas), enums, state-machines, authz, openapi
 *
 * Contract CI is a CODE DEVELOPMENT ADMISSION gate: a red run blocks implementation.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

const CONTRACTS_ROOT = resolve('contracts')
const ID_PREFIX = 'https://luckread.com/contracts/v1/'

const errors = []
const counts = {}
const fail = (msg) => errors.push(msg)

async function walk(dir) {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(p)))
    else if (extname(entry.name) === '.json') out.push(p)
  }
  return out
}

async function loadJson(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    fail(`${path}: unreadable (${error.message})`)
    return null
  }
  try {
    return JSON.parse(raw)
  } catch (error) {
    fail(`${path}: invalid JSON (${error.message})`)
    return null
  }
}

const DOMAIN_DIRS = {
  common: 'schemas/common',
  enums: 'enums',
  'state-machines': 'state-machines',
  authz: 'authz',
  events: 'events',
}

async function validateJsonDomain(domain) {
  const dir = join(CONTRACTS_ROOT, DOMAIN_DIRS[domain] ?? domain)
  const files = (await walk(dir)).sort()
  if (files.length === 0) {
    fail(`domain '${domain}': no JSON files found under contracts/${domain}`)
    return { byId: new Map(), docs: [] }
  }
  const byId = new Map()
  const docs = []
  for (const file of files) {
    const doc = await loadJson(file)
    if (!doc) continue
    const rel = relative(CONTRACTS_ROOT, file)
    const id = doc.$id
    if (typeof id !== 'string' || !id.startsWith(ID_PREFIX)) {
      fail(`${rel}: $id must be a string starting with ${ID_PREFIX}`)
      continue
    }
    const expectedPrefix = `${ID_PREFIX}${domain}/`
    if (!id.startsWith(expectedPrefix)) {
      fail(`${rel}: $id '${id}' must start with '${expectedPrefix}'`)
    }
    if (byId.has(id)) fail(`${rel}: duplicate $id '${id}' (already used by ${byId.get(id)})`)
    byId.set(id, rel)
    if (doc.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
      fail(`${rel}: must declare JSON Schema Draft 2020-12`)
    }
    docs.push({ rel, id, doc })
  }
  counts[domain] = docs.length
  return { byId, docs }
}

/* ------------------------------------------------------------------ common */
async function checkCommon() {
  const { byId, docs } = await validateJsonDomain('common')
  const refs = new Set()
  const visit = (v) => {
    if (!v || typeof v !== 'object') return
    if (typeof v.$ref === 'string') refs.add(v.$ref)
    for (const c of Object.values(v)) visit(c)
  }
  for (const { doc } of docs) visit(doc)
  for (const ref of refs) {
    if (ref.startsWith(`${ID_PREFIX}common/`) && !byId.has(ref)) {
      fail(`common: unresolved reference ${ref}`)
    }
  }
  return { refs: refs.size }
}

/* ------------------------------------------------------------------- enums */
async function checkEnums() {
  const { docs } = await validateJsonDomain('enums')
  const enumValues = {}
  for (const { rel, id, doc } of docs) {
    if (!Array.isArray(doc.enum) || doc.enum.length === 0) {
      fail(`${rel}: enum file must declare a non-empty 'enum' array`)
      continue
    }
    if (new Set(doc.enum).size !== doc.enum.length) fail(`${rel}: duplicate values in enum`)
    enumValues[id] = doc.enum
  }
  return { enumValues }
}

/* ---------------------------------------------------------- state-machines */
async function checkStateMachines(enumValues) {
  const { docs } = await validateJsonDomain('state-machines')
  const acct = enumValues[`${ID_PREFIX}enums/account-state.json`]
  const content = enumValues[`${ID_PREFIX}enums/content-state.json`]

  for (const { rel, doc } of docs) {
    const transitions = doc['x-transitions']
    if (!Array.isArray(transitions) || transitions.length === 0) {
      fail(`${rel}: must declare a non-empty 'x-transitions' array`)
      continue
    }
    for (const t of transitions) {
      if (!t.from || !t.to) fail(`${rel}: transition missing 'from'/'to'`)
      if (!t.actor) fail(`${rel}: transition ${t.from}->${t.to} missing 'actor'`)
    }
    for (const f of doc['x-forbidden'] ?? []) {
      if (f.from === '*') continue
      if (transitions.some((t) => t.from === f.from && t.to === f.to)) {
        fail(`${rel}: forbidden transition ${f.from}->${f.to} is present in x-transitions`)
      }
    }
  }

  const accountSm = docs.find((d) => d.id.endsWith('/account.json'))
  if (accountSm && acct) {
    const known = new Set(acct)
    for (const t of accountSm.doc['x-transitions'] ?? []) {
      for (const s of [t.from, t.to]) {
        if (!known.has(s)) fail(`state-machines/account.json: state '${s}' not in enums/account-state.json`)
      }
    }
    if (accountSm.doc['x-luckread']?.['state-field'] !== 'account_state') {
      fail(`state-machines/account.json: x-luckread.state-field must be 'account_state'`)
    }
  }

  const contentSm = docs.find((d) => d.id.endsWith('/content.json'))
  if (contentSm && content) {
    const known = new Set(content)
    for (const t of contentSm.doc['x-transitions'] ?? []) {
      for (const s of [t.from, t.to]) {
        if (!known.has(s)) fail(`state-machines/content.json: state '${s}' not in enums/content-state.json`)
      }
    }
    if (contentSm.doc['x-luckread']?.['requires-optimistic-lock'] !== true) {
      fail(`state-machines/content.json: content transitions MUST require optimistic locking`)
    }
  }
}

/* ------------------------------------------------------------------- authz */
async function checkAuthz() {
  const { docs } = await validateJsonDomain('authz')

  const layers = docs.find((d) => d.id.endsWith('/layers.json'))?.doc
  if (!layers) {
    fail('authz: layers.json is required')
  } else {
    const ids = (layers['x-layers'] ?? []).map((l) => l.id)
    const expected = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      fail(`authz/layers.json: layers must be exactly ${expected.join(',')} (got ${ids.join(',') || 'none'})`)
    }
    const allRoles = (layers['x-layers'] ?? []).flatMap((l) => l.roles ?? [])
    for (const banned of layers['x-forbidden-roles'] ?? []) {
      if (allRoles.includes(banned)) fail(`authz/layers.json: forbidden role '${banned}' present (ADR-I001)`)
    }
    for (const required of layers['x-required-new-roles'] ?? []) {
      if (!allRoles.includes(required)) fail(`authz/layers.json: required role '${required}' missing`)
    }
    for (const l of layers['x-layers'] ?? []) {
      if (['L5', 'L6', 'L7', 'L8'].includes(l.id) && l.mfa !== true) {
        fail(`authz/layers.json: layer ${l.id} must require MFA`)
      }
    }
  }

  const inv = docs.find((d) => d.id.endsWith('/authz-cache-invariant.json'))?.doc
  if (!inv) {
    fail('authz: authz-cache-invariant.json is required')
  } else {
    const list = inv['x-invariants'] ?? []
    const ids = list.map((i) => i.id)
    for (const required of [
      'AUTHZ-CACHE-INVARIANT-001',
      'AUTHZ-CACHE-INVARIANT-002',
      'AUTHZ-CACHE-INVARIANT-003',
      'AUTHZ-CACHE-INVARIANT-004',
    ]) {
      if (!ids.includes(required)) fail(`authz-cache-invariant.json: missing ${required}`)
    }
    for (const i of list) {
      if (i.failMode !== 'fail-closed') {
        fail(`authz-cache-invariant.json: ${i.id} must declare failMode 'fail-closed'`)
      }
    }
    const dims = inv['x-principal-dimensions'] ?? []
    for (const required of ['account_state_version', 'role_version', 'organization_version', 'policy_version']) {
      if (!dims.includes(required)) {
        fail(`authz-cache-invariant.json: principal dimension '${required}' missing`)
      }
    }
    if (inv['x-sensitive-operations-cache-mode'] !== 'none') {
      fail(`authz-cache-invariant.json: sensitive operations must use cache mode 'none'`)
    }
  }

  const perms = docs.find((d) => d.id.endsWith('/permissions.json'))?.doc
  if (!perms) {
    fail('authz: permissions.json is required')
  } else {
    const list = perms['x-permissions'] ?? []
    if (list.length === 0) fail('authz/permissions.json: must declare x-permissions')
    for (const p of list) {
      if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(p.name ?? '')) {
        fail(`authz/permissions.json: permission '${p.name}' must be dotted resource.action form`)
      }
      if (!p.scope) fail(`authz/permissions.json: permission '${p.name}' missing scope`)
    }
  }
}

/* ------------------------------------------------------------------ events */
async function checkEvents() {
  const { docs } = await validateJsonDomain('events')
  const auth013 = docs.find((d) => d.id.endsWith('/identity-account-state-changed.v1.json'))
  if (!auth013) {
    fail('events: identity-account-state-changed.v1.json is required for admitted AUTH-013 event path')
    return
  }
  const required = [
    'eventId','eventType','schemaVersion','producer','resourceType','resourceId',
    'occurredAt','publishedAt','correlationId','causationId','idempotencyKey',
    'attempt','sourceVersion','actor','before','after','reason'
  ]
  for (const field of required) {
    if (!auth013.doc.properties?.[field]) fail('events/identity-account-state-changed.v1.json: missing ' + field + ' property')
  }
  if (auth013.doc.properties?.eventType?.const !== 'identity.account_state_changed') fail('events/identity-account-state-changed.v1.json: eventType must be identity.account_state_changed')
  if (auth013.doc.properties?.schemaVersion?.const !== '1.0') fail('events/identity-account-state-changed.v1.json: schemaVersion must be 1.0')
  if (auth013.doc.properties?.producer?.const !== 'W02') fail('events/identity-account-state-changed.v1.json: producer must be W02')
  if (auth013.doc.properties?.resourceType?.const !== 'User') fail('events/identity-account-state-changed.v1.json: resourceType must be User')
  if (auth013.doc['x-luckread']?.['consumer-authority'] !== 'W06') fail('events/identity-account-state-changed.v1.json: consumer authority must be W06')
  if (auth013.doc['x-luckread']?.delivery !== 'AT_LEAST_ONCE') fail('events/identity-account-state-changed.v1.json: delivery must be AT_LEAST_ONCE')
  if (auth013.doc['x-luckread']?.['dead-letter-queue'] !== 'luckread-auth013-account-state-dlq') fail('events/identity-account-state-changed.v1.json: DLQ binding is not canonical')
}

/* ----------------------------------------------------------------- openapi */
async function checkOpenApi() {
  const file = join(CONTRACTS_ROOT, 'openapi', 'v1', 'openapi.yaml')
  let info
  try {
    info = await stat(file)
  } catch {
    fail('openapi: contracts/openapi/v1/openapi.yaml is missing')
    return
  }
  if (!info.isFile()) {
    fail('openapi: openapi.yaml is not a file')
    return
  }
  const raw = await readFile(file, 'utf8')
  const pathCount = (raw.match(/^  \/[^ ].*:$/gm) ?? []).length
  if (pathCount === 0) {
    fail('openapi: no paths declared — API contract is empty and cannot admit implementation')
  }
  for (const required of ['openapi:', 'info:', 'paths:', 'components:']) {
    if (!raw.includes(required)) fail(`openapi: missing top-level key '${required}'`)
  }
  counts.openapi = pathCount
}

/* -------------------------------------------------------------------- main */
const domain = process.argv[2]
const runAll = !domain
const supported = ['common', 'enums', 'state-machines', 'authz', 'events', 'openapi']
if (domain && !supported.includes(domain)) {
  console.error(`Unsupported Contract CI domain: ${domain} (supported: ${supported.join(', ')})`)
  process.exit(2)
}

const common = runAll || domain === 'common' ? await checkCommon() : null
const { enumValues } = runAll || domain === 'enums' ? await checkEnums() : { enumValues: {} }
if (runAll || domain === 'state-machines') await checkStateMachines(enumValues)
if (runAll || domain === 'authz') await checkAuthz()
if (runAll || domain === 'events') await checkEvents()
if (runAll || domain === 'openapi') await checkOpenApi()

if (errors.length > 0) {
  console.error('\nContract CI RED — contract admission gate FAILED:')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

const summary = Object.entries(counts)
  .map(([k, v]) => `${k}=${v}`)
  .join(' ')
console.log(`Contract CI GREEN — ${summary}`)
if (common) console.log(`  common schema references resolved: ${common.refs}`)
console.log('  invariants: L0-L8 present, ADR-I001 enforced, AUTHZ-CACHE-INVARIANT-001..004 fail-closed')
