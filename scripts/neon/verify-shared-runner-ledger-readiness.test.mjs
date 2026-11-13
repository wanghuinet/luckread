import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSharedRunnerLedgerReadiness } from './verify-shared-runner-ledger-readiness.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(repositoryRoot,relativePath),'utf8'))
const reviewPaths = {
  'D1-03':'contracts/database/neon-d1-03-shared-runner-independent-review.v1.json',
  'D1-04':'contracts/database/neon-d1-04-shared-runner-independent-review.v1.json',
  'D1-05':'contracts/database/neon-d1-05-shared-runner-independent-review.v1.json',
}
function baseline() {
  return {
    ledger:readJson('contracts/database/neon-schema-migration-ledger.v1.json'),
    readiness:readJson('contracts/database/neon-shared-runner-local-readiness.v1.json'),
    reviews:Object.fromEntries(Object.entries(reviewPaths).map(([domain,path]) => [domain,readJson(path)])),
    d104RemoteReview:readJson('contracts/database/neon-d1-04-remote-runner-review.v1.json'),
    remoteSchemaEvidence:readJson('contracts/database/neon-five-database-remote-schema-evidence.v1.json'),
    remoteSchemaReviews:Object.fromEntries(['D1-01','D1-02','D1-03','D1-04','D1-05'].map((domain) => [domain,readJson('contracts/database/neon-' + domain.toLowerCase() + '-remote-runner-review.v1.json')])),
  }
}

test('reconciles immutable five-database migration ledger with supplemental D1-03/D1-04/D1-05 local review evidence', () => {
  const result = validateSharedRunnerLedgerReadiness(baseline())
  assert.equal(result.status,'SHARED_RUNNER_EVIDENCE_RECONCILED_D1_04_SCHEMA_ALREADY_APPLIED_REMOTE_CUTOVER_BLOCKED')
  assert.equal(result.remoteRunner.status,'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY')
  assert.equal(result.remoteRunner.remoteApplyReady,false)
  assert.deepEqual(result.remoteRunner.supportedDomains,['D1-01','D1-02'])
  assert.deepEqual(result.localSharedRunner.supportedDomains,['D1-03','D1-04','D1-05'])
  assert.equal(result.domains['D1-03'].localStatus,'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED')
  assert.equal(result.domains['D1-04'].localStatus,'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED')
  assert.equal(result.domains['D1-04'].remoteSchemaEvidence.status,'REMOTE_SCHEMA_ONLY_APPLIED')
  assert.equal(result.domains['D1-04'].remoteSchemaEvidence.workflowRunId,42555900393)
  assert.equal(result.domains['D1-04'].remoteSchemaEvidence.verifiedLedgerRows,6)
  assert.equal(result.domains['D1-04'].remoteSchemaEvidence.businessRows,0)
  assert.equal(result.domains['D1-04'].remoteSchemaEvidence.productionCutoverAuthorized,false)
  assert.equal(result.remoteSchemaProvisioning.databaseCount,5)
  assert.equal(result.remoteSchemaProvisioning.domains['D1-01'].migrationCount,14)
  assert.equal(result.remoteSchemaProvisioning.domains['D1-02'].tablesVerified,28)
  assert.equal(result.remoteSchemaProvisioning.domains['D1-03'].fullDomainSchemaComplete,false)
  assert.equal(result.remoteSchemaProvisioning.domains['D1-04'].businessDataImported,false)
  assert.equal(result.remoteSchemaProvisioning.domains['D1-05'].runtimeDataIngestionEnabled,false)
  assert.equal(result.remoteSchemaProvisioning.productionCutoverAuthorized,false)
  assert.equal(result.domains['D1-05'].localStatus,'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_ADMISSION_BLOCKED')
  assert.equal(result.safety.remoteNeonTouched,false)
})

test('fails closed if any local-only domain is marked remote apply ready', () => {
  const data = baseline()
  data.readiness.domains['D1-05'].remoteApplyReady = true
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /D1-05 local readiness entry must retain/,
  )
})

test('fails closed if the D1-04 local review evidence reference is missing', () => {
  const data = baseline()
  delete data.readiness.domains['D1-04'].reviewEvidenceRef
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /D1-04 local readiness entry must retain/,
  )
})

test('fails closed if the local shared runner claims remote Neon execution support', () => {
  const data = baseline()
  data.readiness.localSharedRunner.remoteNeonExecutionSupported = true
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /shared D1-03\/D1-04\/D1-05 executor must remain independently reviewed and local-only/,
  )
})

test('fails closed if D1-05 consent or retention blockers disappear', () => {
  const data = baseline()
  data.readiness.domains['D1-05'].remoteApplyBlockers =
    data.readiness.domains['D1-05'].remoteApplyBlockers
      .filter((item) => !/consent/i.test(item))
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /D1-05 supplemental blockers must match/,
  )
})

test('fails closed if D1-01 remote readiness is weakened or its review reference is removed', () => {
  const data = baseline()
  data.ledger.execution.domainReadiness['D1-01'].remoteApplyReady = false
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /D1-01 existing remote-runner readiness and review evidence must not regress/,
  )
})

test('fails closed if the immutable remote migration runner is broadened to D1-03/D1-04/D1-05', () => {
  const data = baseline()
  data.readiness.remoteRunner.supportedDomains.push('D1-03')
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /supplemental readiness register must preserve the immutable remote runner contract/,
  )
})

test('fails closed if D1-04 remote history no longer proves six verified rows without DDL replay', () => {
  const data = baseline()
  data.d104RemoteReview.executionHistory.find((entry) => entry.runId === 42555900393).newlyAppliedMigrations = 1
  assert.throws(() => validateSharedRunnerLedgerReadiness(data), /without replaying DDL/)
})

test('fails closed if D1-04 remote schema evidence reports business data', () => {
  const data = baseline()
  data.d104RemoteReview.verificationEvidence.remoteSchemaPostflight.catalog.businessRows = 1
  assert.throws(() => validateSharedRunnerLedgerReadiness(data), /six-migration catalog evidence/)
})

test('fails closed if D1-04 remote schema evidence is omitted from the readiness register', () => {
  const data = baseline()
  delete data.readiness.domains['D1-04'].remoteSchemaEvidence
  assert.throws(() => validateSharedRunnerLedgerReadiness(data), /separately record the existing remote schema-only Postflight/)
})

test('fails closed if the D1-03 partial schema is mislabeled as a complete domain schema', () => {
  const data = baseline()
  data.remoteSchemaEvidence.domains['D1-03'].fullDomainSchemaComplete = true
  assert.throws(() => validateSharedRunnerLedgerReadiness(data), /D1-03 must remain explicitly partial/)
})

test('fails closed if D1-05 analytics data ingestion is enabled before privacy-policy admission', () => {
  const data = baseline()
  data.remoteSchemaEvidence.domains['D1-05'].runtimeDataIngestionEnabled = true
  assert.throws(() => validateSharedRunnerLedgerReadiness(data), /D1-05 must remain schema-only/)
})

test('fails closed if any of the five remote artifact digests drift', () => {
  const data = baseline()
  data.remoteSchemaEvidence.domains['D1-02'].artifact.digest = 'sha256:' + '0'.repeat(64)
  assert.throws(() => validateSharedRunnerLedgerReadiness(data), /D1-02 remote Schema Postflight/)
})

test('fails closed if the five-database evidence set loses a domain', () => {
  const data = baseline()
  delete data.remoteSchemaEvidence.domains['D1-04']
  assert.throws(() => validateSharedRunnerLedgerReadiness(data), /exact Neon domain set/)
})
