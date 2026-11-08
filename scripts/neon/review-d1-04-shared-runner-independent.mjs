#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const paths = {
  review: 'contracts/database/neon-d1-04-shared-runner-independent-review.v1.json',
  manifest: 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json',
  accessBoundary: 'contracts/transport/worker-d1-access-boundary.v1.json',
  wrangler: 'workers/W07-subscription-commerce/wrangler.jsonc',
  sharedRunner: 'scripts/neon/shared-domain-schema-runner.mjs',
  orderContract: 'contracts/database/neon-d1-04-w07-order-payment-schema.v1.json',
}
const contractPaths = [
  paths.orderContract,
  'contracts/database/neon-d1-04-w07-saved-methods-mandates-schema.v1.json',
  'contracts/database/neon-d1-04-w07-renewal-cycles-schema.v1.json',
  'contracts/database/neon-d1-04-w07-revenuecat-webhook-schema.v1.json',
  'contracts/database/neon-d1-04-w07-refunds-billing-documents-schema.v1.json',
  'contracts/database/neon-d1-04-w07-payment-method-revocation-schema.v1.json',
]
const sourcePaths = [
  'workers/W07-subscription-commerce/migrations-d1-04/0001_order_commerce.sql',
  'workers/W07-subscription-commerce/migrations-d1-04/0002_payment_provider_events.sql',
  'workers/W07-subscription-commerce/migrations-d1-04/0003_saved_payment_methods_mandates.sql',
  'workers/W07-subscription-commerce/migrations-d1-04/0004_subscription_renewal_cycles.sql',
  'workers/W07-subscription-commerce/migrations-d1-04/0005_revenuecat_webhook_inbox.sql',
  'workers/W07-subscription-commerce/migrations-d1-04/0006_refunds_billing_documents.sql',
  'workers/W07-subscription-commerce/migrations-d1-04/0007_payment_method_revocation_requests.sql',
]
const artifactPaths = [
  'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql',
  'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0002_w07_d1_04_saved_methods_mandates.sql',
  'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0003_w07_d1_04_renewal_cycles.sql',
  'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0004_w07_d1_04_revenuecat_webhook_inbox.sql',
  'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0005_w07_d1_04_refunds_billing_documents.sql',
  'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0006_w07_d1_04_payment_method_revocation.sql',
]
const generatorPaths = [
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-order-payment-postgres-migration.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-saved-methods-mandates-postgres-migration.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-renewal-cycles-postgres-migration.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-revenuecat-webhook-postgres-migration.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-refunds-billing-documents-postgres-migration.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-payment-method-revocation-postgres-migration.mjs',
]
const testPaths = [
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-order-payment-postgres-migration.test.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-saved-methods-mandates-postgres-migration.test.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-renewal-cycles-postgres-migration.test.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-revenuecat-webhook-postgres-migration.test.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-refunds-billing-documents-postgres-migration.test.mjs',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/generate-w07-payment-method-revocation-postgres-migration.test.mjs',
]
const templatePaths = [
  'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-order-payment-postgres.sql',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-saved-methods-mandates-postgres.sql',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-renewal-cycles-postgres.sql',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-revenuecat-webhook-postgres.sql',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-refunds-billing-documents-postgres.sql',
  'workers/W07-subscription-commerce/scripts/neon-d1-04/templates/w07-payment-method-revocation-postgres.sql',
]
const expectedIds = [
  'd1-04-w07-order-payment-schema-v1',
  'd1-04-w07-saved-methods-mandates-v1',
  'd1-04-w07-renewal-cycles-v1',
  'd1-04-w07-revenuecat-webhook-inbox-v1',
  'd1-04-w07-refunds-billing-documents-v1',
  'd1-04-w07-payment-method-revocation-v1',
]
const seedTable = 'subscription_renewal_scheduler_state'
const expectedSeed = {
  state_id: 'subscription-renewals',
  cursor_period_end: null,
  cursor_subscription_id: null,
  version: 1,
  updated_at: '1970-01-01T00:00:00.000Z',
}
const fail = (message) => { throw new Error('D1-04 independent review: ' + message) }
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

function stripSqlComments(sql) {
  return String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^--.*$/gm, ' ')
}

function maskSqlStringsAndDollarBodies(sql) {
  return stripSqlComments(sql)
    .replace(/(\$[A-Za-z_0-9]*\$)[\s\S]*?\1/g, ' ')
    .replace(/'(?:''|[^'])*'/g, ' ')
}

function extractEffects(sql) {
  const uncommented = stripSqlComments(sql)
  const code = maskSqlStringsAndDollarBodies(sql)
  const tables = namesIn(uncommented, /^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
  const indexes = namesIn(uncommented, /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
  const functions = namesIn(uncommented, /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
  const insertStatements = [...uncommented.matchAll(/^\s*INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_$]*)[\s\S]*?;/gim)]
    .map((match) => ({table:match[1],sql:match[0]}))
  const triggerOperations = [...uncommented.matchAll(/^\s*(DROP\s+TRIGGER(?:\s+IF\s+EXISTS)?|CREATE\s+(?:CONSTRAINT\s+)?TRIGGER)\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)]
    .map((match) => ({
      operation:/^DROP/i.test(match[1]) ? 'DROP' : 'CREATE',
      name:match[2],
      index:match.index,
    }))
  const foreignKeys = namesIn(code, /\bREFERENCES\s+(?:(?:public)\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_$]*)"?/gim)
  return {tables,indexes,functions,insertStatements,triggerOperations,foreignKeys}
}

function assertD104Target(contract, label) {
  if (contract.target?.domainId !== 'D1-04' ||
      contract.target?.databaseName !== 'luckread_finance' ||
      contract.target?.cloudflareD1DatabaseUuid !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736' ||
      contract.target?.postgresMajor !== 18 ||
      contract.target?.businessDataImport !== false ||
      contract.target?.productionCutoverAuthorized !== false ||
      contract.target?.remoteSchemaApplied !== false) {
    fail(label + ' schema contract target or safety declaration drifted')
  }
  if (contract.primaryOwner?.worker !== 'W07') {
    fail(label + ' schema contract must remain W07-owned')
  }
}

export function verifyD104SharedRunnerReview({ readSource = readText } = {}) {
  const review = readJson(paths.review,readSource)
  const manifest = readJson(paths.manifest,readSource)
  const accessBoundary = readJson(paths.accessBoundary,readSource)
  const wrangler = readJson(paths.wrangler,readSource)
  const contracts = contractPaths.map((path) => readJson(path,readSource))
  const runner = readSource(paths.sharedRunner)

  if (review.status !== 'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED' ||
      review.review?.reviewKind !== 'AUTOMATED_INDEPENDENT_READ_ONLY_CODE_PATH_REVIEW' ||
      review.review?.sharedExecutorPullRequest !== 1660 ||
      review.review?.sharedExecutorHeadCommit !== '5e8bfaf7bd26fe8669c08de1e062d998c4f4c6de' ||
      review.review?.sharedPostgres18WorkflowRunId !== 42509822425 ||
      review.review?.reviewedMainCommit !== '3d08f094ad263fe03ff6e122a9bfef2ffe62ad09') {
    fail('review evidence must bind to the merged shared executor and completed three-domain PG18 run')
  }
  if (review.remoteApplyReady !== false ||
      review.businessDataImport !== false ||
      review.productionCutoverAuthorized !== false) {
    fail('independent local review must not authorize remote apply, business data import or cutover')
  }
  for (const key of ['newWorkers','newD1Databases','newQueues','newServiceBindings']) {
    if (review.safety?.[key] !== 0) fail('review.safety.' + key + ' must remain zero')
  }
  for (const key of ['runtimeBindingsChanged','remoteNeonDdlExecuted','cloudflareD1Touched',
    'businessDataImported','productionCutoverAuthorized']) {
    if (review.safety?.[key] !== false) fail('review.safety.' + key + ' must remain false')
  }

  const pins = review.review?.reviewedSourcePins
  if (!Array.isArray(pins) || pins.length !== 41) fail('review must pin all W07 contracts, seven D1 sources, six PG artifacts, generators, tests and templates')
  const pinnedPaths = new Set()
  for (const pin of pins) {
    if (!pin || typeof pin.path !== 'string' || pinnedPaths.has(pin.path) ||
        !/^[0-9a-f]{40}$/.test(pin.gitBlobSha1 || '')) {
      fail('review source pins must have unique paths and exact Git blob SHA-1 values')
    }
    if (gitBlobSha1(readSource(pin.path)) !== pin.gitBlobSha1) {
      fail('reviewed source drifted: ' + pin.path)
    }
    pinnedPaths.add(pin.path)
  }
  for (const requiredPath of [
    paths.sharedRunner,paths.manifest,paths.accessBoundary,paths.wrangler,
    ...contractPaths,...sourcePaths,...artifactPaths,...generatorPaths,...testPaths,...templatePaths,
  ]) {
    if (!pinnedPaths.has(requiredPath)) fail('review does not pin required source: ' + requiredPath)
  }

  if (manifest.domainId !== 'D1-04' ||
      manifest.databaseName !== 'luckread_finance' ||
      manifest.cloudflareD1DatabaseUuid !== accessBoundary.physicalD1Registry?.['D1-04'] ||
      manifest.postgresMajor !== 18 ||
      manifest.remoteApplyReady !== false ||
      manifest.businessDataImport !== false ||
      manifest.productionCutoverAuthorized !== false ||
      manifest.localRehearsal?.allowed !== true ||
      manifest.localRehearsal?.databaseName !== 'luckread_d1_04_shared' ||
      manifest.localRehearsal?.postgresMajor !== 18 ||
      manifest.expected?.businessRows !== 0 ||
      manifest.expected?.controlSeedRows !== 1) {
    fail('manifest target, local rehearsal, empty-business-data or remote-apply restrictions drifted')
  }
  if (!Array.isArray(manifest.remoteApplyBlockers) || manifest.remoteApplyBlockers.length < 2) {
    fail('D1-04 must retain the independent review and remote release blockers')
  }
  if (!sameSet(manifest.entries?.map((entry) => entry.migrationId),expectedIds) ||
      manifest.entries.length !== 6 ||
      manifest.sourceMigrationCount !== 7) {
    fail('D1-04 must retain exactly six ordered PG artifacts for the seven admitted D1 source migrations')
  }
  if (!Array.isArray(manifest.seedRows) || manifest.seedRows.length !== 1) {
    fail('D1-04 must admit exactly one explicit scheduler control seed')
  }
  const seed = manifest.seedRows[0]
  if (seed.table !== seedTable ||
      seed.kind !== 'SCHEMA_CONTROL_METADATA_NOT_BUSINESS_DATA' ||
      seed.ownerWorker !== 'W07' ||
      seed.sourceContract !== contractPaths[2] ||
      seed.rows?.length !== 1 ||
      JSON.stringify(seed.rows[0]) !== JSON.stringify(expectedSeed)) {
    fail('PAY-004 scheduler control seed must match its exact W07 contract row')
  }

  const baseContract = contracts[0]
  assertD104Target(baseContract,'W07 base')
  if (baseContract.target?.cloudflareD1DatabaseName !== 'unimportant' ||
      baseContract.target?.binding !== 'D1_04' ||
      !sameSet(baseContract.scope?.includedSourceMigrations ?? [],sourcePaths) ||
      !sameSet(baseContract.scope?.includedTables ?? [],[
        'orders','order_lines','order_create_idempotency','payments','payment_provider_events',
        'payment_provider_event_conflicts','saved_payment_methods','payment_mandates',
        'subscription_renewal_cycles','subscription_renewal_scheduler_state',
        'revenuecat_webhook_events','revenuecat_webhook_event_conflicts',
        'refunds','billing_documents','payment_method_revocation_requests',
      ]) ||
      baseContract.schema?.totals?.tables !== 15 ||
      baseContract.schema?.totals?.explicitIndexes !== 31 ||
      baseContract.schema?.totals?.triggers !== 72 ||
      baseContract.schema?.totals?.triggerFunctions !== 6 ||
      baseContract.schema?.totals?.foreignKeys !== 0) {
    fail('base W07 D1-04 contract inventory must remain the exact 15-table combined schema')
  }

  const entries = manifest.entries
  const allSourcePaths = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const contract = contracts[index]
    const expectedArtifact = artifactPaths[index]
    if (entry.migrationId !== expectedIds[index] ||
        entry.order !== (index + 1) * 100 ||
        entry.ownerWorker !== 'W07' ||
        entry.logicalOwnerWorker !== 'W07' ||
        entry.kind !== 'POSTGRESQL_SQL' ||
        entry.schemaContract !== contractPaths[index] ||
        !sameSet(entry.artifactPaths,[expectedArtifact]) ||
        (index === 0 ? !sameSet(entry.dependsOn ?? [],[]) :
          !sameSet(entry.dependsOn ?? [],[expectedIds[index - 1]]))) {
      fail('ordered W07 schema/ledger owner mapping drifted at migration ' + index)
    }
    assertD104Target(contract,'W07 slice ' + (index + 1))
    if (!contract.status?.includes('POSTGRES18_REHEARSAL_PASSED') &&
        !contract.status?.includes('LOCAL_POSTGRES18_REHEARSAL_PASSED')) {
      fail('W07 slice contract lacks a PG18 local rehearsal: ' + contractPaths[index])
    }
    if (contract.primaryOwner?.migrationArtifact !== expectedArtifact ||
        !Array.isArray(contract.scope?.includedTables) ||
        !sameSet(Object.keys(contract.schema?.tables ?? {}),contract.scope.includedTables)) {
      fail('W07 slice artifact path or included table inventory differs from its schema contract: ' + contractPaths[index])
    }
    const entrySources = entry.sourceMigrations ?? []
    if (index === 0) {
      if (!sameSet(entrySources,sourcePaths.slice(0,2))) {
        fail('W07 initial order/payment artifact must map to source migrations 0001 and 0002')
      }
    } else if (entrySources.length !== 1 ||
        entrySources[0] !== contract.scope?.includedSourceMigration) {
      fail('W07 slice source migration does not match its schema contract: ' + contractPaths[index])
    }
    allSourcePaths.push(...entrySources)
    const sliceEvidence = contract.verification?.localRehearsalEvidence
    if (sliceEvidence?.postgresVersion !== '18.6' ||
        !Number.isSafeInteger(sliceEvidence?.workflowRunId) ||
        contract.safety?.remoteNeonDdlExecuted !== false ||
        contract.safety?.cloudflareD1Touched !== false ||
        contract.safety?.businessDataImported !== false ||
        contract.safety?.productionCutoverAuthorized !== false ||
        sliceEvidence?.remoteNeonTouched === true ||
        sliceEvidence?.cloudflareD1Touched === true ||
        sliceEvidence?.businessDataImported === true ||
        sliceEvidence?.productionCutoverAuthorized === true) {
      fail('W07 slice evidence must remain local-only and empty-data: ' + contractPaths[index])
    }
  }
  if (JSON.stringify(allSourcePaths) !== JSON.stringify(sourcePaths)) {
    fail('the seven admitted W07 D1 source migrations do not map exactly once in canonical order to the six PostgreSQL artifacts')
  }

  const renewalContract = contracts[2]
  const schedulerContractRow = renewalContract.schema?.tables?.[seedTable]?.seededControlRow
  if (renewalContract.schema?.tables?.[seedTable]?.seedRowKind !== seed.kind ||
      JSON.stringify(schedulerContractRow) !== JSON.stringify(expectedSeed)) {
    fail('PAY-004 schema contract does not admit the exact scheduler control seed')
  }

  if (wrangler.name !== 'luckread-w07') {
    fail('W07 Wrangler worker name changed')
  }
  const d104Bindings = (wrangler.d1_databases ?? []).filter((binding) => binding.binding === 'D1_04')
  if (d104Bindings.length !== 1 ||
      d104Bindings[0].database_name !== 'unimportant' ||
      d104Bindings[0].database_id !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736' ||
      d104Bindings[0].migrations_dir !== 'migrations-d1-04') {
    fail('W07 D1_04 binding must preserve the existing exact name, UUID and migrations directory')
  }
  const workersWithD104 = Object.entries(accessBoundary.workers ?? {})
    .filter(([,value]) => (value.allowedDomains ?? []).includes('D1-04'))
    .map(([worker]) => worker)
  if (!sameSet(workersWithD104,['W07']) ||
      accessBoundary.physicalD1Registry?.['D1-04'] !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736') {
    fail('D1-04 must remain W07-exclusive under the canonical Worker access boundary')
  }

  const allTables = []
  const allIndexes = []
  const allFunctions = []
  const allReferences = []
  const allInsertStatements = []
  const finalTriggers = new Set()
  const createdTriggers = []
  const droppedTriggers = []
  const ownerTableCounts = {}
  const perArtifact = []
  for (let index = 0; index < entries.length; index++) {
    const sql = readSource(entries[index].artifactPaths[0])
    const effects = extractEffects(sql)
    const contract = contracts[index]
    if (!sameSet(effects.tables,contract.scope.includedTables)) {
      fail('W07 PostgreSQL artifact tables do not match slice contract: ' + entries[index].artifactPaths[0])
    }
    if (effects.foreignKeys.length !== 0) {
      fail('D1-04 W07 artifact must not create any foreign keys: ' + entries[index].artifactPaths[0])
    }
    if (effects.tables.length === 0) fail('W07 PostgreSQL artifact declares no tables: ' + entries[index].artifactPaths[0])
    for (const name of effects.tables) {
      if (allTables.includes(name)) fail('duplicate D1-04 table declaration: ' + name)
      allTables.push(name)
    }
    for (const name of effects.indexes) {
      if (allIndexes.includes(name)) fail('duplicate D1-04 explicit index declaration: ' + name)
      allIndexes.push(name)
    }
    for (const name of effects.functions) {
      if (allFunctions.includes(name)) fail('duplicate D1-04 trigger function declaration: ' + name)
      allFunctions.push(name)
    }
    for (const operation of effects.triggerOperations) {
      if (operation.operation === 'DROP') {
        if (!finalTriggers.has(operation.name)) fail('trigger is dropped before it is present in the ordered migration prefix: ' + operation.name)
        finalTriggers.delete(operation.name)
        droppedTriggers.push({name:operation.name,migration:index + 1})
      } else {
        if (finalTriggers.has(operation.name)) fail('trigger is recreated without a preceding DROP in the manifest: ' + operation.name)
        finalTriggers.add(operation.name)
        createdTriggers.push({name:operation.name,migration:index + 1})
      }
    }
    allReferences.push(...effects.foreignKeys)
    allInsertStatements.push(...effects.insertStatements.map((item) => ({...item,migration:index + 1})))
    ownerTableCounts.W07 = (ownerTableCounts.W07 ?? 0) + effects.tables.length
    perArtifact.push({
      migrationId:entries[index].migrationId,
      tableCount:effects.tables.length,
      indexCount:effects.indexes.length,
      triggerOperations:effects.triggerOperations.length,
      functionCount:effects.functions.length,
      insertTables:effects.insertStatements.map((item) => item.table),
    })
  }

  if (allTables.length !== 15 ||
      !sameSet(allTables,baseContract.scope.includedTables) ||
      new Set(allIndexes).size !== 31 ||
      finalTriggers.size !== 72 ||
      allFunctions.length !== 6 ||
      new Set(allFunctions).size !== 6 ||
      allReferences.length !== 0) {
    fail('D1-04 final SQL catalog differs from 15 tables / 31 indexes / 72 final triggers / 6 functions / zero FKs')
  }
  if (droppedTriggers.length !== 1 ||
      droppedTriggers[0].name !== 'payment_provider_events_terminal_immutable' ||
      droppedTriggers[0].migration !== 6 ||
      !createdTriggers.some((item) =>
        item.name === 'payment_provider_events_terminal_immutable' &&
        item.migration === 6) ||
      !finalTriggers.has('payment_provider_events_terminal_immutable')) {
    fail('the final PAY-007 migration must replace exactly the existing payment-provider terminal-immutability trigger')
  }
  if (allInsertStatements.length !== 1 ||
      allInsertStatements[0].table !== seedTable ||
      allInsertStatements[0].migration !== 3) {
    fail('only the PAY-004 scheduler control metadata row may be inserted by D1-04 artifacts')
  }
  const seedSql = allInsertStatements[0].sql.replace(/\s+/g,'').toLowerCase()
  const exactSeedSql = "insertintosubscription_renewal_scheduler_state(state_id,cursor_period_end,cursor_subscription_id,version,updated_at)values('subscription-renewals',null,null,1,timestamptz'1970-01-01t00:00:00.000z');"
  if (seedSql !== exactSeedSql) {
    fail('PAY-004 scheduler seed SQL differs from its exact admitted control metadata values')
  }
  if (!runner.includes("if (argv.includes('--remote-neon'))") ||
      !runner.includes('remote Neon execution is deliberately unavailable') ||
      !runner.includes('D1_SHARED_LOCAL_DATABASE_URL') ||
      runner.includes('NEON_DATABASE_URL_')) {
    fail('shared runner must reject remote Neon and accept only the local PostgreSQL path')
  }

  const evidence = review.review?.d1Postflight
  if (!evidence || evidence.domainId !== 'D1-04' ||
      evidence.databaseName !== 'luckread_finance' ||
      evidence.postgresMajor !== 18 ||
      evidence.migrations !== 6 ||
      evidence.sourceMigrations !== 7 ||
      evidence.tables !== 15 ||
      evidence.explicitIndexes !== 31 ||
      evidence.triggers !== 72 ||
      evidence.triggerFunctions !== 6 ||
      evidence.foreignKeys !== 0 ||
      evidence.controlSeedRows !== 1 ||
      evidence.businessRows !== 0 ||
      evidence.remoteNeonTouched !== false ||
      evidence.cloudflareD1Touched !== false ||
      evidence.remoteApplyReady !== false) {
    fail('review evidence does not match the completed three-domain PG18 D1-04 postflight')
  }

  return {
    status:'D1_04_SHARED_RUNNER_INDEPENDENT_LOCAL_REVIEW_PASS',
    domainId:'D1-04',
    databaseName:'luckread_finance',
    reviewedSources:pins.length,
    ledgerMigrations:entries.length,
    sourceMigrations:allSourcePaths.length,
    physicalTablesByWorker:ownerTableCounts,
    catalog:{
      tables:allTables.length,
      explicitIndexes:allIndexes.length,
      finalTriggers:finalTriggers.size,
      triggerFunctions:allFunctions.length,
      foreignKeys:allReferences.length,
      controlSeedRows:allInsertStatements.length,
      businessRows:0,
    },
    triggerReplacement:{
      dropped:droppedTriggers,
      recreated:createdTriggers.filter((item) => item.name === 'payment_provider_events_terminal_immutable'),
    },
    perArtifact,
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
}

function run() {
  const result = verifyD104SharedRunnerReview()
  const output = 'artifacts/neon/d1-04-shared-runner-independent-review.json'
  mkdirSync(resolve(repositoryRoot,'artifacts/neon'),{recursive:true})
  writeFileSync(resolve(repositoryRoot,output),JSON.stringify(result,null,2)+'\n')
  process.stdout.write('D1_04_SHARED_RUNNER_INDEPENDENT_REVIEW_PASS ' + JSON.stringify(result) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  }
}
