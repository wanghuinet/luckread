import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { D105_REVIEW_REF } from './remote-runner-review.mjs'
import { validateD105RemoteRunnerReview } from './remote-runner-review.mjs'

const review = JSON.parse(readFileSync(D105_REVIEW_REF, 'utf8'))

test('D1-05 remote release review remains closed before source-pinned approval', () => {
  const result = validateD105RemoteRunnerReview({ review })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('not approved')))
})

test('D1-05 review requires at least twenty immutable source pins', () => {
  const approvedShape = structuredClone(review)
  approvedShape.status = 'D1_05_SCHEMA_ONLY_REMOTE_PROVISIONING_APPROVED'
  approvedShape.schemaOnlyRemoteApplyReady = true
  approvedShape.review = {
    reviewer: 'GPT-6',
    reviewType: 'SCOPED_REMOTE_CODE_PATH_AUDIT_AND_CURRENT_MAIN_SOURCE_PIN_RECONCILIATION',
    reviewedAt: '2026-11-09',
    reviewedMainSha: 'a'.repeat(40),
    implementationMergeSha: 'a'.repeat(40),
    result: 'NO_BLOCKING_FINDINGS',
    findings: [],
    formalGitHubReviewSubmissions: 0,
    limitations: [
      'This is not a human GitHub APPROVE review.',
      'The apply requires a manual workflow_dispatch.',
      'Runtime data ingestion remains blocked until privacy admission.',
    ],
    reviewedFiles: [],
  }
  approvedShape.verificationEvidence = {
    releaseValidation: {
      runId: 1,
      conclusion: 'success',
      headSha: 'a'.repeat(40),
      validationScope: 'D1_05_SCHEMA_ONLY_REMOTE_RUNNER_VALIDATION_NO_NEON_CREDENTIALS',
      url: 'https://github.com/wanghuinet/luckread/actions/runs/1',
      remoteApplyJob: 'skipped',
      artifactId: 1,
      artifactDigest: 'sha256:' + 'b'.repeat(64),
    },
  }
  const result = validateD105RemoteRunnerReview({
    review: approvedShape,
    currentHead: 'a'.repeat(40),
    hashBlob: () => 'c'.repeat(40),
    hashBlobAtCommit: () => 'c'.repeat(40),
    isAncestor: () => true,
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('must pin')))
})
