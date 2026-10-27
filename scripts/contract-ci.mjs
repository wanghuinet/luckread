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
    const mfaChallengeVerificationSource = await readFile('workers/W02-identity/src/auth/mfa-challenge-verification.ts', 'utf8')
    const mfaHookSource = await readFile('workers/W02-identity/src/auth/mfa-audit-hooks.ts', 'utf8')
    const mfaReceiptSource = await readFile('workers/W02-identity/src/auth/mfa-audit-receipts.ts', 'utf8')
    const mfaEventSource = await readFile('workers/W02-identity/src/auth/mfa-audit-events.ts', 'utf8')
    const mfaPublicationSource = await readFile('workers/W02-identity/src/auth/mfa-audit-publication-journal.ts', 'utf8')
    const mfaAuditEvidenceSource = await readFile('scripts/auth-007-mfa-audit-evidence.mjs', 'utf8')
    const mfaAuditDeliveryE2ESource = await readFile('scripts/auth-007-mfa-audit-delivery-e2e.mjs', 'utf8')
    const mfaLiveSecurityE2ESource = await readFile('scripts/auth-007-mfa-live-security-e2e.mjs', 'utf8')
    const requiredHookTokens = [
      "'/two-factor/verify-totp'",
      "'/two-factor/verify-backup-code'",
      "'/two-factor/disable'",
      "'/two-factor/generate-backup-codes'",
      "classifyMfaAuditHookOutcome",
      'createMfaAuditOperationReceipt',
      'finalizeMfaAuditOperationReceipt',
      'reconcileMfaAuditOperationReceipts',
      'isUnexpiredMfaChallengeRecord',
      'consumeTotpTimeStep',
      'auth.mfa.replay_rejected',
      'auth.mfa.locked',
    ]
    const requiredChallengeExpiryTokens = [
      'Date.parse(String(challenge.expiresAt))',
      'expiresAt > nowMs',
    ]
    const requiredReceiptTokens = [
      'recordMfaAuditEventOnce',
      'idempotencyKey: event.idempotencyKey',
      "'OUTBOX_WRITE_FAILED'",
      "'OUTCOME_NOT_FINALIZED'",
    ]
    const requiredAuditEvidenceTokens = [
      'SCENARIO_SPECIFIC_MFA_AUDIT_EVENT_TYPES',
      'reconcileEventIds',
      'canonicalTypeById.get(row.eventId) === eventType',
      'allTenEventTypesVerified',
    ]
    const requiredAuditDeliveryE2ETokens = [
      'readScopedOutboxEventRows',
      'readScopedCanonicalAuditEventRows',
      'eventIdsComparedInMemoryOnly',
      'rawEventIdentifiersStored: false',
    ]
    const requiredLiveMfaNegativeTestTokens = [
      'authenticated_session_is_not_accepted_as_signin_challenge',
      'challenge_rejects_caller_supplied_account_subject',
      'negative_test_has_nonmatching_signin_challenge_code',
      'invalid_totp_is_rejected_inside_w02_challenge_flow',
      'mfa_enrollment_rejects_wrong_current_password_without_disclosing_one_time_material',
      'recovery_code_rotation_requires_password_and_fresh_totp_and_replaces_entire_set',
      'pre_rotation_unused_recovery_code_is_invalidated',
      'newly_rotated_recovery_code_completes_signin_without_json_token_leak',
    ]
    const requiredTimestampSemanticTokens = [
      'const publishedAt = new Date().toISOString()',
      'event.publishedAt,',
      'const occurredAt = input.occurredAt ?? new Date().toISOString()',
      'SET status = ?, published_at = ?',
    ]
    if (!(await fileExists('workers/W02-identity/src/auth/mfa-audit-hooks.test.ts')) ||
        !(await fileExists('workers/W02-identity/src/auth/mfa-audit-events.test.ts')) ||
        !(await fileExists('workers/W02-identity/src/auth/mfa-audit-receipts.test.ts')) ||
        !requiredHookTokens.every((token) => mfaProducerSource.includes(token)) ||
        !requiredChallengeExpiryTokens.every((token) => mfaChallengeVerificationSource.includes(token)) ||
        !(await fileExists('workers/W02-identity/src/auth/mfa-challenge-verification.test.ts')) ||
        !requiredReceiptTokens.every((token) => mfaReceiptSource.includes(token)) ||
        !requiredAuditEvidenceTokens.every((token) => mfaAuditEvidenceSource.includes(token)) ||
        !requiredAuditDeliveryE2ETokens.every((token) => mfaAuditDeliveryE2ESource.includes(token)) ||
        !requiredLiveMfaNegativeTestTokens.every((token) => mfaLiveSecurityE2ESource.includes(token)) ||
        !requiredTimestampSemanticTokens.every((token) =>
          token === 'SET status = ?, published_at = ?'
            ? mfaPublicationSource.includes(token)
            : mfaEventSource.includes(token)
        ) ||
        !(await fileExists('scripts/auth-007-mfa-audit-evidence.test.mjs')) ||
        !(await fileExists('workers/W02-identity/src/auth/mfa-audit-events.test.ts')) ||
        !(await fileExists('workers/W02-identity/src/auth/mfa-audit-publication-journal.test.ts')) ||
        !mfaEventSource.includes('auth_007_mfa_publication_journal') ||
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


/* ---------------------------------------------------- PAY-002 candidate model */
async function checkOrderContractCandidate() {
  const readContract = async (rel) => loadJson(resolve(rel));
  const catalog = await readContract('contracts/entity/entity-catalog.v1.json');
  const fields = await readContract('contracts/entity/entity-field-contract.v1.json');
  const order = await readContract('contracts/entity/ORDER-ENTITY-CONTRACT.v1.json');
  const line = await readContract('contracts/entity/ORDER-LINE-ENTITY-CONTRACT.v1.json');
  const persistence = await readContract('contracts/persistence/ORDER-D1-04-persistence.v1.json');
  const state = await readContract('contracts/state-machines/order.json');
  const apiCandidate = await readContract('contracts/candidates/PAY-002/order-commerce-api.v1.json');
  const apiAdmission = await readContract('contracts/candidates/PAY-002/order-api-admission.v1.json');
  const boundary = await readContract('contracts/transport/worker-d1-access-boundary.v1.json');
  const batch = await readContract('contracts/alignment/mapping-batches/B13-B15-creator-membership-commerce.v1.json');
  if (![catalog, fields, order, line, persistence, state, apiCandidate, apiAdmission, boundary, batch].every(Boolean)) return;
  const entityById = new Map((catalog.records ?? []).map((r) => [r.entityId, r]));
  const fieldsById = new Map((fields.records ?? []).map((r) => [r.entityId, r]));
  const expected = [
    { id: 'ENT-ORDER', contract: order },
    { id: 'ENT-ORDER-LINE', contract: line },
  ];
  for (const item of expected) {
    const entity = entityById.get(item.id);
    const fieldRecord = fieldsById.get(item.id);
    if (!entity || entity.status !== 'PROPOSED' || entity.domainId !== 'D1-04') fail(item.id + ': must remain a D1-04 PROPOSED entity during PAY-002 admission');
    if (item.contract.status !== 'CONTRACTED_NOT_VERIFIED') fail(item.id + ': entity contract must remain CONTRACTED_NOT_VERIFIED until evidence is admitted');
    if (!fieldRecord || fieldRecord.status !== 'CONTRACTED_NOT_VERIFIED') { fail(item.id + ': missing non-green field contract record'); continue; }
    const contractFieldIds = new Set((item.contract.fields ?? []).map((f) => f.fieldId));
    const registryFieldIds = new Set((fieldRecord.fields ?? []).map((f) => f.fieldId));
    if (contractFieldIds.size !== registryFieldIds.size || [...contractFieldIds].some((id) => !registryFieldIds.has(id))) fail(item.id + ': entity fields do not match canonical field registry');
  }
  if (persistence.status !== 'CONTRACTED_NOT_VERIFIED') fail('ORDER-D1-04-persistence must remain CONTRACTED_NOT_VERIFIED');
  if (persistence.authoritativeDomain !== 'D1-04' || persistence.primaryWorker !== 'W07') fail('Order persistence authority must be D1-04 / W07');
  if (persistence.physicalResource?.binding !== 'D1_04' || persistence.physicalResource?.databaseUuid !== boundary.physicalD1Registry?.['D1-04']) fail('Order persistence candidate must use registered D1-04 UUID and binding');
  const physical = persistence.physicalResource;
  const preflight = physical?.preflightEvidence;
  if (physical?.remoteNamePreflightRequired !== true) fail('Order persistence must require a fresh read-only name preflight before future deployment/mutation');
  if (physical?.databaseName !== 'unimportant' ||
      preflight?.databaseUuid !== boundary.physicalD1Registry?.['D1-04'] ||
      preflight?.configuredName !== physical.databaseName ||
      preflight?.liveName !== physical.databaseName ||
      preflight?.displayNameMatches !== true ||
      preflight?.readOnly !== true ||
      preflight?.sourceSha !== '115c7165f3a618fb9527be8030db378476d3740d' ||
      preflight?.result !== 'SCHEMA_SNAPSHOT_COLLECTED' ||
      preflight?.workflowRunUrl !== 'https://github.com/wanghuinet/luckread/actions/runs/40576180128' ||
      preflight?.artifactUrl !== 'https://github.com/wanghuinet/luckread/actions/runs/40576180128/artifacts/12767836622') {
    fail('Order persistence must bind its physical name claim to exact read-only D1-04 preflight evidence');
  }
  if (persistence.migration?.status !== 'PROPOSED_NOT_APPLIED' ||
      persistence.migration?.targetBinding !== 'D1_04' ||
      persistence.migration?.file !== 'workers/W07-subscription-commerce/migrations-d1-04/0001_order_commerce.sql' ||
      persistence.migration?.id !== '0001_order_commerce' ||
      persistence.migration?.appliedRemotely !== false) {
    fail('PAY-002 D1-04 migration must be an isolated source candidate and remain unapplied');
  }
  const w07Config = await readContract('workers/W07-subscription-commerce/wrangler.jsonc');
  const configuredD101 = (w07Config?.d1_databases ?? []).find((db) => db.binding === 'D1_01');
  const configuredD104 = (w07Config?.d1_databases ?? []).find((db) => db.binding === 'D1_04');
  if (configuredD101?.migrations_dir !== 'migrations' ||
      configuredD104?.migrations_dir !== 'migrations-d1-04') {
    fail('PAY-002 must keep D1-01 migrations separate from the D1-04 order migration directory');
  }
  if (!await fileExists(resolve('workers/W07-subscription-commerce/migrations-d1-04/0001_order_commerce.sql'))) {
    fail('PAY-002 source candidate migration file is missing');
  }
  if (persistence.runtimeGates?.migrationExecution !== 'CANDIDATE_ONLY_NOT_APPLIED') {
    fail('PAY-002 migration evidence must not imply a remote schema change');
  }
  const validFieldIds = new Set([...(order.fields ?? []).map((f) => f.fieldId), ...(line.fields ?? []).map((f) => f.fieldId)]);
  const validEntityFields = new Map([
    ...(order.fields ?? []).map((f) => [f.fieldId, { entityId: 'ENT-ORDER', field: f }]),
    ...(line.fields ?? []).map((f) => [f.fieldId, { entityId: 'ENT-ORDER-LINE', field: f }]),
  ]);
  const validateDtoMappings = (schemaName, expectedEntityId) => {
    const schema = apiCandidate.dtoSchemas?.[schemaName];
    const mappings = apiCandidate.entityMappings?.[schemaName];
    if (!schema || !mappings || typeof mappings !== 'object') {
      fail('PAY-002 missing explicit DTO-to-entity mapping for ' + schemaName);
      return;
    }
    const propertyNames = Object.keys(schema.properties ?? []).sort();
    const mappedNames = Object.keys(mappings).sort();
    if (JSON.stringify(propertyNames) !== JSON.stringify(mappedNames)) {
      fail('PAY-002 DTO mapping properties do not exactly match ' + schemaName);
    }
    for (const [propertyName, mapping] of Object.entries(mappings)) {
      if (schemaName === 'CommerceOrderData' && propertyName === 'items') {
        if (mapping?.kind !== 'related-entity-collection' ||
            mapping.entityId !== 'ENT-ORDER-LINE' ||
            mapping.table !== 'order_lines' ||
            mapping.parentTable !== 'orders' ||
            mapping.parentColumn !== 'order_id' ||
            mapping.childColumn !== 'order_id' ||
            mapping.dtoSchema !== 'CommerceOrderLineResponse') {
          fail('PAY-002 CommerceOrderData.items must map to the same-D1-04 OrderLine relation');
        }
        continue;
      }
      if (mapping?.kind !== 'entity-field' ||
          mapping.entityId !== expectedEntityId ||
          !validEntityFields.has(mapping.fieldId)) {
        fail('PAY-002 DTO property ' + schemaName + '.' + propertyName + ' must map to one canonical entity field');
        continue;
      }
      const canonicalField = validEntityFields.get(mapping.fieldId);
      if (canonicalField?.entityId !== expectedEntityId) {
        fail('PAY-002 DTO property ' + schemaName + '.' + propertyName + ' maps to the wrong entity field');
      }
      const column = persistence.tables?.[mapping.table]?.columns?.[mapping.column];
      if (!column || column.fieldId !== mapping.fieldId) {
        fail('PAY-002 DTO property ' + schemaName + '.' + propertyName + ' does not match the persistence fieldId');
      }
    }
  };
  validateDtoMappings('CommerceOrderData', 'ENT-ORDER');
  validateDtoMappings('CommerceOrderLineResponse', 'ENT-ORDER-LINE');
  const responseWrapper = apiCandidate.entityMappings?.CommerceOrderResponse;
  if (JSON.stringify(Object.keys(apiCandidate.dtoSchemas?.CommerceOrderResponse?.properties ?? {}).sort()) !==
      JSON.stringify(Object.keys(responseWrapper ?? {}).sort()) ||
      responseWrapper?.data?.kind !== 'nested-dto' ||
      responseWrapper?.data?.dtoSchema !== 'CommerceOrderData' ||
      responseWrapper?.requestId?.kind !== 'transport-generated' ||
      responseWrapper?.requestId?.persisted !== false) {
    fail('PAY-002 CommerceOrderResponse wrapper mapping is incomplete');
  }
  const requestMapping = apiCandidate.entityMappings?.createRequest;
  if (requestMapping?.['items[].itemRef']?.kind !== 'authoritative-offer-resolution' ||
      requestMapping?.['items[].itemRef']?.persistedDirectly !== false ||
      requestMapping?.['items[].quantity']?.kind !== 'validated-input' ||
      requestMapping?.['Idempotency-Key']?.table !== 'order_create_idempotency' ||
      requestMapping?.['Idempotency-Key']?.operationValue !== 'POST /v1/commerce/orders' ||
      requestMapping?.customerId?.kind !== 'server-derived' ||
      requestMapping?.customerId?.clientSupplied !== false ||
      requestMapping?.customerId?.publicResponse !== false) {
    fail('PAY-002 request-to-persistence mapping must preserve offer authority, idempotency scope and principal-derived customer ownership');
  }
  const excluded = new Set((apiCandidate.entityMappings?.excludedPersistenceFields ?? []).map((entry) => entry.source));
  for (const required of ['orders.customer_id', 'order_lines.item_snapshot_json', 'order_create_idempotency.*']) {
    if (!excluded.has(required)) fail('PAY-002 response mapping must explicitly exclude ' + required);
  }
  const mappingEvidence = (apiAdmission.requiredEvidence ?? []).find((entry) => entry.id === 'ENTITY-MAPPING-01');
  if (!mappingEvidence || mappingEvidence.status !== 'ADMITTED') {
    fail('PAY-002 ENTITY-MAPPING-01 must be admitted only with the executable DTO mapping checks above');
  }
  const bindingEvidence = (apiAdmission.requiredEvidence ?? []).find((entry) => entry.id === 'D1-04-BINDING-01');
  if (!bindingEvidence || bindingEvidence.status !== 'ADMITTED') {
    fail('PAY-002 D1-04-BINDING-01 must match the verified physical identity evidence');
  }
  const schemaEvidence = (apiAdmission.requiredEvidence ?? []).find((entry) => entry.id === 'D1-04-SCHEMA-01');
  if (!schemaEvidence || schemaEvidence.status !== 'PENDING') {
    fail('PAY-002 D1-04-SCHEMA-01 must remain pending until migration and postflight evidence pass');
  }
  for (const tableName of ['orders', 'order_lines']) {
    const table = persistence.tables?.[tableName];
    if (!table) { fail('Order persistence candidate missing table ' + tableName); continue; }
    for (const [columnName, column] of Object.entries(table.columns ?? {})) {
      if (!column.fieldId || !validFieldIds.has(column.fieldId)) fail('Order persistence ' + tableName + '.' + columnName + ': fieldId must resolve to a candidate entity field');
    }
  }
  const states = new Set(state['x-luckread']?.states ?? []);
  if (state['x-luckread']?.['state-field'] !== 'status' || state['x-luckread']?.['version-field'] !== 'version' || state['x-luckread']?.['requires-optimistic-lock'] !== true) fail('Order state machine must require status + version compare-and-set');
  for (const transition of state['x-transitions'] ?? []) if (!states.has(transition.from) || !states.has(transition.to)) fail('Order state machine references unknown state ' + transition.from + '->' + transition.to);
  const pay002 = (batch.records ?? []).find((r) => r.featureId === 'PAY-002');
  if (!pay002 || pay002.status !== 'UNRESOLVED') fail('PAY-002 must remain UNRESOLVED until full API/runtime/evidence admission');
  if (!pay002?.evidenceRefs?.includes('contracts/entity/ORDER-ENTITY-CONTRACT.v1.json')) fail('PAY-002 mapping batch must link candidate entity evidence');
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
if (runAll || domain === 'state-machines') await checkOrderContractCandidate()
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
