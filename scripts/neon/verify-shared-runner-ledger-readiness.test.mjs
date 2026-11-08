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
    reviews:Object.fromEntries(Object.entries(reviewPaths).map(([domain,path]) => [domain,readJson(path)])),
  }
}

test('reconciles the five-database ledger with local D1-03/D1-04/D1-05 review evidence', () => {
  const result = validateSharedRunnerLedgerReadiness(baseline())
  assert.equal(result.status,'SHARED_LOCAL_RUNNER_LEDGER_EVIDENCE_RECONCILED_REMOTE_APPLY_BLOCKED')
  assert.equal(result.remoteRunnerStatus,'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY')
  assert.equal(result.remoteApplyReady,false)
  assert.deepEqual(result.localSharedRunner.supportedDomains,['D1-03','D1-04','D1-05'])
  assert.equal(result.domains['D1-03'].localSharedRunnerStatus,'IMPLEMENTED_AND_INDEPENDENTLY_REVIEWED')
  assert.equal(result.domains['D1-04'].localSharedRunnerStatus,'IMPLEMENTED_AND_INDEPENDENTLY_REVIEWED')
  assert.equal(result.domains['D1-05'].localReviewStatus,'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_ADMISSION_BLOCKED')
})

test('fails closed if any local-only domain is marked remote apply ready', () => {
  const data = baseline()
  data.ledger.execution.domainReadiness['D1-05'].remoteApplyReady = true
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /D1-05 must distinguish reviewed local execution/,
  )
})

test('fails closed if the D1-04 local review evidence reference is missing', () => {
  const data = baseline()
  delete data.ledger.execution.domainReadiness['D1-04'].localReviewEvidenceRef
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /D1-04 must distinguish reviewed local execution/,
  )
})

test('fails closed if the local shared runner claims remote Neon execution support', () => {
  const data = baseline()
  data.ledger.execution.localSharedRunner.remoteNeonExecutionSupported = true
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /shared D1-03\/D1-04\/D1-05 runner must remain PostgreSQL 18 local-only/,
  )
})

test('fails closed if D1-05 consent or retention blockers disappear', () => {
  const data = baseline()
  data.ledger.execution.domainReadiness['D1-05'].remoteApplyBlockers =
    data.ledger.execution.domainReadiness['D1-05'].remoteApplyBlockers
      .filter((item) => !/consent/i.test(item))
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /D1-05 central remote blockers must be copied from the independent review/,
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

test('fails closed if remote runner scope is changed to include the local-only domains', () => {
  const data = baseline()
  data.ledger.execution.runnerScope = 'REMOTE_NEON_APPLY_ALL_FIVE_DATABASES'
  assert.throws(
    () => validateSharedRunnerLedgerReadiness(data),
    /production remote runner must remain limited to D1-01\/D1-02/,
  )
})
