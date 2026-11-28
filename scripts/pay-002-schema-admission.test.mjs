import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePay002D104SchemaEvidence } from './pay-002-schema-admission.mjs'

const sha = 'a'.repeat(40)
const digest = 'sha256:' + 'b'.repeat(64)
const url = 'https://github.com/wanghuinet/luckread/actions/runs/46133048169'

function validFixture() {
  const catalog = {
    tables: 15,
    explicitIndexes: 31,
    constraintIndexes: 29,
    triggers: 72,
    triggerFunctions: 6,
    foreignKeys: 0,
    businessRows: 0,
    controlSeedRows: 1,
  }
  const reviewedFiles = Array.from({ length: 27 }, (_, index) => ({
    path: 'reviewed/source-' + index + '.mjs',
    gitBlobSha1: sha,
  }))
  const reviewRecord = {
    status: 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS',
    remoteApplyReady: true,
    review: {
      reviewedMainSha: sha,
      implementationMergeSha: sha,
      result: 'NO_BLOCKING_FINDINGS',
      findings: [],
      reviewedFiles,
    },
    verificationEvidence: {
      remoteRunnerValidation: {
        runId: 46133048169,
        conclusion: 'success',
        headSha: sha,
        sourceCommitSha: 'c'.repeat(40),
        validationScope: 'D1_04_SCHEMA_ONLY_LOCAL_PG18_NO_NEON_CREDENTIALS',
        remoteApplyJob: 'skipped',
        artifactId: 15257958346,
        artifactDigest: digest,
        url,
      },
    },
    safety: {
      remoteNeonDdlExecuted: true,
      cloudflareD1Touched: false,
      businessDataImported: false,
      productionCutoverAuthorized: false,
      manualWorkflowDispatchRequired: true,
      exactConfirmationRequired: 'APPLY_REVIEWED_SCHEMA_D1_04_FINANCE',
    },
  }
  const manifest = {
    domainId: 'D1-04',
    databaseName: 'luckread_finance',
    postgresMajor: 18,
    remoteApplyReady: false,
    businessDataImport: false,
    productionCutoverAuthorized: false,
    expected: { ...catalog },
  }
  const sharedRunnerReview = {
    status: 'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED',
    remoteApplyReady: false,
    businessDataImport: false,
    productionCutoverAuthorized: false,
  }
  const schemaEvidence = {
    id: 'D1-04-SCHEMA-01',
    status: 'ADMITTED',
    evidence: {
      implementationCommit: sha,
      verifiedMainSha: sha,
      sourceReview: {
        mergeCommit: sha,
        reviewStatus: 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS',
        reviewedMainSha: sha,
        currentMainPinAudit: { reviewedFiles: 27, matchingFiles: 27, driftedFiles: 0 },
        sourcePinValidationRunId: 46133048169,
      },
      historicalRemoteSchemaPostflight: {
        workflowRunId: 42555900393,
        artifactId: 13646957840,
        artifactDigest: digest,
        postgresMajor: 18,
        appliedMigrations: 6,
        appendOnlyLedgerRows: 6,
        finalPostflightNewMigrationsApplied: 0,
        catalog,
      },
      scopeLimit: 'Admits existing schema only. Does not authorize new remote DDL. The canonical shared runner remains local-only.',
    },
  }
  return { schemaEvidence, reviewRecord, manifest, sharedRunnerReview }
}

test('D1-04 schema evidence remains pending without requiring remote apply proof', () => {
  const result = validatePay002D104SchemaEvidence({ schemaEvidence: { status: 'PENDING' } })
  assert.equal(result.valid, true)
  assert.equal(result.pending, true)
})

test('D1-04 schema admission accepts complete source review, PG18 and historical postflight evidence', () => {
  const result = validatePay002D104SchemaEvidence(validFixture())
  assert.equal(result.valid, true, result.errors.join('; '))
})

test('D1-04 schema admission rejects missing source pin matches', () => {
  const fixture = validFixture()
  fixture.schemaEvidence.evidence.sourceReview.currentMainPinAudit.driftedFiles = 1
  const result = validatePay002D104SchemaEvidence(fixture)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => /source pins/.test(error)))
})

test('D1-04 schema admission rejects a validation run that did not skip remote apply', () => {
  const fixture = validFixture()
  fixture.reviewRecord.verificationEvidence.remoteRunnerValidation.remoteApplyJob = 'success'
  const result = validatePay002D104SchemaEvidence(fixture)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => /remote apply skipped/.test(error)))
})

test('D1-04 schema admission rejects incomplete catalog or non-empty business data', () => {
  const fixture = validFixture()
  fixture.schemaEvidence.evidence.historicalRemoteSchemaPostflight.catalog.businessRows = 1
  const result = validatePay002D104SchemaEvidence(fixture)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => /businessRows/.test(error)))
})

test('D1-04 schema admission rejects releasing the canonical shared runner or production cutover', () => {
  const fixture = validFixture()
  fixture.sharedRunnerReview.remoteApplyReady = true
  const result = validatePay002D104SchemaEvidence(fixture)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => /shared runner/.test(error)))
})
