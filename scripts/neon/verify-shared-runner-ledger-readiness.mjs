#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ledgerPath = 'contracts/database/neon-schema-migration-ledger.v1.json'
const readinessPath = 'contracts/database/neon-shared-runner-local-readiness.v1.json'
const d104RemoteReviewPath = 'contracts/database/neon-d1-04-remote-runner-review.v1.json'
const fiveDatabaseRemoteSchemaEvidencePath = 'contracts/database/neon-five-database-remote-schema-evidence.v1.json'
const remoteSchemaReviewPaths = Object.freeze({
  'D1-01':'contracts/database/neon-d1-01-remote-runner-review.v1.json',
  'D1-02':'contracts/database/neon-d1-02-remote-runner-review.v1.json',
  'D1-03':'contracts/database/neon-d1-03-remote-runner-review.v1.json',
  'D1-04':'contracts/database/neon-d1-04-remote-runner-review.v1.json',
  'D1-05':'contracts/database/neon-d1-05-remote-runner-review.v1.json',
})
const reviewPaths = Object.freeze({
  'D1-03':'contracts/database/neon-d1-03-shared-runner-independent-review.v1.json',
  'D1-04':'contracts/database/neon-d1-04-shared-runner-independent-review.v1.json',
  'D1-05':'contracts/database/neon-d1-05-shared-runner-independent-review.v1.json',
})
const expectedRemoteRunnerStatus = 'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY'
const expectedLocalRunnerStatus = 'IMPLEMENTED_AND_INDEPENDENTLY_REVIEWED'
const expectedDomains = ['D1-01','D1-02','D1-03','D1-04','D1-05']
const fail = (message) => { throw new Error('shared runner readiness: ' + message) }
const readText = (relativePath) => readFileSync(resolve(repositoryRoot,relativePath),'utf8')
const readJson = (relativePath,readSource) => JSON.parse(readSource(relativePath))

function sameSet(actual,expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((value,index) => value === [...expected].sort()[index])
}

function validateD104RemoteSchemaEvidence({review,readinessEvidence} = {}) {
  const record = review ?? {}
  const target = record.target ?? {}
  const postflight = record.verificationEvidence?.remoteSchemaPostflight ?? {}
  const catalog = postflight.catalog ?? {}
  const artifact = postflight.artifact ?? {}
  const history = (record.executionHistory ?? []).find((entry) => entry.runId === postflight.runId)

  if (record.status !== 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS' ||
      record.remoteApplyReady !== true ||
      target.domainId !== 'D1-04' ||
      target.databaseName !== 'luckread_finance' ||
      target.databaseUuid !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736' ||
      target.postgresMajor !== 18 ||
      target.scope !== 'schema-only' ||
      target.businessDataImport !== false ||
      target.productionCutoverAuthorized !== false) {
    fail('D1-04 remote review must pin the exact approved schema-only Neon target')
  }
  if (postflight.runId !== 42555900393 ||
      postflight.conclusion !== 'success' ||
      postflight.event !== 'workflow_dispatch' ||
      postflight.branch !== 'main' ||
      !/^[0-9a-f]{40}$/.test(postflight.sourceCommitSha ?? '') ||
      postflight.databaseName !== 'luckread_finance' ||
      postflight.postgresMajor !== 18 ||
      postflight.verifiedLedgerRows !== 6 ||
      postflight.verifiedMigrations !== 6 ||
      catalog.tables !== 15 ||
      catalog.explicitIndexes !== 31 ||
      catalog.constraintIndexes !== 29 ||
      catalog.triggers !== 72 ||
      catalog.triggerFunctions !== 6 ||
      catalog.foreignKeys !== 0 ||
      catalog.controlSeedRows !== 1 ||
      catalog.businessRows !== 0 ||
      artifact.id !== 13646957840 ||
      artifact.url !== 'https://github.com/wanghuinet/luckread/actions/runs/42555900393/artifacts/13646957840' ||
      !/^sha256:[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) {
    fail('D1-04 remote Schema Postflight must match the successful six-migration catalog evidence')
  }
  if (!history ||
      history.conclusion !== 'success' ||
      history.remoteNeonDdlExecuted !== true ||
      history.verifiedMigrations !== 6 ||
      history.verifiedLedgerRows !== 6 ||
      history.newlyAppliedMigrations !== 0 ||
      history.verifiedTables !== 15 ||
      history.verifiedExplicitIndexes !== 31 ||
      history.verifiedConstraintIndexes !== 29 ||
      history.verifiedTriggers !== 72 ||
      history.verifiedTriggerFunctions !== 6 ||
      history.verifiedForeignKeys !== 0 ||
      history.controlSeedRows !== 1 ||
      history.businessRows !== 0 ||
      history.postflightReportProduced !== true ||
      history.artifactId !== artifact.id ||
      history.artifactSha256 !== artifact.sha256) {
    fail('D1-04 remote execution history must prove the existing six-row ledger was verified without replaying DDL')
  }
  if (record.safety?.remoteNeonDdlExecuted !== true ||
      record.safety?.cloudflareD1Touched !== false ||
      record.safety?.businessDataImported !== false ||
      record.safety?.productionCutoverAuthorized !== false ||
      postflight.safety?.remoteNeonTouched !== true ||
      postflight.safety?.cloudflareD1Touched !== false ||
      postflight.safety?.businessDataImported !== false ||
      postflight.safety?.runtimeBindingsChanged !== false ||
      postflight.safety?.productionCutoverAuthorized !== false) {
    fail('D1-04 remote schema evidence must preserve D1, business-data and production-cutover safety boundaries')
  }

  const expectedEvidence = {
    status: 'REMOTE_SCHEMA_ONLY_APPLIED',
    evidenceRef: d104RemoteReviewPath,
    workflowRunId: postflight.runId,
    verifiedMigrations: postflight.verifiedMigrations,
    verifiedLedgerRows: postflight.verifiedLedgerRows,
    businessRows: catalog.businessRows,
    runtimeBindingsChanged: false,
    productionCutoverAuthorized: false,
  }
  if (!readinessEvidence ||
      Object.keys(expectedEvidence).some((key) => readinessEvidence[key] !== expectedEvidence[key])) {
    fail('D1-04 readiness register must separately record the existing remote schema-only Postflight')
  }
  return expectedEvidence
}

function validateFiveDatabaseRemoteSchemaEvidence({evidence,remoteReviews,d104RemoteSchema,readinessEvidence} = {}) {
  const domains = evidence?.domains ?? {}
  if (evidence?.version !== '1.0.0' ||
      evidence?.repository !== 'wanghuinet/luckread' ||
      evidence?.postgresMajor !== 18 ||
      evidence?.status !== 'FIVE_DATABASE_REMOTE_SCHEMA_POSTFLIGHTS_RECONCILED_WITH_SCOPE_LIMITS' ||
      evidence?.businessDataImportAuthorized !== false ||
      evidence?.productionCutoverAuthorized !== false ||
      !sameSet(Object.keys(domains), expectedDomains)) {
    fail('five-database remote schema evidence must cover the exact Neon domain set and keep import/cutover unauthorized')
  }

  const expected = {
    'D1-01':{databaseName:'luckread',schemaStatus:'REMOTE_SCHEMA_APPLIED',runId:42558978832,headSha:'92a8d3045c25c3eb83411cd041140edae42690ba',artifactId:13649145534,digest:'sha256:d8c5a44e7b480b97effc3587e2a19defa5d350ed1f868118479f731cb89010f3',migrations:14,tables:35},
    'D1-02':{databaseName:'luckreadpro',schemaStatus:'REMOTE_SCHEMA_APPLIED',runId:42615052620,headSha:'d9e461c6aed02cc61b75465b8bcace3e6cc80aa7',artifactId:13672660983,digest:'sha256:eb096551d501cd28b350f0f214e65e02acbe8b72fd4ec290362a77b4d8872efb',migrations:3,tables:28},
    'D1-03':{databaseName:'luckread_governance',schemaStatus:'REMOTE_PARTIAL_SCHEMA_APPLIED',runId:42563509520,headSha:'a35bdc5766fb4ee6f977055e7864858efd23bc6f',artifactId:13650895272,digest:'sha256:e9dc8f7d7739bfb023650361bad78a51ce9dc97b7fef8e9608e194f783ab345d',migrations:3,tables:15},
    'D1-04':{databaseName:'luckread_finance',schemaStatus:'REMOTE_SCHEMA_APPLIED',runId:42555900393,headSha:'c18d294d3fc2acac9e6c66eb052dfed6e6c46758',artifactId:13646957840,digest:'sha256:b35461e7b49a0131eceee3782244fd0f10d44d2c0b6f7fac90932481f9cd8228',migrations:6,tables:15},
    'D1-05':{databaseName:'allluck',schemaStatus:'REMOTE_SCHEMA_APPLIED_RUNTIME_ADMISSION_BLOCKED',runId:42616370545,headSha:'d9e461c6aed02cc61b75465b8bcace3e6cc80aa7',artifactId:13673235808,digest:'sha256:bb1f57e70f855c363ded007c6e0dd0eab4cf9a6857b8cd69521e74441b3d500f',migrations:1,tables:6},
  }
  const resultDomains = {}
  for (const domain of expectedDomains) {
    const actual = domains[domain] ?? {}
    const target = remoteReviews?.[domain]?.target ?? {}
    const reviewSafety = remoteReviews?.[domain]?.safety ?? {}
    const run = actual.workflow ?? {}
    const artifact = actual.artifact ?? {}
    const want = expected[domain]
    if (actual.databaseName !== want.databaseName ||
        actual.schemaStatus !== want.schemaStatus ||
        run.runId !== want.runId ||
        run.branch !== 'main' ||
        run.event !== 'workflow_dispatch' ||
        run.conclusion !== 'success' ||
        run.headSha !== want.headSha ||
        run.url !== 'https://github.com/wanghuinet/luckread/actions/runs/' + want.runId ||
        artifact.id !== want.artifactId ||
        artifact.digest !== want.digest ||
        artifact.url !== 'https://github.com/wanghuinet/luckread/actions/runs/' + want.runId + '/artifacts/' + want.artifactId ||
        actual.migrationCount !== want.migrations ||
        actual.tablesVerified !== want.tables ||
        actual.businessDataImported !== false ||
        actual.cloudflareD1Touched !== false ||
        actual.productionCutoverAuthorized !== false ||
        target.domainId !== domain ||
        target.databaseName !== want.databaseName ||
        target.postgresMajor !== 18 ||
        target.businessDataImport !== false ||
        target.productionCutoverAuthorized !== false ||
        reviewSafety.businessDataImported !== false ||
        reviewSafety.productionCutoverAuthorized !== false) {
      fail(domain + ' remote Schema Postflight must match its exact successful main workflow, artifact, target and safety evidence')
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(artifact.digest ?? '') ||
        !/^[0-9a-f]{40}$/.test(run.headSha ?? '')) {
      fail(domain + ' remote schema evidence has a malformed source SHA or artifact digest')
    }
    if (domain === 'D1-01' &&
        (actual.appendOnlyLedgerVerified !== true ||
         reviewSafety.productionD1Touched !== false)) {
      fail('D1-01 must retain its append-only ledger verification and no-production-D1 safety evidence')
    }
    if (domain === 'D1-02' &&
        (actual.schemaScope !== 'All three committed D1-02 manifest migrations for W03 content and W05 social schema.' ||
         actual.tablesVerified !== 28)) {
      fail('D1-02 scope must remain the complete three-migration W03/W05 schema-only inventory')
    }
    if (domain === 'D1-03') {
      const omitted = ['Appeal','PlatformRuntime','ReconciliationOperation','RecoveryOperation','Campaign','GrowthOperation']
      if (actual.schemaScope !== 'Only the three admitted W06/W09/W10 manifest migrations; explicitly not the full D1-03 logical entity inventory.' ||
          actual.explicitIndexesVerified !== 22 ||
          actual.constraintIndexesVerified !== 27 ||
          actual.triggersVerified !== 2 ||
          actual.triggerFunctionsVerified !== 1 ||
          actual.foreignKeysVerified !== 2 ||
          actual.controlSeedRows !== 0 ||
          actual.businessRows !== 0 ||
          actual.fullDomainSchemaComplete !== false ||
          !sameSet(actual.omittedEntities, omitted) ||
          actual.runtimeBindingsChanged !== false ||
          remoteReviews[domain]?.status !== 'PARTIAL_SCHEMA_REMOTE_RELEASE_APPROVED' ||
          remoteReviews[domain]?.partialRemoteApplyReady !== true) {
        fail('D1-03 must remain explicitly partial: three admitted W06/W09/W10 migrations only, with six entities omitted')
      }
    }
    if (domain === 'D1-04') {
      if (actual.explicitIndexesVerified !== 31 ||
          actual.constraintIndexesVerified !== 29 ||
          actual.triggersVerified !== 72 ||
          actual.triggerFunctionsVerified !== 6 ||
          actual.foreignKeysVerified !== 0 ||
          actual.controlSeedRows !== 1 ||
          actual.businessRows !== 0 ||
          actual.newlyAppliedMigrationsOnFinalPostflight !== 0 ||
          actual.runtimeBindingsChanged !== false ||
          !d104RemoteSchema ||
          d104RemoteSchema.workflowRunId !== run.runId ||
          d104RemoteSchema.verifiedMigrations !== actual.migrationCount ||
          d104RemoteSchema.verifiedLedgerRows !== actual.migrationCount ||
          d104RemoteSchema.businessRows !== actual.businessRows) {
        fail('D1-04 global provisioning record must reconcile with the exact six-row no-replay remote Postflight')
      }
    }
    if (domain === 'D1-05') {
      if (actual.explicitIndexesVerified !== 8 ||
          actual.constraintIndexesVerified !== 7 ||
          actual.triggersVerified !== 0 ||
          actual.triggerFunctionsVerified !== 0 ||
          actual.foreignKeysVerified !== 0 ||
          actual.controlSeedRows !== 0 ||
          actual.businessRows !== 0 ||
          actual.runtimeDataIngestionEnabled !== false ||
          actual.runtimeBindingsChanged !== false ||
          !Array.isArray(actual.runtimeAdmissionBlockers) ||
          actual.runtimeAdmissionBlockers.length !== 3 ||
          remoteReviews[domain]?.status !== 'D1_05_SCHEMA_ONLY_REMOTE_PROVISIONING_APPROVED' ||
          remoteReviews[domain]?.remoteApplyReady !== false) {
        fail('D1-05 must remain schema-only with runtime ingestion disabled and privacy-policy admission blocked')
      }
    }
    resultDomains[domain] = {
      databaseName:actual.databaseName,
      schemaStatus:actual.schemaStatus,
      workflowRunId:run.runId,
      migrationCount:actual.migrationCount,
      tablesVerified:actual.tablesVerified,
      ...(domain === 'D1-03' ? {fullDomainSchemaComplete:false,omittedEntityCount:actual.omittedEntities.length} : {}),
      ...(domain === 'D1-05' ? {runtimeDataIngestionEnabled:false,runtimeAdmissionBlockerCount:actual.runtimeAdmissionBlockers.length} : {}),
      businessDataImported:false,
      productionCutoverAuthorized:false,
    }
  }
  const expectedReadinessEvidence = {
    status:'FIVE_DATABASE_REMOTE_SCHEMA_POSTFLIGHTS_RECONCILED_WITH_SCOPE_LIMITS',
    evidenceRef:fiveDatabaseRemoteSchemaEvidencePath,
    domainCount:5,
    runtimeCutoverAuthorized:false,
  }
  if (!readinessEvidence ||
      Object.keys(expectedReadinessEvidence).some((key) => readinessEvidence[key] !== expectedReadinessEvidence[key])) {
    fail('readiness register must reference the five-database remote schema Postflight evidence without authorizing cutover')
  }
  return {
    status:evidence.status,
    databaseCount:5,
    domains:resultDomains,
    d1_03FullDomainSchemaComplete:false,
    d1_05RuntimeDataIngestionEnabled:false,
    businessDataImportAuthorized:false,
    productionCutoverAuthorized:false,
  }
}

export function validateSharedRunnerLedgerReadiness({ledger,readiness,reviews,d104RemoteReview,remoteSchemaEvidence,remoteSchemaReviews} = {}) {
  const d104RemoteSchema = validateD104RemoteSchemaEvidence({review:d104RemoteReview,readinessEvidence:readiness?.domains?.['D1-04']?.remoteSchemaEvidence})
  const fiveDatabaseRemoteSchema = validateFiveDatabaseRemoteSchemaEvidence({evidence:remoteSchemaEvidence,remoteReviews:remoteSchemaReviews,d104RemoteSchema,readinessEvidence:readiness?.remoteSchemaProvisioningEvidence})
  const execution = ledger?.execution
  const remoteDomains = execution?.domainReadiness ?? {}
  if (ledger?.remoteApplyReady !== false ||
      execution?.remoteApplyReady !== false ||
      execution?.runnerStatus !== expectedRemoteRunnerStatus ||
      execution?.runnerEntryPoint !== 'scripts/neon/run-schema-migrations.mjs') {
    fail('the immutable migration ledger must keep its remote runner limited to D1-01/D1-02 and globally remote-apply blocked')
  }
  if (!sameSet(Object.keys(remoteDomains),expectedDomains)) {
    fail('the five-domain remote readiness map must remain complete and exact')
  }
  for (const domain of ['D1-01','D1-02']) {
    if (remoteDomains[domain]?.runnerStatus !== 'IMPLEMENTED_AND_REVIEWED' ||
        remoteDomains[domain]?.remoteApplyReady !== true ||
        typeof remoteDomains[domain]?.reviewEvidenceRef !== 'string') {
      fail(domain + ' existing remote-runner readiness and review evidence must not regress')
    }
  }
  for (const domain of ['D1-03','D1-04','D1-05']) {
    if (remoteDomains[domain]?.runnerStatus !== 'NOT_IMPLEMENTED' ||
        remoteDomains[domain]?.remoteApplyReady !== false) {
      fail(domain + ' remote runner must remain unimplemented and blocked in the original migration ledger')
    }
  }

  if (readiness?.status !== 'LOCAL_SHARED_RUNNER_IMPLEMENTED_AND_INDEPENDENTLY_REVIEWED' ||
      readiness?.remoteRunner?.contractRef !== ledgerPath ||
      readiness?.remoteRunner?.runnerEntryPoint !== 'scripts/neon/run-schema-migrations.mjs' ||
      readiness?.remoteRunner?.runnerScope !== 'REMOTE_NEON_APPLY_ONLY' ||
      readiness?.remoteRunner?.runnerStatus !== expectedRemoteRunnerStatus ||
      !sameSet(readiness?.remoteRunner?.supportedDomains ?? [],['D1-01','D1-02']) ||
      readiness?.remoteRunner?.remoteApplyReady !== false) {
    fail('the supplemental readiness register must preserve the immutable remote runner contract and scope')
  }
  const localRunner = readiness?.localSharedRunner
  if (localRunner?.status !== expectedLocalRunnerStatus ||
      localRunner?.entryPoint !== 'scripts/neon/shared-domain-schema-runner.mjs' ||
      !sameSet(localRunner?.supportedDomains ?? [],['D1-03','D1-04','D1-05']) ||
      localRunner?.postgresMajor !== 18 ||
      localRunner?.executionMode !== 'LOCAL_ONLY' ||
      localRunner?.remoteNeonExecutionSupported !== false ||
      localRunner?.businessDataImport !== false ||
      localRunner?.productionCutoverAuthorized !== false ||
      localRunner?.workflow !== '.github/workflows/neon-shared-d1-03-05-schema-rehearsal.yml' ||
      localRunner?.successfulPostflightRunId !== 42509822425) {
    fail('the shared D1-03/D1-04/D1-05 executor must remain independently reviewed and local-only')
  }
  if (!sameSet(Object.keys(localRunner?.independentReviewEvidence ?? {}),['D1-03','D1-04','D1-05'])) {
    fail('local shared runner evidence must include an independent review for every supported domain')
  }

  const resultDomains = {}
  for (const domain of ['D1-03','D1-04','D1-05']) {
    const entry = readiness?.domains?.[domain]
    const review = reviews?.[domain]
    const expectedReviewPath = reviewPaths[domain]
    const reviewStatus = domain === 'D1-05'
      ? 'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_ADMISSION_BLOCKED'
      : 'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED'

    if (entry?.localStatus !== reviewStatus ||
        entry?.reviewEvidenceRef !== expectedReviewPath ||
        entry?.remoteApplyReady !== false ||
        !Array.isArray(entry?.remoteApplyBlockers) ||
        entry.remoteApplyBlockers.length === 0) {
      fail(domain + ' local readiness entry must retain its exact independent review reference and remote blockers')
    }
    if (localRunner.independentReviewEvidence[domain] !== expectedReviewPath ||
        review?.status !== reviewStatus ||
        review?.remoteApplyReady !== false ||
        review?.businessDataImport !== false ||
        review?.productionCutoverAuthorized !== false) {
      fail(domain + ' independent review contract must match the supplemental local readiness register and remain remote blocked')
    }
    if (review.review?.sharedPostgres18WorkflowRunId !== localRunner.successfulPostflightRunId ||
        !review.review?.d1Postflight ||
        review.review.d1Postflight.domainId !== domain ||
        review.review.d1Postflight.postgresMajor !== 18 ||
        review.review.d1Postflight.remoteNeonTouched !== false ||
        review.review.d1Postflight.cloudflareD1Touched !== false ||
        review.review.d1Postflight.remoteApplyReady !== false) {
      fail(domain + ' local PostgreSQL 18 postflight evidence does not match the independent review')
    }
    const expectedBlockers = [...(review.remoteApplyBlockers ?? [])].sort()
    if (!sameSet(entry.remoteApplyBlockers,expectedBlockers)) {
      fail(domain + ' supplemental blockers must match the complete independent-review blocker set')
    }
    resultDomains[domain] = {
      localStatus:entry.localStatus,
      remoteRunnerStatus:remoteDomains[domain].runnerStatus,
      remoteApplyReady:false,
      reviewEvidenceRef:entry.reviewEvidenceRef,
      blockerCount:entry.remoteApplyBlockers.length,
      localPostflightWorkflowRunId:entry.sharedPostflightRunId,
      ...(domain === 'D1-04' ? {remoteSchemaEvidence:d104RemoteSchema} : {}),
    }
  }

  if (readiness.domains['D1-05'].standalonePostgres18RunId !== reviews['D1-05'].review?.d105StandalonePostgres18WorkflowRunId) {
    fail('D1-05 standalone PostgreSQL 18 rehearsal reference must match its independent review')
  }
  if (readiness.safety?.remoteNeonTouched !== false ||
      readiness.safety?.cloudflareD1Touched !== false ||
      readiness.safety?.businessDataImported !== false ||
      readiness.safety?.runtimeBindingsChanged !== false ||
      readiness.safety?.productionCutoverAuthorized !== false ||
      readiness.remoteApplyReady !== false) {
    fail('supplemental local readiness register must never authorize remote execution, import or cutover')
  }

  return {
    status:'SHARED_RUNNER_EVIDENCE_RECONCILED_D1_04_SCHEMA_ALREADY_APPLIED_REMOTE_CUTOVER_BLOCKED',
    remoteRunner:{
      status:execution.runnerStatus,
      supportedDomains:['D1-01','D1-02'],
      remoteApplyReady:false,
    },
    localSharedRunner:{
      entryPoint:localRunner.entryPoint,
      status:localRunner.status,
      supportedDomains:[...localRunner.supportedDomains].sort(),
      postgresMajor:localRunner.postgresMajor,
      executionMode:localRunner.executionMode,
      remoteNeonExecutionSupported:false,
    },
    domains:resultDomains,
    remoteSchemaProvisioning:fiveDatabaseRemoteSchema,
    safety:{
      remoteNeonTouched:false,
      cloudflareD1Touched:false,
      businessDataImported:false,
      productionCutoverAuthorized:false,
    },
  }
}

export function verifySharedRunnerLedgerReadiness({readSource = readText} = {}) {
  const ledger = readJson(ledgerPath,readSource)
  const readiness = readJson(readinessPath,readSource)
  const reviews = Object.fromEntries(Object.entries(reviewPaths).map(([domain,path]) => [
    domain,readJson(path,readSource),
  ]))
  const d104RemoteReview = readJson(d104RemoteReviewPath,readSource)
  const remoteSchemaEvidence = readJson(fiveDatabaseRemoteSchemaEvidencePath,readSource)
  const remoteSchemaReviews = Object.fromEntries(Object.entries(remoteSchemaReviewPaths).map(([domain,path]) => [domain,readJson(path,readSource)]))
  return validateSharedRunnerLedgerReadiness({ledger,readiness,reviews,d104RemoteReview,remoteSchemaEvidence,remoteSchemaReviews})
}

function run() {
  const result = verifySharedRunnerLedgerReadiness()
  const output = 'artifacts/neon/shared-runner-ledger-readiness.json'
  mkdirSync(dirname(resolve(repositoryRoot,output)),{recursive:true})
  writeFileSync(resolve(repositoryRoot,output),JSON.stringify(result,null,2)+'\n')
  process.stdout.write('SHARED_RUNNER_LOCAL_READINESS_PASS ' + JSON.stringify(result) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  }
}
