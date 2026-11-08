#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const paths = {
  review: 'contracts/database/neon-d1-03-shared-runner-independent-review.v1.json',
  manifest: 'contracts/database/neon-d1-03-shared-migration-manifest.v1.json',
  entityBoundary: 'contracts/transport/d1-03-entity-owner-boundary.v1.json',
  accessBoundary: 'contracts/transport/worker-d1-access-boundary.v1.json',
  w06Schema: 'contracts/database/neon-d1-03-w06-moderation-schema.v1.json',
  w09Schema: 'contracts/database/neon-d1-03-w09-platform-schema.v1.json',
  w10Schema: 'contracts/database/neon-d1-03-w10-execution-schema.v1.json',
  w09Reconciliation: 'contracts/database/neon-d1-03-w09-owner-reconciliation.v1.json',
  w11Reconciliation: 'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json',
  notifyPersistence: 'contracts/persistence/NOTIFY-002-W05-D1-03-PUSH-ENDPOINT-PERSISTENCE.v1.json',
  notifyDelivery: 'contracts/transport/W05-W09-notification-push-delivery.v1.json',
  w06Wrangler: 'workers/W06-governance/wrangler.jsonc',
  w09Wrangler: 'workers/W09-platform/wrangler.d1-03-migrations.jsonc',
  w10Wrangler: 'workers/W10-async/wrangler.jsonc',
  w11Wrangler: 'workers/W11-growth-campaign-analytics-operations/wrangler.jsonc',
  sharedRunner: 'scripts/neon/shared-domain-schema-runner.mjs',
  w06Artifact: 'workers/W06-governance/src/neon-postgres-migrations/0001_w06_d1_03_moderation_schema.sql',
  w09Artifact: 'workers/W09-platform/src/neon-postgres-migrations/0001_w09_d1_03_platform_schema.sql',
  w10Artifact: 'workers/W10-async/src/neon-postgres-migrations/0001_w10_d1_03_async_execution.sql',
}

const fail = (message) => { throw new Error('D1-03 independent review: ' + message) }
const readText = (relativePath) => readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
const readJson = (relativePath, readSource) => JSON.parse(readSource(relativePath))

export function gitBlobSha1(content) {
  const bytes = Buffer.from(content, 'utf8')
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.length + '\0', 'utf8'))
    .update(bytes)
    .digest('hex')
}

function sameSet(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

function namesIn(sql, pattern) {
  return [...String(sql).matchAll(pattern)].map((match) => match[1])
}

function sqlReferenceTargets(sql) {
  const code = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^--.*$/gm, ' ')
    .replace(/(\\$[A-Za-z_0-9]*\\$)[\\s\\S]*?\\1/g, ' ')
    .replace(/'(?:''|[^'])*'/g, ' ')
  return namesIn(code, /\\bREFERENCES\\s+(?:(?:public)\\s*\\.\\s*)?"?([A-Za-z_][A-Za-z0-9_$]*)"?/gim)
}

function assertD103Target(contract, label) {
  if (contract.target?.domainId !== 'D1-03' ||
      contract.target?.databaseName !== 'luckread_governance' ||
      contract.target?.cloudflareD1DatabaseUuid !== 'bda1d247-a371-4244-91ae-aef96034db7f' ||
      contract.target?.postgresMajor !== 18 ||
      contract.target?.businessDataImport !== false ||
      contract.target?.productionCutoverAuthorized !== false) {
    fail(label + ' schema contract target, empty-data or cutover safety declaration drifted')
  }
}

export function verifyD103SharedRunnerReview({ readSource = readText } = {}) {
  const review = readJson(paths.review, readSource)
  const manifest = readJson(paths.manifest, readSource)
  const entityBoundary = readJson(paths.entityBoundary, readSource)
  const accessBoundary = readJson(paths.accessBoundary, readSource)
  const w06Schema = readJson(paths.w06Schema, readSource)
  const w09Schema = readJson(paths.w09Schema, readSource)
  const w10Schema = readJson(paths.w10Schema, readSource)
  const w09Reconciliation = readJson(paths.w09Reconciliation, readSource)
  const w11Reconciliation = readJson(paths.w11Reconciliation, readSource)
  const notifyPersistence = readJson(paths.notifyPersistence, readSource)
  const notifyDelivery = readJson(paths.notifyDelivery, readSource)
  const w06Wrangler = readJson(paths.w06Wrangler, readSource)
  const w09Wrangler = readJson(paths.w09Wrangler, readSource)
  const w10Wrangler = readJson(paths.w10Wrangler, readSource)
  const w11Wrangler = readJson(paths.w11Wrangler, readSource)
  const runner = readSource(paths.sharedRunner)

  if (review.status !== 'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED' ||
      review.review?.reviewKind !== 'AUTOMATED_INDEPENDENT_READ_ONLY_CODE_PATH_REVIEW' ||
      review.review?.sharedExecutorPullRequest !== 1660 ||
      review.review?.sharedExecutorHeadCommit !== '5e8bfaf7bd26fe8669c08de1e062d998c4f4c6de' ||
      review.review?.sharedPostgres18WorkflowRunId !== 42509822425 ||
      review.review?.reviewedMainCommit !== '4ed51dd2c105b38c15ca94fce496485facd83c58') {
    fail('review evidence must bind to the merged shared executor and its completed PG18 run')
  }
  if (review.remoteApplyReady !== false ||
      review.businessDataImport !== false ||
      review.productionCutoverAuthorized !== false) {
    fail('independent local review must never admit remote apply, business data import or cutover')
  }
  for (const key of ['newWorkers','newD1Databases','newQueues','newServiceBindings']) {
    if (review.safety?.[key] !== 0) fail('review.safety.' + key + ' must remain zero')
  }
  for (const key of ['runtimeBindingsChanged','remoteNeonDdlExecuted','cloudflareD1Touched',
    'businessDataImported','productionCutoverAuthorized']) {
    if (review.safety?.[key] !== false) fail('review.safety.' + key + ' must remain false')
  }

  const pins = review.review?.reviewedSourcePins
  if (!Array.isArray(pins) || pins.length < 15) fail('review must pin every ownership, runner and D1-03 SQL source file')
  const pinnedPaths = new Set()
  for (const pin of pins) {
    if (!pin || typeof pin.path !== 'string' || pinnedPaths.has(pin.path) ||
        !/^[0-9a-f]{40}$/.test(pin.gitBlobSha1 || '')) {
      fail('review source pins must have unique paths and exact Git blob SHA-1 values')
    }
    const source = readSource(pin.path)
    if (gitBlobSha1(source) !== pin.gitBlobSha1) fail('reviewed source drifted: ' + pin.path)
    pinnedPaths.add(pin.path)
  }
  for (const requiredPath of [
    paths.sharedRunner, paths.manifest, paths.entityBoundary, paths.accessBoundary,
    paths.w06Schema, paths.w09Schema, paths.w10Schema, paths.w06Artifact,
    paths.w09Artifact, paths.w10Artifact,
  ]) {
    if (!pinnedPaths.has(requiredPath)) fail('review does not pin required source: ' + requiredPath)
  }

  if (manifest.domainId !== 'D1-03' ||
      manifest.databaseName !== 'luckread_governance' ||
      manifest.cloudflareD1DatabaseUuid !== accessBoundary.physicalD1Registry?.['D1-03'] ||
      manifest.postgresMajor !== 18 ||
      manifest.remoteApplyReady !== false ||
      manifest.businessDataImport !== false ||
      manifest.productionCutoverAuthorized !== false ||
      manifest.expected?.businessRows !== 0 ||
      manifest.expected?.controlSeedRows !== 0 ||
      (manifest.seedRows ?? []).length !== 0) {
    fail('D1-03 manifest target, empty-data and remote-apply restrictions drifted')
  }
  if (!Array.isArray(manifest.remoteApplyBlockers) || manifest.remoteApplyBlockers.length < 3) {
    fail('D1-03 manifest must retain its Appeal, W11 and independent release blockers')
  }

  const expectedEntries = [
    {
      migrationId: 'd1-03-w06-moderation-schema-v1',
      ownerWorker: 'W06',
      logicalOwnerWorker: 'W06',
      order: 100,
      artifact: paths.w06Artifact,
      contract: paths.w06Schema,
      dependsOn: [],
    },
    {
      migrationId: 'd1-03-w09-platform-schema-v1',
      ownerWorker: 'W09',
      logicalOwnerWorker: 'W09',
      order: 200,
      artifact: paths.w09Artifact,
      contract: paths.w09Schema,
      dependsOn: ['d1-03-w06-moderation-schema-v1'],
    },
    {
      migrationId: 'd1-03-w10-async-execution-schema-v1',
      ownerWorker: 'W09',
      logicalOwnerWorker: 'W10',
      migrationConfigOwner: 'W09',
      order: 300,
      artifact: paths.w10Artifact,
      contract: paths.w10Schema,
      dependsOn: ['d1-03-w09-platform-schema-v1'],
    },
  ]
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== expectedEntries.length) {
    fail('D1-03 must have exactly the three admitted W06/W09/W10 schema entries')
  }
  for (let index = 0; index < expectedEntries.length; index++) {
    const actual = manifest.entries[index]
    const expected = expectedEntries[index]
    if (actual.migrationId !== expected.migrationId ||
        actual.ownerWorker !== expected.ownerWorker ||
        actual.logicalOwnerWorker !== expected.logicalOwnerWorker ||
        actual.order !== expected.order ||
        actual.schemaContract !== expected.contract ||
        !sameSet(actual.artifactPaths, [expected.artifact]) ||
        !sameSet(actual.dependsOn ?? [], expected.dependsOn) ||
        (expected.migrationConfigOwner && actual.migrationConfigOwner !== expected.migrationConfigOwner)) {
      fail('D1-03 ordered migration/ledger owner mapping drifted at position ' + index)
    }
  }
  if (manifest.entries.some((entry) => entry.ownerWorker === 'W10') ||
      manifest.entries.some((entry) => entry.ownerWorker === 'W11')) {
    fail('W10 logical owner must remain W09 ledger/config owner; W11 has no D1-03 physical migration')
  }

  if (entityBoundary.domain !== 'D1-03' ||
      !sameSet(entityBoundary.owners?.W06 ?? [], [
        'ModerationCase','ModerationDecision','Report','Appeal',
      ]) ||
      !sameSet(entityBoundary.owners?.W09 ?? [], [
        'NotificationPushEndpoint','PlatformRuntime','ReconciliationOperation','RecoveryOperation',
      ]) ||
      !sameSet(entityBoundary.owners?.W10 ?? [], [
        'Job','Retry','DLQ','ExecutionInbox','ExecutionOutbox','OperationalIdempotency',
      ]) ||
      !sameSet(entityBoundary.owners?.W11 ?? [], ['Campaign','GrowthOperation']) ||
      entityBoundary.crossCutting?.AuditEvent?.owner !== 'W09') {
    fail('canonical D1-03 logical entity owner boundary changed or lost an owner partition')
  }

  const pushDelegation = entityBoundary.scopedDelegations?.NotificationPushEndpoint
  if (pushDelegation?.primaryOwner !== 'W09' ||
      pushDelegation?.delegatedWriter !== 'W05' ||
      !sameSet(pushDelegation.allowedOperations ?? [], [
        'PUT /v1/push/endpoints/{installationId}',
        'DELETE /v1/push/endpoints/{installationId}',
      ]) ||
      pushDelegation.delegatedDeliveryRuntime?.worker !== 'W05' ||
      !sameSet(pushDelegation.delegatedDeliveryRuntime?.allowedOperations ?? [], [
        'resolveActiveRecipientPushEndpoints',
        'clearProviderInvalidExpoToken',
      ]) ||
      notifyPersistence?.authority?.primaryWorker !== 'W09' ||
      notifyPersistence?.authority?.scopedWriter?.worker !== 'W05' ||
      notifyDelivery?.primaryOwner?.worker !== 'W09' ||
      notifyDelivery?.delegatedRuntime?.worker !== 'W05' ||
      !sameSet((notifyDelivery?.operations ?? []).map((item) => item.id), [
        'resolveActiveRecipientPushEndpoints',
        'clearProviderInvalidExpoToken',
      ])) {
    fail('W05 NotificationPushEndpoint delegation must remain narrow and W09-owned')
  }

  for (const worker of ['W05','W06','W09','W10','W11']) {
    if (!(accessBoundary.workers?.[worker]?.allowedDomains ?? []).includes('D1-03')) {
      fail(worker + ' canonical D1-03 access boundary was removed without separate contract review')
    }
  }
  if (accessBoundary.physicalD1Registry?.['D1-03'] !== 'bda1d247-a371-4244-91ae-aef96034db7f') {
    fail('physical D1-03 UUID differs from the frozen registry')
  }

  for (const [label, contract, owner] of [
    ['W06',w06Schema,'W06'],
    ['W09',w09Schema,'W09'],
    ['W10',w10Schema,'W10'],
  ]) {
    assertD103Target(contract,label)
    if (contract.primaryOwner?.worker !== owner ||
        !String(contract.status ?? '').includes('REHEARSAL_PASSED')) {
      fail(label + ' source schema contract owner or PG18 rehearsal status drifted')
    }
  }
  if (!sameSet(w06Schema.scope?.includedTables ?? [], [
    'moderation_cases','moderation_decisions','moderation_decision_idempotency',
    'moderation_txn_guard','moderation_enforcement_outbox','moderation_reports',
    'moderation_report_idempotency',
  ]) ||
      !w06Schema.primaryOwner?.deferredOwnedEntities?.includes('Appeal') ||
      !w06Schema.scope?.excludedEntities?.some((item) => item.entity === 'Appeal') ||
      !w06Schema.scope?.excludedEntities?.some((item) => item.entity === 'AuditEvent')) {
    fail('W06 schema must keep seven admitted tables and exclude Appeal/AuditEvent')
  }
  if (!sameSet(w09Schema.primaryOwner?.entities ?? [], ['AuditEvent','NotificationPushEndpoint']) ||
      !sameSet(Object.keys(w09Schema.schema?.tables ?? []), ['audit_events','notification_push_endpoints'])) {
    fail('W09 schema must own only AuditEvent and NotificationPushEndpoint physical tables in this slice')
  }
  if (!sameSet(w10Schema.primaryOwner?.entities ?? [], [
        'Job','Retry','DLQ','ExecutionInbox','ExecutionOutbox','OperationalIdempotency',
      ]) ||
      w10Schema.primaryOwner?.migrationConfigOwner !== 'W09' ||
      w10Schema.primaryOwner?.postgresArtifact !== paths.w10Artifact ||
      !String(w10Schema.status).includes('RUNTIME_BINDING_NOT_ADMITTED')) {
    fail('W10 logical owner, W09 migration-config owner or runtime-binding gate drifted')
  }

  const w06Db = w06Wrangler.d1_databases ?? []
  const w09Db = w09Wrangler.d1_databases ?? []
  const w10Db = w10Wrangler.d1_databases ?? []
  const w11Db = w11Wrangler.d1_databases ?? []
  const exactD103 = (rows, expectedBinding, expectedDir) =>
    rows.length === 1 && rows[0].binding === expectedBinding &&
    rows[0].database_name === 'secondary' &&
    rows[0].database_id === 'bda1d247-a371-4244-91ae-aef96034db7f' &&
    rows[0].migrations_dir === expectedDir
  if (!exactD103(w06Db,'D1_03','migrations') ||
      w09Wrangler.name !== 'luckread-w09' ||
      !exactD103(w09Db,'D1_03','migrations-d1-03')) {
    fail('W06/W09 existing D1-03 binding and W09 migration-config ownership must remain unchanged')
  }
  if (w10Db.length !== 0) {
    fail('W10 D1-03 runtime binding is not admitted by the reviewed schema slice')
  }
  if (w11Db.length !== 1 || w11Db[0].binding !== 'D1_05' ||
      w11Db[0].database_id !== '77d82be2-d12e-4a17-b410-9aa7d376bc11') {
    fail('W11 must retain its D1-05-only runtime binding; no D1-03 binding is admitted')
  }

  if (w09Reconciliation.status !== 'LOGICAL_OWNERS_RECONCILED_SCHEMA_ADMISSION_PARTIAL' ||
      !w09Reconciliation.safety?.noRemoteDdl ||
      w09Reconciliation.safety?.runtimeBindingsChanged !== false ||
      w11Reconciliation.status !== 'LOGICAL_OWNERS_RECONCILED_SCHEMA_ADMISSION_BLOCKED' ||
      !w11Reconciliation.safety?.noRemoteDdl ||
      w11Reconciliation.safety?.runtimeBindingsChanged !== false ||
      !sameSet(w11Reconciliation.logicalOwnerEntities ?? [], ['Campaign','GrowthOperation'])) {
    fail('W09/W11 logical-owner reconciliation status and no-runtime/no-remote declarations must remain intact')
  }

  const sqlByOwner = [
    {owner:'W06',path:paths.w06Artifact,sql:readSource(paths.w06Artifact),tables:w06Schema.scope.includedTables},
    {owner:'W09',path:paths.w09Artifact,sql:readSource(paths.w09Artifact),tables:Object.keys(w09Schema.schema.tables)},
    {owner:'W10',path:paths.w10Artifact,sql:readSource(paths.w10Artifact),tables:Object.keys(w10Schema.schema.tables)},
  ]
  const allTables = []
  const allIndexes = []
  const allTriggers = []
  const allFunctions = []
  const allReferences = []
  const ownerTableCounts = {}
  for (const item of sqlByOwner) {
    const tables = namesIn(item.sql,/^CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
    const indexes = namesIn(item.sql,/^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
    const triggers = namesIn(item.sql,/^CREATE\\s+(?:CONSTRAINT\\s+)?TRIGGER\\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
    const functions = namesIn(item.sql,/^CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
    const refs = sqlReferenceTargets(item.sql)
    if (!sameSet(tables,item.tables)) fail(item.owner + ' PostgreSQL artifact tables do not match its schema contract')
    if (tables.some((name) => ['appeals','moderation_appeals','campaigns','growth_operations'].includes(name))) {
      fail('deferred Appeal or W11 logical-only table was created in D1-03: ' + item.owner)
    }
    if (item.owner === 'W06' && tables.includes('audit_events')) fail('W06 must not duplicate W09 AuditEvent')
    if (item.owner === 'W10' && refs.some((name) => name !== 'jobs')) {
      fail('W10 same-owner foreign keys may reference only jobs')
    }
    if (item.owner !== 'W10' && refs.length !== 0) {
      fail(item.owner + ' artifact must not introduce unadmitted cross-owner foreign keys')
    }
    allTables.push(...tables)
    allIndexes.push(...indexes)
    allTriggers.push(...triggers)
    allFunctions.push(...functions)
    allReferences.push(...refs)
    ownerTableCounts[item.owner] = tables.length
  }

  if (new Set(allTables).size !== 15 ||
      new Set(allIndexes).size !== 22 ||
      allTriggers.length !== 2 ||
      allFunctions.length !== 1 ||
      allReferences.length !== 2) {
    fail('D1-03 SQL bundle catalog totals differ from 15 tables / 22 indexes / 2 triggers / 1 function / 2 FKs')
  }
  if (!runner.includes("if (argv.includes('--remote-neon'))") ||
      !runner.includes("remote Neon execution is deliberately unavailable") ||
      !runner.includes("D1_SHARED_LOCAL_DATABASE_URL") ||
      runner.includes('NEON_DATABASE_URL_')) {
    fail('shared runner must reject remote execution and accept only the local PostgreSQL path')
  }
  if (!review.review?.d1Postflight ||
      review.review.d1Postflight.domainId !== 'D1-03' ||
      review.review.d1Postflight.databaseName !== 'luckread_governance' ||
      review.review.d1Postflight.tables !== 15 ||
      review.review.d1Postflight.explicitIndexes !== 22 ||
      review.review.d1Postflight.triggers !== 2 ||
      review.review.d1Postflight.triggerFunctions !== 1 ||
      review.review.d1Postflight.foreignKeys !== 2 ||
      review.review.d1Postflight.businessRows !== 0 ||
      review.review.d1Postflight.remoteNeonTouched !== false ||
      review.review.d1Postflight.cloudflareD1Touched !== false ||
      review.review.d1Postflight.remoteApplyReady !== false) {
    fail('review evidence does not match the completed D1-03 PostgreSQL 18 postflight')
  }

  const result = {
    status:'D1_03_SHARED_RUNNER_INDEPENDENT_LOCAL_REVIEW_PASS',
    domainId:'D1-03',
    databaseName:'luckread_governance',
    reviewedSources:pins.length,
    ledgerMigrations:manifest.entries.length,
    logicalOwners:{W06:4,W09:5,W10:6,W11:2},
    physicalTablesByWorker:ownerTableCounts,
    catalog:{
      tables:new Set(allTables).size,
      explicitIndexes:new Set(allIndexes).size,
      triggers:allTriggers.length,
      triggerFunctions:allFunctions.length,
      sameDomainForeignKeys:allReferences.length,
      businessRows:0,
    },
    safety:{
      remoteNeonTouched:false,
      cloudflareD1Touched:false,
      businessDataImported:false,
      runtimeBindingsChanged:false,
      productionCutoverAuthorized:false,
      remoteApplyReady:false,
    },
    blockers:review.remoteApplyBlockers,
  }
  return result
}

function run() {
  const result = verifyD103SharedRunnerReview()
  const output = 'artifacts/neon/d1-03-shared-runner-independent-review.json'
  writeFileSync(resolve(repositoryRoot,output),JSON.stringify(result,null,2)+'\n')
  process.stdout.write('D1_03_SHARED_RUNNER_INDEPENDENT_REVIEW_PASS ' + JSON.stringify(result) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  }
}
