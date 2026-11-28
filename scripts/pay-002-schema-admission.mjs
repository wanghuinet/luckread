const SHA40 = /^[0-9a-f]{40}$/
const SHA256 = /^sha256:[0-9a-f]{64}$/

const isCount = (value, expected) => Number.isSafeInteger(value) && value === expected

/**
 * Validate the evidence envelope before Contract CI permits D1-04-SCHEMA-01
 * to leave PENDING. The dedicated source-pinned D1-04 workflow validates the
 * actual Git blob pins and executes the local-only PostgreSQL 18 rehearsal.
 */
export function validatePay002D104SchemaEvidence({
  schemaEvidence,
  reviewRecord,
  manifest,
  sharedRunnerReview,
} = {}) {
  const errors = []
  const fail = (message) => errors.push(message)

  if (!schemaEvidence || typeof schemaEvidence !== 'object') {
    return { valid: false, errors: ['schema evidence record is missing'] }
  }
  if (schemaEvidence.status === 'PENDING') return { valid: true, pending: true, errors }
  if (schemaEvidence.status !== 'ADMITTED') {
    return { valid: false, errors: ['schema evidence status must be PENDING or ADMITTED'] }
  }

  const evidence = schemaEvidence.evidence ?? {}
  const sourceReview = evidence.sourceReview ?? {}
  const review = reviewRecord?.review ?? {}
  const validation = reviewRecord?.verificationEvidence?.remoteRunnerValidation ?? {}
  const postflight = evidence.historicalRemoteSchemaPostflight ?? {}
  const catalog = postflight.catalog ?? {}
  const expected = manifest?.expected ?? {}

  if (evidence.implementationCommit !== sourceReview.mergeCommit ||
      !SHA40.test(evidence.implementationCommit ?? '') ||
      !SHA40.test(evidence.verifiedMainSha ?? '')) {
    fail('implementation and verified-main commit SHAs must be pinned')
  }

  if (sourceReview.reviewStatus !== 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS' ||
      reviewRecord?.status !== sourceReview.reviewStatus ||
      review.result !== 'NO_BLOCKING_FINDINGS' ||
      reviewRecord?.remoteApplyReady !== true ||
      !SHA40.test(sourceReview.reviewedMainSha ?? '') ||
      sourceReview.reviewedMainSha !== review.reviewedMainSha ||
      review.reviewedMainSha !== review.implementationMergeSha ||
      !Array.isArray(review.findings) || review.findings.length !== 0) {
    fail('current-main D1-04 source review must be a passing, source-pinned review with no unresolved findings')
  }

  const pinAudit = sourceReview.currentMainPinAudit ?? {}
  if (!isCount(pinAudit.reviewedFiles, 27) ||
      !isCount(pinAudit.matchingFiles, 27) ||
      !isCount(pinAudit.driftedFiles, 0) ||
      !Array.isArray(review.reviewedFiles) ||
      review.reviewedFiles.length !== 27) {
    fail('all 27 reviewed D1-04 source pins must match current main')
  }

  if (!Number.isSafeInteger(sourceReview.sourcePinValidationRunId) ||
      validation.runId !== sourceReview.sourcePinValidationRunId ||
      validation.conclusion !== 'success' ||
      validation.headSha !== review.reviewedMainSha ||
      !SHA40.test(validation.sourceCommitSha ?? '') ||
      validation.validationScope !== 'D1_04_SCHEMA_ONLY_LOCAL_PG18_NO_NEON_CREDENTIALS' ||
      validation.remoteApplyJob !== 'skipped' ||
      !Number.isSafeInteger(validation.artifactId) ||
      !SHA256.test(validation.artifactDigest ?? '') ||
      typeof validation.url !== 'string' ||
      !/^https:\/\/github\.com\/wanghuinet\/luckread\/actions\/runs\/\d+$/.test(validation.url)) {
    fail('current-main source-pin validation must be successful local PostgreSQL 18 evidence with remote apply skipped')
  }

  if (postflight.workflowRunId !== 42555900393 ||
      !Number.isSafeInteger(postflight.artifactId) ||
      !SHA256.test(postflight.artifactDigest ?? '') ||
      postflight.postgresMajor !== 18 ||
      !isCount(postflight.appliedMigrations, 6) ||
      !isCount(postflight.appendOnlyLedgerRows, 6) ||
      !isCount(postflight.finalPostflightNewMigrationsApplied, 0)) {
    fail('historical remote D1-04 schema apply and final readback evidence is incomplete')
  }

  const catalogExpected = {
    tables: 15,
    explicitIndexes: 31,
    constraintIndexes: 29,
    triggers: 72,
    triggerFunctions: 6,
    foreignKeys: 0,
    businessRows: 0,
    controlSeedRows: 1,
  }
  for (const [key, value] of Object.entries(catalogExpected)) {
    if (!isCount(catalog[key], value) || !isCount(expected[key], value)) {
      fail('D1-04 postflight catalog mismatch for ' + key)
    }
  }

  if (manifest?.domainId !== 'D1-04' ||
      manifest?.databaseName !== 'luckread_finance' ||
      manifest?.postgresMajor !== 18 ||
      manifest?.remoteApplyReady !== false ||
      manifest?.businessDataImport !== false ||
      manifest?.productionCutoverAuthorized !== false) {
    fail('D1-04 migration manifest must retain the finance PostgreSQL 18 scope and blocked shared-runner/production boundary')
  }

  if (sharedRunnerReview?.status !== 'LOCAL_SHARED_SCHEMA_REVIEW_PASSED_REMOTE_APPLY_BLOCKED' ||
      sharedRunnerReview?.remoteApplyReady !== false ||
      sharedRunnerReview?.businessDataImport !== false ||
      sharedRunnerReview?.productionCutoverAuthorized !== false) {
    fail('canonical D1-04 shared runner must remain local-only and remote-apply-blocked')
  }

  const safety = reviewRecord?.safety ?? {}
  if (safety.remoteNeonDdlExecuted !== true ||
      safety.cloudflareD1Touched !== false ||
      safety.businessDataImported !== false ||
      safety.productionCutoverAuthorized !== false ||
      safety.manualWorkflowDispatchRequired !== true ||
      safety.exactConfirmationRequired !== 'APPLY_REVIEWED_SCHEMA_D1_04_FINANCE') {
    fail('historical remote schema application and no-new-DDL/data-import/cutover safety boundary must remain explicit')
  }

  if (typeof evidence.scopeLimit !== 'string' ||
      !/Does not authorize new remote DDL/i.test(evidence.scopeLimit) ||
      !/shared runner remains local-only/i.test(evidence.scopeLimit)) {
    fail('D1-04 schema admission must explicitly exclude new remote DDL and shared-runner release')
  }

  return { valid: errors.length === 0, pending: false, errors }
}
