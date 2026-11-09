import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

const SHA40 = /^[0-9a-f]{40}$/
const BLOB_SHA1 = /^[0-9a-f]{40}$/
const RUN_URL = /^https:\/\/github\.com\/wanghuinet\/luckread\/actions\/runs\/\d+$/
export const D104_REVIEW_REF = 'contracts/database/neon-d1-04-remote-runner-review.v1.json'
const fail = (errors, message) => errors.push(message)

export function validateD104RemoteRunnerReview({
  root = process.cwd(),
  review,
  currentHead,
  hashBlob = (relativePath) => execFileSync('git', ['hash-object', relativePath], { cwd: root, encoding: 'utf8' }).trim(),
  hashBlobAtCommit = (commitSha, relativePath) =>
    execFileSync('git', ['rev-parse', commitSha + ':' + relativePath], { cwd: root, encoding: 'utf8' }).trim(),
  isAncestor = (ancestor, descendant) => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root, stdio: 'ignore' })
      return true
    } catch { return false }
  },
} = {}) {
  const errors = []
  let record = review
  if (!record) {
    try {
      record = JSON.parse(readFileSync(resolve(root, D104_REVIEW_REF), 'utf8'))
    } catch (error) {
      fail(errors, 'D1-04 remote runner review record is missing or invalid: ' + error.message)
      return { valid: false, errors }
    }
  }

  if (record.status !== 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS' ||
      record.repository !== 'wanghuinet/luckread' ||
      record.target?.domainId !== 'D1-04' ||
      record.target?.databaseName !== 'luckread_finance' ||
      record.target?.databaseUuid !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736' ||
      record.target?.neonHost !== 'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech' ||
      record.target?.postgresMajor !== 18 ||
      record.target?.scope !== 'schema-only' ||
      record.target?.businessDataImport !== false ||
      record.target?.productionCutoverAuthorized !== false) {
    fail(errors, 'review record does not pin the exact D1-04 luckread_finance PostgreSQL 18 schema-only target')
  }

  const info = record.review ?? {}
  if (info.reviewer !== 'GPT-6' ||
      info.reviewType !== 'GPT-6 code-path audit plus current-main SHA and CI evidence reconciliation' ||
      !/^2026-11-[0-9]{2}$/.test(info.reviewedAt ?? '') ||
      info.reviewedMainSha !== info.implementationMergeSha ||
      info.result !== 'NO_BLOCKING_FINDINGS' ||
      info.formalGitHubReviewSubmissions !== 0) {
    fail(errors, 'review provenance, reviewer type, result or limitations metadata is incomplete')
  }
  if (!SHA40.test(info.reviewedMainSha ?? '') || !SHA40.test(info.implementationMergeSha ?? '')) {
    fail(errors, 'review provenance SHA is malformed')
  }
  if (currentHead && (!SHA40.test(currentHead) || !isAncestor(info.reviewedMainSha, currentHead))) {
    fail(errors, 'reviewed main commit is not an ancestor of the checked-out release commit')
  }
  if (!Array.isArray(info.findings) || info.findings.length !== 0) {
    fail(errors, 'review record contains blocking or unresolved findings')
  }
  if (!Array.isArray(info.limitations) ||
      !info.limitations.some((item) => /no submitted GitHub review records/i.test(item)) ||
      !info.limitations.some((item) => /Remote Neon DDL has not been executed/i.test(item)) ||
      !info.limitations.some((item) => /Neon database UUID is pinned from existing W07 D1_04 Wrangler metadata/i.test(item))) {
    fail(errors, 'review record must disclose formal-review, remote-execution and external target-identity limitations')
  }

  const validation = record.verificationEvidence?.remoteRunnerValidation
  const validationHeadSha = validation?.headSha
  if (!SHA40.test(validationHeadSha ?? '')) {
    fail(errors, 'remote-runner CI head SHA is missing or malformed')
  }

  const reviewedFiles = info.reviewedFiles
  if (!Array.isArray(reviewedFiles) || reviewedFiles.length < 8) {
    fail(errors, 'review must pin the D1-04 remote runner, tests, workflow, release gate and W07 schema sources')
  } else {
    for (const item of reviewedFiles) {
      const relativePath = item?.path
      if (typeof relativePath !== 'string' || isAbsolute(relativePath) ||
          relativePath.split(/[\\/]/).includes('..') ||
          !BLOB_SHA1.test(item?.gitBlobSha1 ?? '')) {
        fail(errors, 'reviewed file record contains an unsafe path or invalid Git blob SHA')
        continue
      }
      const absolutePath = resolve(root, relativePath)
      if (!absolutePath.startsWith(resolve(root) + sep) || !existsSync(absolutePath)) {
        fail(errors, 'reviewed source is absent from the checked-out tree: ' + relativePath)
        continue
      }
      try {
        if (hashBlob(relativePath) !== item.gitBlobSha1) {
          fail(errors, 'reviewed source blob drift invalidates D1-04 release: ' + relativePath)
        }
        if (SHA40.test(validationHeadSha ?? '')) {
          const validationBlob = hashBlobAtCommit(validationHeadSha, relativePath)
          if (validationBlob !== item.gitBlobSha1) {
            fail(errors, 'CI validation source blob differs from the reviewed main source: ' + relativePath)
          }
        }
      } catch (error) {
        fail(errors, 'cannot verify reviewed source blob for ' + relativePath + ': ' + error.message)
      }
    }
  }

  const evidence = record.verificationEvidence ?? {}
  const local = evidence.d1_04SharedPostgres18
  if (local?.runId !== 42509822425 ||
      local?.conclusion !== 'success' ||
      typeof local?.url !== 'string' || !RUN_URL.test(local.url)) {
    fail(errors, 'successful shared D1-04 PostgreSQL 18 rehearsal evidence is missing or mismatched')
  }
  if (!Number.isSafeInteger(validation?.runId) ||
      validation?.conclusion !== 'success' ||
      !SHA40.test(validation?.sourceCommitSha ?? '') ||
      validation?.validationScope !== 'D1_04_SCHEMA_ONLY_LOCAL_PG18_NO_NEON_CREDENTIALS' ||
      typeof validation?.headBranch !== 'string' ||
      typeof validation?.url !== 'string' || !RUN_URL.test(validation.url) ||
      validation?.remoteApplyJob !== 'skipped' ||
      !Number.isSafeInteger(validation?.artifactId) ||
      !/^sha256:[0-9a-f]{64}$/.test(validation?.artifactDigest ?? '')) {
    fail(errors, 'successful source-equivalent PR validation and sanitized PG18 artifact evidence is missing or mismatched')
  }

  const safety = record.safety ?? {}
  if (safety.remoteNeonDdlExecuted !== false ||
      safety.cloudflareD1Touched !== false ||
      safety.businessDataImported !== false ||
      safety.productionCutoverAuthorized !== false ||
      safety.manualWorkflowDispatchRequired !== true ||
      safety.exactConfirmationRequired !== 'APPLY_REVIEWED_SCHEMA_D1_04_FINANCE') {
    fail(errors, 'review record does not preserve the manual-only schema bootstrap boundary')
  }

  return { valid: errors.length === 0, errors, currentHead }
}

