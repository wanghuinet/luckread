#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const paths = {
  review: 'contracts/database/neon-d1-05-shared-runner-independent-review.v1.json',
  manifest: 'contracts/database/neon-d1-05-shared-migration-manifest.v1.json',
  schema: 'contracts/database/neon-d1-05-w11-analytics-schema.v1.json',
  ownerBoundary: 'contracts/transport/d1-05-analytics-owner-boundary.v1.json',
  accessBoundary: 'contracts/transport/worker-d1-access-boundary.v1.json',
  d103OwnerBoundary: 'contracts/transport/d1-03-entity-owner-boundary.v1.json',
  wrangler: 'workers/W11-growth-campaign-analytics-operations/wrangler.jsonc',
  sharedRunner: 'scripts/neon/shared-domain-schema-runner.mjs',
  artifact: 'workers/W11-growth-campaign-analytics-operations/src/neon-postgres-migrations-d1-05/0001_w11_d1_05_analytics_schema.sql',
  generator: 'workers/W11-growth-campaign-analytics-operations/scripts/neon/generate-d1-05-w11-postgres-migration.mjs',
  generatorTest: 'workers/W11-growth-campaign-analytics-operations/scripts/neon/generate-d1-05-w11-postgres-migration.test.mjs',
  template: 'workers/W11-growth-campaign-analytics-operations/scripts/neon/templates/d1-05-w11-analytics-postgres.sql',
}
const sourceMigrationPaths = [
  'workers/W11-growth-campaign-analytics-operations/migrations/0001_analytics_projection.sql',
  'workers/W11-growth-campaign-analytics-operations/migrations/0002_analytics_projection_rebuild_state.sql',
  'workers/W11-growth-campaign-analytics-operations/migrations/0003_analytics_late_event_replay.sql',
  'workers/W11-growth-campaign-analytics-operations/migrations/0004_analytics_w01_client_telemetry.sql',
]
const expectedTables = [
  'analytics_event_dedupe',
  'analytics_content_hourly',
  'analytics_creator_hourly',
  'analytics_rollup_watermark',
  'analytics_reconciliation_status',
  'analytics_projection_rebuild_state',
]
const expectedIndexes = [
  'analytics_event_dedupe_ingested_at_idx',
  'analytics_event_dedupe_occurred_at_idx',
  'analytics_event_dedupe_hour_start_idx',
  'analytics_event_dedupe_pending_idx',
  'analytics_content_hourly_content_time_idx',
  'analytics_content_hourly_content_id_time_idx',
  'analytics_content_hourly_time_idx',
  'analytics_creator_hourly_creator_time_idx',
]
const requiredBlockerTerms = ['retention', 'deletion', 'consent']
const fail = (message) => { throw new Error('D1-05 independent review: ' + message) }
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

function extractSqlEffects(sql) {
  const uncommented = stripSqlComments(sql)
  const code = maskSqlStringsAndDollarBodies(sql)
  const tables = namesIn(uncommented,/^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
  const indexes = namesIn(uncommented,/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_$]*)/gim)
  const functions = namesIn(uncommented,/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
  const triggers = namesIn(uncommented,/^CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
  const references = namesIn(code,/\bREFERENCES\s+(?:(?:public)\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_$]*)"?/gim)
  const inserts = namesIn(uncommented,/^\s*INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_$]*)/gim)
  const collatedTimeColumns = namesIn(uncommented,/^\s*([A-Za-z_][A-Za-z0-9_$]*)\s+TEXT\s+COLLATE\s+"C"/gim)
  const identityColumns = [...new Set(code.match(/\b(?:actor_id|visitor_id|session_id)\b/gi) ?? [])]
    .map((name) => name.toLowerCase())
  return {tables,indexes,functions,triggers,references,inserts,collatedTimeColumns,identityColumns,uncommented,code}
}

function verifyD105Target(target, label) {
  if (target?.domainId !== 'D1-05' ||
      target?.databaseName !== 'allluck' ||
      target?.cloudflareD1DatabaseUuid !== '77d82be2-d12e-4a17-b410-9aa7d376bc11' ||
      target?.postgresMajor !== 18 ||
      target?.businessDataImport !== false ||
      target?.productionCutoverAuthorized !== false ||
      target?.remoteSchemaApplied !== false) {
    fail(label + ' must retain the exact D1-05 PostgreSQL 18 target and remain unapplied')
  }
}

export function verifyD105SharedRunnerReview({ readSource = readText } = {}) {
  const review = readJson(paths.review,readSource)
  const manifest = readJson(paths.manifest,readSource)
  const schema = readJson(paths.schema,readSource)
  const ownerBoundary = readJson(paths.ownerBoundary,readSource)
  const accessBoundary = readJson(paths.accessBoundary,readSource)
  const d103OwnerBoundary = readJson(paths.d103OwnerBoundary,readSource)
  const wrangler = readJson(paths.wrangler,readSource)
  const runner = readSource(paths.sharedRunner)
  const artifact = readSource(paths.artifact)
  const template = readSource(paths.template)

  if (review.status !== 'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_ADMISSION_BLOCKED' ||
      review.review?.reviewKind !== 'AUTOMATED_INDEPENDENT_READ_ONLY_CODE_PATH_REVIEW' ||
      review.review?.reviewedMainCommit !== '920fef62b93e1798257a51bc9a42633fe24e4ec3' ||
      review.review?.sharedExecutorPullRequest !== 1660 ||
      review.review?.sharedExecutorHeadCommit !== '5e8bfaf7bd26fe8669c08de1e062d998c4f4c6de' ||
      review.review?.sharedPostgres18WorkflowRunId !== 42509822425 ||
      review.review?.d105StandalonePostgres18WorkflowRunId !== 42508098818) {
    fail('review evidence must bind to the merged shared executor and both completed D1-05 PG18 rehearsals')
  }
  if (review.remoteApplyReady !== false ||
      review.businessDataImport !== false ||
      review.productionCutoverAuthorized !== false) {
    fail('independent review must not admit remote apply, data import or production cutover')
  }
  for (const key of ['newWorkers','newD1Databases','newQueues','newServiceBindings']) {
    if (review.safety?.[key] !== 0) fail('review.safety.' + key + ' must remain zero')
  }
  for (const key of ['runtimeBindingsChanged','remoteNeonDdlExecuted','cloudflareD1Touched',
    'businessDataImported','productionCutoverAuthorized']) {
    if (review.safety?.[key] !== false) fail('review.safety.' + key + ' must remain false')
  }

  const pins = review.review?.reviewedSourcePins
  if (!Array.isArray(pins) || pins.length !== 15) {
    fail('review must pin exactly the 15 W11 D1-05 ownership, schema, source and generator artifacts')
  }
  const pinByPath = new Map()
  for (const pin of pins) {
    if (!pin || typeof pin.path !== 'string' || pinByPath.has(pin.path) ||
        !/^[0-9a-f]{40}$/.test(pin.gitBlobSha1 || '')) {
      fail('review source pins must have unique paths and exact Git blob SHA-1 values')
    }
    const source = readSource(pin.path)
    if (gitBlobSha1(source) !== pin.gitBlobSha1) fail('reviewed source drifted: ' + pin.path)
    pinByPath.set(pin.path,pin.gitBlobSha1)
  }
  const requiredPins = [
    paths.sharedRunner,paths.manifest,paths.schema,paths.ownerBoundary,
    paths.accessBoundary,paths.d103OwnerBoundary,paths.wrangler,
    ...sourceMigrationPaths,paths.artifact,paths.generator,paths.generatorTest,paths.template,
  ]
  if (requiredPins.length !== pins.length ||
      requiredPins.some((relativePath) => !pinByPath.has(relativePath))) {
    fail('reviewed source pin set does not cover the complete D1-05 source and runtime boundary')
  }

  if (manifest.domainId !== 'D1-05' ||
      manifest.databaseName !== 'allluck' ||
      manifest.cloudflareD1DatabaseUuid !== accessBoundary.physicalD1Registry?.['D1-05'] ||
      manifest.postgresMajor !== 18 ||
      manifest.remoteApplyReady !== false ||
      manifest.businessDataImport !== false ||
      manifest.productionCutoverAuthorized !== false ||
      manifest.expected?.businessRows !== 0 ||
      manifest.expected?.controlSeedRows !== 0 ||
      (manifest.seedRows ?? []).length !== 0) {
    fail('D1-05 manifest must remain local-only, empty-data and control-seed-free')
  }
  if (manifest.status !== 'LOCAL_SCHEMA_REHEARSAL_PASSED_REMOTE_ADMISSION_BLOCKED' ||
      !Array.isArray(manifest.remoteApplyBlockers) ||
      !requiredBlockerTerms.every((term) => manifest.remoteApplyBlockers.some((item) => item.toLowerCase().includes(term)))) {
    fail('D1-05 manifest must retain retention, deletion and consent remote-admission blockers')
  }
  if (manifest.entries?.length !== 1) fail('D1-05 must contain exactly one W11 analytics schema baseline')
  const entry = manifest.entries[0]
  if (entry.migrationId !== 'd1-05-w11-analytics-schema-v1' ||
      entry.order !== 100 ||
      entry.ownerWorker !== 'W11' ||
      entry.logicalOwnerWorker !== 'W11' ||
      entry.kind !== 'GENERATED_POSTGRESQL_SQL' ||
      entry.schemaContract !== paths.schema ||
      !sameSet(entry.artifactPaths,[paths.artifact]) ||
      !sameSet(entry.sourceMigrations,sourceMigrationPaths) ||
      !sameSet(entry.dependsOn ?? [],[])) {
    fail('D1-05 manifest must map all four existing W11 sources to its single W11-owned PostgreSQL baseline')
  }
  if (manifest.expected?.tables !== 6 ||
      manifest.expected?.explicitIndexes !== 8 ||
      manifest.expected?.triggers !== 0 ||
      manifest.expected?.triggerFunctions !== 0 ||
      manifest.expected?.foreignKeys !== 0 ||
      manifest.expected?.controlSeedRows !== 0) {
    fail('D1-05 manifest catalog totals must remain 6 tables / 8 indexes / no triggers, functions, FKs or seeds')
  }

  verifyD105Target(schema.target,'W11 analytics schema contract')
  if (schema.status !== 'LOCAL_POSTGRES18_REHEARSAL_PASSED_ADMISSION_BLOCKED' ||
      schema.target?.primaryWorker !== 'W11' ||
      !sameSet(schema.scope?.includedTables ?? [],expectedTables) ||
      !sameSet((schema.scope?.excludedEntities ?? []).map((item) => item.entity),['Campaign','GrowthOperation'])) {
    fail('W11 schema contract owner, final six-table inventory or D1-03 entity exclusion changed')
  }
  if (!Array.isArray(schema.scope?.sourceMigrations) ||
      !sameSet(schema.scope.sourceMigrations.map((item) => item.path),sourceMigrationPaths)) {
    fail('W11 schema contract must retain exactly the four admitted D1 source migrations')
  }
  for (const source of schema.scope.sourceMigrations) {
    if (pinByPath.get(source.path) !== source.gitBlobSha1) {
      fail('W11 schema source Git blob pin differs between review and source schema contract: ' + source.path)
    }
  }
  if (!sameSet(Object.keys(schema.schema?.tables ?? {}),expectedTables) ||
      schema.localRehearsalEvidence?.status !== 'PASS' ||
      schema.localRehearsalEvidence?.results?.tables !== 6 ||
      schema.localRehearsalEvidence?.results?.explicitIndexes !== 8 ||
      schema.localRehearsalEvidence?.results?.foreignKeys !== 0 ||
      schema.localRehearsalEvidence?.results?.triggers !== 0 ||
      schema.localRehearsalEvidence?.results?.utcTimeTextColumnsWithBinaryCollation !== 15 ||
      schema.localRehearsalEvidence?.results?.syntheticRowsAfterRollback !== 0 ||
      schema.localRehearsalEvidence?.safety?.remoteNeonTouched !== false ||
      schema.localRehearsalEvidence?.safety?.cloudflareD1Touched !== false ||
      schema.localRehearsalEvidence?.safety?.businessDataImported !== false ||
      schema.localRehearsalEvidence?.safety?.runtimeBindingsChanged !== false ||
      schema.localRehearsalEvidence?.safety?.productionCutoverAuthorized !== false) {
    fail('W11 schema contract table inventory, zero-row rollback or no-remote PG18 evidence changed')
  }
  if (schema.admission?.status !== 'BLOCKED_MISSING_RETENTION_DELETION_AND_CONSENT_PURPOSE_POLICIES' ||
      !sameSet((schema.admission?.blockingRequirements ?? []).map((item) => item.status),['MISSING','MISSING','MISSING'])) {
    fail('W11 schema admission must remain blocked on all three missing privacy-policy requirements')
  }
  if (schema.privacy?.directIdentityFieldsPersisted !== false ||
      schema.privacy?.actorIdPersisted !== false ||
      schema.privacy?.visitorIdPersisted !== false ||
      schema.privacy?.sessionIdPersisted !== false ||
      schema.privacy?.creatorIdPersisted !== true ||
      schema.privacy?.noCrossDomainForeignKeys !== true ||
      !/missing|subject to/i.test(schema.privacy?.creatorIdPurpose ?? '')) {
    fail('D1-05 privacy boundary must exclude direct actor/visitor/session IDs and keep creator_id policy explicitly unresolved')
  }

  if (ownerBoundary.domain !== 'D1-05' ||
      ownerBoundary.primaryWorker !== 'W11' ||
      ownerBoundary.physicalResource?.databaseName !== 'allluck' ||
      ownerBoundary.physicalResource?.databaseUuid !== '77d82be2-d12e-4a17-b410-9aa7d376bc11' ||
      !sameSet(ownerBoundary.sourceAuthorities?.W03 ?? [],[
        'Content identity','Publication state','Media/content metadata',
      ]) ||
      !sameSet(ownerBoundary.sourceAuthorities?.W05 ?? [],[
        'Likes','Comments','Shares','Bookmarks','Follow relationships',
      ]) ||
      !sameSet(ownerBoundary.sourceAuthorities?.W07 ?? [],[
        'Orders','Payments','Refunds','Revenue','Ledger facts',
      ])) {
    fail('D1-05 must remain W11-owned derived analytics, not an authority over content/social/commerce facts')
  }
  if (!ownerBoundary.boundaryRules?.some((item) => /W11 is the only Worker allowed to read\/write D1-05/.test(item)) ||
      !ownerBoundary.boundaryRules?.some((item) => /Retention, deletion, consent\/purpose/.test(item))) {
    fail('D1-05 ownership and missing privacy-policy admission boundary must remain explicit')
  }
  if (!sameSet(d103OwnerBoundary.owners?.W11 ?? [],['Campaign','GrowthOperation'])) {
    fail('Campaign/GrowthOperation remain logical D1-03 owners and must not be inferred as D1-05 analytics tables')
  }
  if (accessBoundary.physicalD1Registry?.['D1-05'] !== '77d82be2-d12e-4a17-b410-9aa7d376bc11' ||
      !sameSet(accessBoundary.workers?.W11?.allowedDomains ?? [],['D1-03','D1-05'])) {
    fail('canonical W11 D1 access boundary no longer matches the five-domain registry')
  }

  const d1Rows = wrangler.d1_databases ?? []
  if (wrangler.name !== 'luckread-w11' ||
      d1Rows.length !== 1 ||
      d1Rows[0].binding !== 'D1_05' ||
      d1Rows[0].database_name !== 'allluck' ||
      d1Rows[0].database_id !== '77d82be2-d12e-4a17-b410-9aa7d376bc11' ||
      d1Rows[0].migrations_dir !== 'migrations') {
    fail('W11 must retain exactly its existing D1_05 binding and must not gain D1-03 or other D1 runtime bindings')
  }

  if (!artifact.startsWith('-- GENERATED FILE.') || artifact !== template) {
    fail('committed W11 PostgreSQL artifact must be the exact deterministic generated template output')
  }
  const effects = extractSqlEffects(artifact)
  if (!sameSet(effects.tables,expectedTables) ||
      new Set(effects.tables).size !== 6) {
    fail('D1-05 SQL artifact must create exactly its six analytics projection tables')
  }
  if (!sameSet(effects.indexes,expectedIndexes) ||
      new Set(effects.indexes).size !== 8 ||
      effects.triggers.length !== 0 ||
      effects.functions.length !== 0 ||
      effects.references.length !== 0 ||
      effects.inserts.length !== 0) {
    fail('D1-05 SQL artifact must have exactly eight indexes and no triggers, functions, foreign keys or seed inserts')
  }
  if (effects.identityColumns.length !== 0 ||
      /\b(?:raw_body|subscriber_attributes)\b/i.test(effects.code) ||
      effects.tables.some((name) => ['campaigns','growth_operations'].includes(name))) {
    fail('D1-05 SQL artifact must not persist direct identity/session IDs, raw webhook bodies or D1-03 business entities')
  }
  const sourceWorkerConstraint = /source_worker\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(source_worker\s+IN\s*\('W01',\s*'W03',\s*'W05'\)\)/i
  if (!sourceWorkerConstraint.test(effects.uncommented) ||
      !/event_name\s+IN\s*\([^)]*'like_created'[\s\S]*?source_worker\s*=\s*'W05'/i.test(effects.uncommented) ||
      !/actor_type\s*=\s*'user'/i.test(effects.uncommented)) {
    fail('D1-05 event admission must retain W01/W03 content and W05-only social actor authority')
  }
  if (effects.collatedTimeColumns.length !== 15) {
    fail('D1-05 must retain COLLATE C on all 15 UTC time-text columns')
  }

  if (!runner.includes("if (argv.includes('--remote-neon'))") ||
      !runner.includes('remote Neon execution is deliberately unavailable') ||
      !runner.includes('D1_SHARED_LOCAL_DATABASE_URL') ||
      runner.includes('NEON_DATABASE_URL_')) {
    fail('shared executor must continue to reject remote execution and only accept the disposable local PostgreSQL route')
  }
  const evidence = review.review?.d1Postflight
  if (!evidence ||
      evidence.domainId !== 'D1-05' ||
      evidence.databaseName !== 'allluck' ||
      evidence.localDatabaseName !== 'alluck_d1_05_shared' ||
      evidence.postgresMajor !== 18 ||
      evidence.migrations !== 1 ||
      evidence.sourceMigrations !== 4 ||
      evidence.tables !== 6 ||
      evidence.explicitIndexes !== 8 ||
      evidence.triggers !== 0 ||
      evidence.triggerFunctions !== 0 ||
      evidence.foreignKeys !== 0 ||
      evidence.controlSeedRows !== 0 ||
      evidence.businessRows !== 0 ||
      evidence.utcTimeTextColumnsWithBinaryCollation !== 15 ||
      evidence.remoteNeonTouched !== false ||
      evidence.cloudflareD1Touched !== false ||
      evidence.remoteApplyReady !== false) {
    fail('independent review D1-05 PG18 postflight evidence is incomplete or mismatched')
  }
  const privacyEvidence = review.review?.privacyBoundary
  if (privacyEvidence?.actorIdPersisted !== false ||
      privacyEvidence?.visitorIdPersisted !== false ||
      privacyEvidence?.sessionIdPersisted !== false ||
      privacyEvidence?.creatorIdPersisted !== true ||
      !/retention, deletion and consent\/purpose rules remain missing/i.test(privacyEvidence?.creatorIdPurpose ?? '')) {
    fail('independent review privacy evidence must accurately preserve the creator_id policy blocker')
  }
  if (!Array.isArray(review.remoteApplyBlockers) ||
      !requiredBlockerTerms.every((term) => review.remoteApplyBlockers.some((item) => item.toLowerCase().includes(term)))) {
    fail('independent review must preserve retention, deletion and consent blockers')
  }

  return {
    status:'D1_05_SHARED_RUNNER_INDEPENDENT_REVIEW_PASS_ADMISSION_BLOCKED',
    domainId:'D1-05',
    databaseName:'allluck',
    reviewedSources:pins.length,
    sourceMigrations:sourceMigrationPaths.length,
    migrationEntries:manifest.entries.length,
    physicalTables:effects.tables.sort(),
    catalog:{
      tables:effects.tables.length,
      explicitIndexes:effects.indexes.length,
      triggers:effects.triggers.length,
      triggerFunctions:effects.functions.length,
      foreignKeys:effects.references.length,
      controlSeedRows:0,
      businessRows:0,
      utcTimeTextColumnsWithBinaryCollation:effects.collatedTimeColumns.length,
    },
    privacy:{
      actorIdPersisted:false,
      visitorIdPersisted:false,
      sessionIdPersisted:false,
      creatorIdPersisted:true,
      creatorIdPurposePolicyAdmitted:false,
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
}

function run() {
  const result = verifyD105SharedRunnerReview()
  const output = 'artifacts/neon/d1-05-shared-runner-independent-review.json'
  mkdirSync(resolve(repositoryRoot,'artifacts/neon'),{recursive:true})
  writeFileSync(resolve(repositoryRoot,output),JSON.stringify(result,null,2)+'\n')
  process.stdout.write('D1_05_SHARED_RUNNER_INDEPENDENT_REVIEW_PASS ' + JSON.stringify(result) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  }
}
