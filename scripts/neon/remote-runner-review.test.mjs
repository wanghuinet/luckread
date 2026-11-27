import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateRemoteRunnerReview } from './remote-runner-review.mjs'

const review = JSON.parse(readFileSync(
  'contracts/database/neon-d1-01-remote-runner-review.v1.json',
  'utf8',
))

test('rejects the historical D1-01 review after the lifecycle manifest and runner sources change', () => {
  const result = validateRemoteRunnerReview({ review })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((message) => message.includes('invalidates the review')))
})

test('rejects any changed runner or ledger source after the review', () => {
  const drifted = structuredClone(review)
  drifted.review.reviewedFiles[0].gitBlobSha1 = 'f'.repeat(40)
  const result = validateRemoteRunnerReview({ review: drifted })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((message) => message.includes('invalidates the review')))
})

test('rejects remote apply evidence that did not remain skipped during PR validation', () => {
  const unsafe = structuredClone(review)
  unsafe.verificationEvidence.remoteRunnerGuardsNoCredentials.remoteApplyJob = 'success'
  const result = validateRemoteRunnerReview({ review: unsafe })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((message) => message.includes('did not run remote DDL')))
})

test('rejects review records that authorize business data or production cutover', () => {
  const unsafe = structuredClone(review)
  unsafe.safety.businessDataImported = true
  const result = validateRemoteRunnerReview({ review: unsafe })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((message) => message.includes('safety boundary')))
})

test('rejects missing or failed executable CI evidence', () => {
  const incomplete = structuredClone(review)
  incomplete.verificationEvidence.fullD1_01LocalPostgres18Rehearsal.conclusion = 'failure'
  const result = validateRemoteRunnerReview({ review: incomplete })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((message) => message.includes('fullD1_01LocalPostgres18Rehearsal')))
})
