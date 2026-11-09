import test from 'node:test'
import assert from 'node:assert/strict'
import { validateD104RemoteRunnerReview } from './remote-runner-review.mjs'
import { validateD104ReleaseState } from './assert-remote-apply-release.mjs'

const sha = 'a'.repeat(40)
const run = 'https://github.com/wanghuinet/luckread/actions/runs/42509822425'
const baseReview = {
  status: 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS',
  remoteApplyReady: true,
  repository: 'wanghuinet/luckread',
  target: {
    domainId: 'D1-04',
    databaseName: 'luckread_finance',
    databaseUuid: '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736',
    neonHost: 'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech',
    postgresMajor: 18,
    scope: 'schema-only',
    businessDataImport: false,
    productionCutoverAuthorized: false,
  },
  review: {
    reviewer: 'GPT-6',
    reviewType: 'GPT-6 code-path audit plus current-main SHA and CI evidence reconciliation',
    reviewedAt: '2026-11-09',
    reviewedMainSha: sha,
    implementationMergeSha: sha,
    result: 'NO_BLOCKING_FINDINGS',
    formalGitHubReviewSubmissions: 0,
    findings: [],
    limitations: [
      'No submitted GitHub review records are present; this is a GPT-6 code review, not a human GitHub APPROVE review.',
      'Remote Neon DDL has not been executed.',
      'Neon database UUID is pinned from existing W07 D1_04 Wrangler metadata and is not exposed for independent verification by PostgreSQL SQL.',
    ],
    reviewedFiles: [
      { path: 'scripts/neon/d1-04/schema-only-runner.mjs', gitBlobSha1: sha },
      { path: 'scripts/neon/d1-04/schema-only-runner.test.mjs', gitBlobSha1: sha },
      { path: '.github/workflows/neon-d1-04-reviewed-remote-schema-apply.yml', gitBlobSha1: sha },
      { path: 'scripts/neon/d1-04/remote-runner-review.mjs', gitBlobSha1: sha },
      { path: 'scripts/neon/d1-04/assert-remote-apply-release.mjs', gitBlobSha1: sha },
      { path: 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json', gitBlobSha1: sha },
      { path: 'contracts/database/neon-d1-04-shared-runner-independent-review.v1.json', gitBlobSha1: sha },
      { path: 'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0001_w07_d1_04_order_payment_schema.sql', gitBlobSha1: sha },
    ],
  },
  verificationEvidence: {
    d1_04SharedPostgres18: { runId: 42509822425, conclusion: 'success', url: run },
    remoteRunnerValidation: { runId: 42509822425, conclusion: 'success', headSha: sha, url: run, remoteApplyJob: 'not-dispatched' },
  },
  safety: {
    remoteNeonDdlExecuted: false,
    cloudflareD1Touched: false,
    businessDataImported: false,
    productionCutoverAuthorized: false,
    manualWorkflowDispatchRequired: true,
    exactConfirmationRequired: 'APPLY_REVIEWED_SCHEMA_D1_04_FINANCE',
  },
}

const baseManifest = {
  domainId: 'D1-04',
  databaseName: 'luckread_finance',
  cloudflareD1DatabaseUuid: '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736',
  postgresMajor: 18,
  remoteApplyReady: false,
  businessDataImport: false,
  productionCutoverAuthorized: false,
  expected: { businessRows: 0 },
}
const baseLedger = {
  remoteApplyReady: false,
  execution: {
    remoteApplyReady: false,
    runnerEntryPoint: 'scripts/neon/run-schema-migrations.mjs',
    runnerStatus: 'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY',
    domainReadiness: {
      'D1-01': { runnerStatus: 'IMPLEMENTED_AND_REVIEWED', remoteApplyReady: true },
      'D1-02': { runnerStatus: 'IMPLEMENTED_AND_REVIEWED', remoteApplyReady: true },
      'D1-03': { runnerStatus: 'NOT_IMPLEMENTED', remoteApplyReady: false },
      'D1-04': { runnerStatus: 'NOT_IMPLEMENTED', remoteApplyReady: false },
      'D1-05': { runnerStatus: 'NOT_IMPLEMENTED', remoteApplyReady: false },
    },
  },
}
const baseReadiness = {
  domains: { 'D1-04': { remoteApplyReady: false } },
  localSharedRunner: { remoteNeonExecutionSupported: false },
}

test('D1-04 source-pinned review accepts the exact reviewed target and evidence', () => {
  const result = validateD104RemoteRunnerReview({
    root: '/repo',
    review: baseReview,
    currentHead: sha,
    hashBlob: () => sha,
    isAncestor: () => true,
  })
  assert.equal(result.valid, true, result.errors.join('; '))
})

test('D1-04 review rejects moved source pins and stale review commits', () => {
  const drift = validateD104RemoteRunnerReview({
    root: '/repo',
    review: baseReview,
    currentHead: sha,
    hashBlob: () => 'b'.repeat(40),
    isAncestor: () => true,
  })
  assert.equal(drift.valid, false)
  assert.ok(drift.errors.some((item) => /blob drift/.test(item)))
  const stale = validateD104RemoteRunnerReview({
    root: '/repo',
    review: baseReview,
    currentHead: 'c'.repeat(40),
    hashBlob: () => sha,
    isAncestor: () => false,
  })
  assert.equal(stale.valid, false)
  assert.ok(stale.errors.some((item) => /not an ancestor/.test(item)))
})

test('D1-04 release may use its separate runner without broadening the canonical D1-01/D1-02 runner', () => {
  const result = validateD104ReleaseState({
    manifest: baseManifest,
    ledgerContract: baseLedger,
    localReadiness: baseReadiness,
    review: baseReview,
    reviewValid: true,
  })
  assert.equal(result, true)
})

test('D1-04 release rejects any expansion of the original shared runner ledger scope', () => {
  const changed = structuredClone(baseLedger)
  changed.execution.domainReadiness['D1-04'] = {
    runnerStatus: 'IMPLEMENTED_AND_REVIEWED',
    remoteApplyReady: true,
  }
  assert.equal(validateD104ReleaseState({
    manifest: baseManifest,
    ledgerContract: changed,
    localReadiness: baseReadiness,
    review: baseReview,
    reviewValid: true,
  }), false)
})

test('D1-04 release rejects a review for another domain or one permitting business data/cutover', () => {
  const wrongDomain = structuredClone(baseReview)
  wrongDomain.target.domainId = 'D1-03'
  assert.equal(validateD104ReleaseState({
    manifest: baseManifest, ledgerContract: baseLedger, localReadiness: baseReadiness,
    review: wrongDomain, reviewValid: true,
  }), false)
  const unsafe = structuredClone(baseReview)
  unsafe.target.businessDataImport = true
  assert.equal(validateD104ReleaseState({
    manifest: baseManifest, ledgerContract: baseLedger, localReadiness: baseReadiness,
    review: unsafe, reviewValid: true,
  }), false)
})
