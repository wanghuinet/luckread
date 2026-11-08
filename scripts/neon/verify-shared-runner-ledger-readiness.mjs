#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ledgerPath = 'contracts/database/neon-schema-migration-ledger.v1.json'
const reviewPaths = Object.freeze({
  'D1-03':'contracts/database/neon-d1-03-shared-runner-independent-review.v1.json',
  'D1-04':'contracts/database/neon-d1-04-shared-runner-independent-review.v1.json',
  'D1-05':'contracts/database/neon-d1-05-shared-runner-independent-review.v1.json',
})
const expectedRemoteRunnerStatus = 'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY'
const expectedLocalRunnerStatus = 'IMPLEMENTED_AND_INDEPENDENTLY_REVIEWED'
const expectedDomains = ['D1-01','D1-02','D1-03','D1-04','D1-05']
const fail = (message) => { throw new Error('shared runner ledger readiness: ' + message) }
const readText = (relativePath) => readFileSync(resolve(repositoryRoot,relativePath),'utf8')
const readJson = (relativePath,readSource) => JSON.parse(readSource(relativePath))

function sameSet(actual,expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((value,index) => value === [...expected].sort()[index])
}

export function validateSharedRunnerLedgerReadiness({ledger,reviews} = {}) {
  const execution = ledger?.execution
  const domains = execution?.domainReadiness ?? {}
  if (ledger?.remoteApplyReady !== false ||
      execution?.remoteApplyReady !== false ||
      execution?.runnerStatus !== expectedRemoteRunnerStatus ||
      execution?.runnerScope !== 'REMOTE_NEON_APPLY_ONLY' ||
      execution?.runnerEntryPoint !== 'scripts/neon/run-schema-migrations.mjs') {
    fail('the production remote runner must remain limited to D1-01/D1-02 and globally remote-apply blocked')
  }
  if (!sameSet(Object.keys(domains),expectedDomains)) {
    fail('the five-domain remote readiness map must remain complete and exact')
  }
  for (const domain of ['D1-01','D1-02']) {
    if (domains[domain]?.runnerStatus !== 'IMPLEMENTED_AND_REVIEWED' ||
        domains[domain]?.remoteApplyReady !== true ||
        typeof domains[domain]?.reviewEvidenceRef !== 'string') {
      fail(domain + ' existing remote-runner readiness and review evidence must not regress')
    }
  }

  const localRunner = execution?.localSharedRunner
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
    fail('the shared D1-03/D1-04/D1-05 runner must remain PostgreSQL 18 local-only and independently reviewed')
  }
  if (!sameSet(Object.keys(localRunner?.independentReviewEvidence ?? {}),['D1-03','D1-04','D1-05'])) {
    fail('local shared runner evidence must include an independent review for every supported domain')
  }

  const resultDomains = {}
  for (const domain of ['D1-03','D1-04','D1-05']) {
    const readiness = domains[domain]
    const review = reviews?.[domain]
    const expectedReviewPath = reviewPaths[domain]
    const reviewStatus = domain === 'D1-05'
      ? 'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_ADMISSION_BLOCKED'
      : 'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED'

    if (readiness?.runnerStatus !== 'NOT_IMPLEMENTED' ||
        readiness?.runnerScope !== 'REMOTE_NEON_APPLY_ONLY' ||
        readiness?.localSharedRunnerStatus !== expectedLocalRunnerStatus ||
        readiness?.localReviewStatus !== reviewStatus ||
        readiness?.localReviewEvidenceRef !== expectedReviewPath ||
        readiness?.remoteApplyReady !== false ||
        !Array.isArray(readiness?.remoteApplyBlockers) ||
        readiness.remoteApplyBlockers.length === 0) {
      fail(domain + ' must distinguish reviewed local execution from an unimplemented/blocked remote runner')
    }
    if (localRunner.independentReviewEvidence[domain] !== expectedReviewPath ||
        review?.status !== reviewStatus ||
        review?.remoteApplyReady !== false ||
        review?.businessDataImport !== false ||
        review?.productionCutoverAuthorized !== false) {
      fail(domain + ' local independent review evidence must match the central ledger and remain remote blocked')
    }
    if (review.review?.sharedPostgres18WorkflowRunId !== localRunner.successfulPostflightRunId ||
        !review.review?.d1Postflight ||
        review.review.d1Postflight.domainId !== domain ||
        review.review.d1Postflight.postgresMajor !== 18 ||
        review.review.d1Postflight.remoteNeonTouched !== false ||
        review.review.d1Postflight.cloudflareD1Touched !== false ||
        review.review.d1Postflight.remoteApplyReady !== false) {
      fail(domain + ' local PostgreSQL 18 postflight evidence does not match the reviewed domain')
    }
    if (!readiness.remoteApplyBlockers.every((item) =>
      typeof item === 'string' && review.remoteApplyBlockers.includes(item))) {
      fail(domain + ' central remote blockers must be copied from the independent review evidence')
    }
    resultDomains[domain] = {
      remoteRunnerStatus:readiness.runnerStatus,
      localSharedRunnerStatus:readiness.localSharedRunnerStatus,
      localReviewStatus:readiness.localReviewStatus,
      remoteApplyReady:false,
      blockerCount:readiness.remoteApplyBlockers.length,
      localPostflightWorkflowRunId:readiness.localSchemaRehearsalRunId,
    }
  }

  if (domains['D1-05'].localStandaloneRehearsalRunId !== reviews['D1-05'].review?.d105StandalonePostgres18WorkflowRunId) {
    fail('D1-05 standalone PostgreSQL 18 rehearsal run reference must match its independent review')
  }
  if (execution.sharedLocalRunner?.remoteNeonExecutionSupported !== false) {
    fail('the local shared runner must never imply a remote execution path')
  }

  return {
    status:'SHARED_LOCAL_RUNNER_LEDGER_EVIDENCE_RECONCILED_REMOTE_APPLY_BLOCKED',
    remoteRunnerStatus:execution.runnerStatus,
    remoteApplyReady:false,
    localSharedRunner:{
      entryPoint:localRunner.entryPoint,
      status:localRunner.status,
      supportedDomains:[...localRunner.supportedDomains].sort(),
      postgresMajor:localRunner.postgresMajor,
      executionMode:localRunner.executionMode,
      remoteNeonExecutionSupported:false,
    },
    domains:resultDomains,
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
  const reviews = Object.fromEntries(Object.entries(reviewPaths).map(([domain,path]) => [
    domain,readJson(path,readSource),
  ]))
  return validateSharedRunnerLedgerReadiness({ledger,reviews})
}

function run() {
  const result = verifySharedRunnerLedgerReadiness()
  const output = 'artifacts/neon/shared-runner-ledger-readiness.json'
  mkdirSync(dirname(resolve(repositoryRoot,output)),{recursive:true})
  writeFileSync(resolve(repositoryRoot,output),JSON.stringify(result,null,2)+'\n')
  process.stdout.write('SHARED_RUNNER_LEDGER_READINESS_PASS ' + JSON.stringify(result) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  }
}
