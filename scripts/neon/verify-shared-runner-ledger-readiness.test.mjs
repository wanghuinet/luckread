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
  }
}

test('reconciles immutable five-database migration ledger with supplemental D1-03/D1-04/D1-05 local review evidence', () => {
  const result = validateSharedRunnerLedgerReadiness(baseline())
  assert.equal(result.status,'SHARED_LOCAL_RUNNER_EVIDENCE_RECONCILED_REMOTE_APPLY_BLOCKED')
  assert.equal(result.remoteRunner.status,'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY')
  assert.equal(result.remoteRunner.remoteApplyReady,false)
  assert.deepEqual(result.remoteRunner.supportedDomains,['D1-01','D1-02'])
  assert.deepEqual(result.localSharedRunner.supportedDomains,['D1-03','D1-04','D1-05'])
  assert.equal(result.domains['D1-03'].localStatus,'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED')
  assert.equal(result.domains['D1-04'].localStatus,'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED')
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
