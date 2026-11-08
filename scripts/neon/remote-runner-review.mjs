import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

const SHA40 = /^[0-9a-f]{40}$/
const BLOB_SHA1 = /^[0-9a-f]{40}$/
const RUN_URL = /^https:\/\/github\.com\/wanghuinet\/luckread\/actions\/runs\/\d+$/

const fail = (errors, message) => errors.push(message)

export function validateRemoteRunnerReview({
  root = process.cwd(),
  review,
  currentHead,
} = {}) {
  const errors = []
  let record = review
  if (!record) {
    const reviewPath = resolve(root, 'contracts/database/neon-d1-01-remote-runner-review.v1.json')
    try {
      record = JSON.parse(readFileSync(reviewPath, 'utf8'))
    } catch (error) {
      fail(errors, 'remote runner review record is missing or invalid: ' + error.message)
      return { valid: false, errors }
    }
  }

  if (record.status !== 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS' ||
      record.repository !== 'wanghuinet/luckread' ||
      record.target?.domainId !== 'D1-01' ||
      record.target?.databaseName !== 'luckread' ||
      record.target?.postgresMajor !== 18 ||
      record.target?.scope !== 'schema-only' ||
      record.target?.businessDataImport !== false ||
      record.target?.productionCutoverAuthorized !== false) {
    fail(errors, 'review record does not authorize only the exact D1-01 schema-only target')
  }

  const reviewInfo = record.review ?? {}
  if (reviewInfo.reviewer !== 'GPT-6' ||
      reviewInfo.reviewType !== 'independent code-path review plus current-SHA CI evidence reconciliation' ||
      reviewInfo.result !== 'NO_BLOCKING_FINDINGS' ||
      !/^2026-11-\d{2}$/.test(reviewInfo.reviewedAt ?? '') ||
      !SHA40.test(reviewInfo.reviewedMainSha ?? '') ||
      !SHA40.test(reviewInfo.implementationMergeSha ?? '') ||
      !SHA40.test(reviewInfo.postflightTargetFixMergeSha ?? '') ||
      reviewInfo.formalGitHubReviewSubmissions !== 0) {
    fail(errors, 'review record reviewer, commit provenance, outcome or limitations metadata is incomplete')
  }

  if (!Array.isArray(reviewInfo.findings) || reviewInfo.findings.length !== 0) {
    fail(errors, 'remote runner review contains blocking or unresolved findings')
  }
  if (!Array.isArray(reviewInfo.limitations) ||
      !reviewInfo.limitations.some((item) => /no submitted GitHub review records/i.test(item)) ||
      !reviewInfo.limitations.some((item) => /Remote Neon DDL has not been executed/i.test(item))) {
    fail(errors, 'review record must disclose the lack of formal GitHub review and remote execution evidence')
  }

  if (!Array.isArray(reviewInfo.reviewedFiles) || reviewInfo.reviewedFiles.length < 3) {
    fail(errors, 'review record must pin the shared runner, runner tests and ledger DDL')
  } else {
    for (const item of reviewInfo.reviewedFiles) {
      const relativePath = item?.path
      if (typeof relativePath !== 'string' || isAbsolute(relativePath) ||
          relativePath.split(/[\\/]/).includes('..') ||
          typeof item.gitBlobSha1 !== 'string' || !BLOB_SHA1.test(item.gitBlobSha1)) {
        fail(errors, 'reviewed file record contains an unsafe path or invalid Git blob SHA')
        continue
      }
      const absolutePath = resolve(root, relativePath)
      if (!absolutePath.startsWith(resolve(root) + sep) || !existsSync(absolutePath)) {
        fail(errors, 'reviewed file is absent from the checked-out source: ' + relativePath)
        continue
      }
      try {
        const actual = execFileSync('git', ['hash-object', relativePath], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim()
        if (actual !== item.gitBlobSha1) {
          fail(errors, 'reviewed source drift invalidates the review: ' + relativePath)
        }
      } catch (error) {
        fail(errors, 'cannot verify reviewed source blob for ' + relativePath + ': ' + error.message)
      }
    }
  }

  const evidence = record.verificationEvidence ?? {}
  const requiredEvidence = [
    'fullD1_01LocalPostgres18Rehearsal',
    'w02BetterAuthPostgres18',
    'remoteRunnerGuardsNoCredentials',
    'contractAdmission',
    'mapping0StructuralGate',
  ]
  for (const key of requiredEvidence) {
    const item = evidence[key]
    if (!Number.isSafeInteger(item?.runId) ||
        item.conclusion !== 'success' ||
        typeof item.url !== 'string' || !RUN_URL.test(item.url)) {
      fail(errors, 'required successful GitHub Actions evidence is missing or invalid: ' + key)
    }
  }
  if (evidence.remoteRunnerGuardsNoCredentials?.remoteApplyJob !== 'skipped') {
    fail(errors, 'review evidence must prove that PR validation did not run remote DDL')
  }

  const safety = record.safety ?? {}
  if (safety.remoteNeonDdlExecuted !== false ||
      safety.productionD1Touched !== false ||
      safety.businessDataImported !== false ||
      safety.productionCutoverAuthorized !== false ||
      safety.manualWorkflowDispatchRequired !== true ||
      safety.exactConfirmationRequired !== 'APPLY_REVIEWED_SCHEMA_D1_01_LUCKREAD') {
    fail(errors, 'review record does not preserve the manual-only schema bootstrap safety boundary')
  }

  return { valid: errors.length === 0, errors, currentHead }
}
