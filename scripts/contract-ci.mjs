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

async function fileExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
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

async function checkUpstreamImmutabilityContract() {
  const rel = 'payload/upstream-product-immutability.v1.json'
  const schemaRel = 'payload/upstream-product-immutability.v1.schema.json'
  const doc = await loadJson(join(CONTRACTS_ROOT, rel))
  const schema = await loadJson(join(CONTRACTS_ROOT, schemaRel))
  if (!doc) return
  if (!schema) return
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    fail(`${schemaRel}: must declare JSON Schema Draft 2020-12`)
  }
  if (schema.$id !== `${ID_PREFIX}payload/upstream-product-immutability.v1.schema.json`) {
    fail(`${schemaRel}: $id is not canonical`)
  }
  if (doc.version !== '1.0.0' || doc.status !== 'ACTIVE') {
    fail(`${rel}: must be ACTIVE version 1.0.0`)
  }
  const products = doc.products ?? []
  const productPairs = products.map((p) => [p?.name, p?.package, p?.sourceAuthority])
  const expected = [
    ['Payload', 'payload', 'upstream-npm'],
    ['Better Auth', 'better-auth', 'upstream-npm'],
  ]
  if (JSON.stringify(productPairs) !== JSON.stringify(expected)) {
    fail(`${rel}: products must canonically identify Payload and Better Auth as upstream-npm`)
  }
  if (doc.rules?.upstreamSourceImmutable !== true) {
    fail(`${rel}: upstreamSourceImmutable must be true`)
  }
  const forbidden = new Set(doc.rules?.forbiddenMechanisms ?? [])
  for (const required of ['source-modification', 'fork', 'vendoring', 'patch-package', 'monkey-patch', 'local-file-dependency']) {
    if (!forbidden.has(required)) fail(`${rel}: missing forbidden mechanism '${required}'`)
  }
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
  const mfaAuditBinding = docs.find((d) => d.id.endsWith('/AUTH-007-mfa-audit-binding.v1.json'))
  const domainCompletion = docs.find((d) => d.id.endsWith('/domain-completion.v1.json'))
  const mfaApi = await loadJson(join(CONTRACTS_ROOT, 'api', 'AUTH-007-mfa-totp-contract.v1.json'))

  if (!mfaAuditBinding) {
    fail('events: AUTH-007-mfa-audit-binding.v1.json is required to register MFA audit events')
  } else if (mfaApi) {
    const expectedEventNames = mfaApi.auditEventsRequired ?? []
    const boundEvents = mfaAuditBinding.doc.events ?? []
    const boundNames = boundEvents.map((event) => event.name)
    const boundNameSet = new Set(boundNames)
    const apiOperationIds = new Set((mfaApi.operations ?? []).map((operation) => operation.operationId))

    if (expectedEventNames.length === 0) fail('api/AUTH-007-mfa-totp-contract.v1.json: auditEventsRequired must be non-empty')
    if (boundNameSet.size !== boundNames.length) fail('events/AUTH-007-mfa-audit-binding.v1.json: duplicate MFA event name')
    for (const eventName of expectedEventNames) {
      if (!boundNameSet.has(eventName)) fail('events/AUTH-007-mfa-audit-binding.v1.json: missing canonical MFA event ' + eventName)
    }
    for (const eventName of boundNames) {
      if (!expectedEventNames.includes(eventName)) fail('events/AUTH-007-mfa-audit-binding.v1.json: unregistered MFA event ' + eventName)
    }

    for (const event of boundEvents) {
      const operationIds = event.operationIds ?? (event.operationId ? [event.operationId] : [])
      if (operationIds.length === 0) fail('events/AUTH-007-mfa-audit-binding.v1.json: event missing operation binding ' + event.name)
      for (const operationId of operationIds) {
        if (!apiOperationIds.has(operationId)) fail('events/AUTH-007-mfa-audit-binding.v1.json: unknown AUTH-007 operation ' + operationId)
      }
      if (event.targetType !== 'User') fail('events/AUTH-007-mfa-audit-binding.v1.json: targetType must remain User for ' + event.name)
    }

    const delivery = mfaAuditBinding.doc.delivery ?? {}
    if (delivery.newWorkerD1QueueOrServiceBindingAllowed !== false) {
      fail('events/AUTH-007-mfa-audit-binding.v1.json: must forbid a new Worker, D1, Queue, or Service Binding')
    }
    if (delivery.existingW02ToW06Binding !== 'AUTH013_QUEUE' ||
        delivery.existingQueueName !== 'luckread-auth013-account-state') {
      fail('events/AUTH-007-mfa-audit-binding.v1.json: MFA audit must reuse the existing W02-to-W06 AUTH013_QUEUE')
    }
    if (delivery.sourceImplementationStatus !== 'IMPLEMENTED_IN_SOURCE_NOT_PRODUCTION_VERIFIED') {
      fail('events/AUTH-007-mfa-audit-binding.v1.json: source implementation status must not imply production verification')
    }
    const coverage = mfaAuditBinding.doc.runtimeEmissionCoverage ?? {}
    const implemented = coverage.implementedInW02Source ?? []
    const notYetEmitted = coverage.notYetEmittedByW02 ?? []
    const coverageNames = [...implemented, ...notYetEmitted]
    if (new Set(coverageNames).size !== coverageNames.length ||
        expectedEventNames.some((eventName) => !coverageNames.includes(eventName)) ||
        coverageNames.some((eventName) => !expectedEventNames.includes(eventName))) {
      fail('events/AUTH-007-mfa-audit-binding.v1.json: runtime emission coverage must account for every canonical event exactly once')
    }
    const expectedImplemented = [
      'auth.mfa.enrollment_started',
      'auth.mfa.enrollment_verified',
      'auth.mfa.enrollment_failed',
      'auth.mfa.challenge_succeeded',
      'auth.mfa.challenge_failed',
      'auth.mfa.factor_disabled',
      'auth.mfa.recovery_codes_rotated',
      'auth.mfa.recovery_code_consumed',
      'auth.mfa.locked',
      'auth.mfa.replay_rejected',
    ]
    if (JSON.stringify(implemented) !== JSON.stringify(expectedImplemented) ||
        (coverage.notYetEmittedByW02 ?? []).length !== 0) {
      fail('events/AUTH-007-mfa-audit-binding.v1.json: all ten canonical event producers must be source-implemented and none may be reported as missing')
    }
    const mfaProducerSource = await readFile('workers/W02-identity/src/auth/better-auth.ts', 'utf8')
    const mfaHookSource = await readFile('workers/W02-identity/src/auth/mfa-audit-hooks.ts', 'utf8')
    const requiredHookTokens = [
      "'/two-factor/verify-totp'",
      "'/two-factor/verify-backup-code'",
      "'/two-factor/disable'",
      "'/two-factor/generate-backup-codes'",
      "classifyMfaAuditHookOutcome",
      'recordMfaAuditEventOnce',
      'consumeTotpTimeStep',
      'auth.mfa.replay_rejected',
      'auth.mfa.locked',
    ]
    if (!(await fileExists('workers/W02-identity/src/auth/mfa-audit-hooks.test.ts')) ||
        !(await fileExists('workers/W02-identity/src/auth/mfa-audit-events.test.ts')) ||
        !requiredHookTokens.every((token) => mfaProducerSource.includes(token)) ||
        !["auth.mfa.challenge_succeeded", "auth.mfa.challenge_failed",
          "auth.mfa.factor_disabled", "auth.mfa.recovery_codes_rotated",
          "auth.mfa.recovery_code_consumed"].every((token) => mfaHookSource.includes(token))) {
      fail('events/AUTH-007-mfa-audit-binding.v1.json: reviewed W02 lifecycle hooks must implement the declared challenge, factor, recovery, lockout and replay events')
    }
    if (coverage.consumerSupportsAllRegisteredEvents !== true) {
      fail('events/AUTH-007-mfa-audit-binding.v1.json: W06 consumer coverage must be explicit')
    }
  }

  if (!domainCompletion) {
    fail('events: domain-completion.v1.json is required for canonical domain event registration')
  } else {
    const registered = new Map((domainCompletion.doc['x-events'] ?? []).map((event) => [event.name, event.aggregate]))
    const expectedMfaEvents = [
      'auth.mfa.enrollment_started',
      'auth.mfa.enrollment_verified',
      'auth.mfa.enrollment_failed',
      'auth.mfa.challenge_succeeded',
      'auth.mfa.challenge_failed',
      'auth.mfa.factor_disabled',
      'auth.mfa.recovery_codes_rotated',
      'auth.mfa.recovery_code_consumed',
      'auth.mfa.locked',
      'auth.mfa.replay_rejected',
    ]
    for (const eventName of expectedMfaEvents) {
      if (registered.get(eventName) !== 'User') {
        fail('events/domain-completion.v1.json: missing MFA event or wrong aggregate for ' + eventName)
      }
    }
  }
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
  if (auth013.doc['x-luckread']?.destinations?.audit?.['dead-letter-queue'] !== 'luckread-auth013-account-state-dlq') fail('events/identity-account-state-changed.v1.json: audit DLQ binding is not canonical')
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

await checkUpstreamImmutabilityContract()

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
