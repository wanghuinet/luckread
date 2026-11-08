import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

const SHA40 = /^[0-9a-f]{40}$/
const BLOB_SHA1 = /^[0-9a-f]{40}$/
const RUN_URL = /^https:\/\/github\.com\/wanghuinet\/luckread\/actions\/runs\/\d+$/
const REVIEW_REF = 'contracts/database/neon-d1-02-remote-runner-review.v1.json'
const IMPLEMENTATION_MERGE_SHA = '7f6b4848b86d041aba5cfca7ea4549dc50a9c7d3'
const fail = (errors, message) => errors.push(message)

export function validateD1_02RemoteRunnerReview({
  root = process.cwd(),
  review,
  currentHead,
  hashBlob = (relativePath) => execFileSync('git', ['hash-object', relativePath], { cwd: root, encoding: 'utf8' }).trim(),
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
      record = JSON.parse(readFileSync(resolve(root, REVIEW_REF), 'utf8'))
    } catch (error) {
      fail(errors, 'D1-02 remote runner review record is missing or invalid: ' + error.message)
      return { valid: false, errors }
    }
  }

  if (record.status !== 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS' ||
      record.repository !== 'wanghuinet/luckread' ||
      record.target?.domainId !== 'D1-02' ||
      record.target?.databaseName !== 'luckreadpro' ||
      record.target?.databaseUuid !== '6c342634-97f6-4248-9f4a-85772af4f22c' ||
      record.target?.neonHost !== 'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech' ||
      record.target?.postgresMajor !== 18 ||
      record.target?.scope !== 'schema-only' ||
      record.target?.businessDataImport !== false ||
      record.target?.productionCutoverAuthorized !== false) {
    fail(errors, 'review record does not pin the exact D1-02 luckreadpro PostgreSQL 18 schema-only target')
  }

  const info = record.review ?? {}
  if (info.reviewer !== 'GPT-6' ||
      info.reviewType !== 'GPT-6 code-path audit plus current-main SHA and CI evidence reconciliation' ||
      !/^2026-11-\d{2}$/.test(info.reviewedAt ?? '') ||
      info.reviewedMainSha !== IMPLEMENTATION_MERGE_SHA ||
      info.implementationMergeSha !== IMPLEMENTATION_MERGE_SHA ||
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
      !info.limitations.some((item) => /GitHub repository secrets cannot be enumerated/i.test(item)) ||
      !info.limitations.some((item) => /database UUID is pinned as user-provided Neon metadata/i.test(item))) {
    fail(errors, 'review record must disclose the absence of formal review, remote execution and external secret/UUID verification')
  }
  if (!Array.isArray(info.reviewedFiles) || info.reviewedFiles.length < 10) {
    fail(errors, 'review must pin the D1-02 runner, workflow, tests, owner SQL and D1-01 compatibility checks')
  } else {
    for (const item of info.reviewedFiles) {
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
          fail(errors, 'reviewed source blob drift invalidates D1-02 release: ' + relativePath)
        }
      } catch (error) {
        fail(errors, 'cannot verify reviewed source blob for ' + relativePath + ': ' + error.message)
      }
    }
  }

  const evidence = record.verificationEvidence ?? {}
  const required = {
    fullD1_02LocalPostgres18Rehearsal: 42480684871,
    remoteRunnerGuardsNoCredentials: 42480684866,
    contractAdmission: 42480684886,
    mapping0StructuralGate: 42480684852,
    featureInventory: 42480684859,
  }
  for (const [key, runId] of Object.entries(required)) {
    const item = evidence[key]
    if (item?.runId !== runId || item?.headSha !== IMPLEMENTATION_MERGE_SHA ||
        item?.conclusion !== 'success' || typeof item?.url !== 'string' || !RUN_URL.test(item.url)) {
      fail(errors, 'successful current-main GitHub Actions evidence is missing or mismatched: ' + key)
    }
  }
  if (evidence.remoteRunnerGuardsNoCredentials?.remoteApplyJob !== 'skipped') {
    fail(errors, 'review evidence must prove that CI did not dispatch remote DDL')
  }

  const safety = record.safety ?? {}
  if (safety.remoteNeonDdlExecuted !== false ||
      safety.cloudflareD1Touched !== false ||
      safety.businessDataImported !== false ||
      safety.productionCutoverAuthorized !== false ||
      safety.manualWorkflowDispatchRequired !== true ||
      safety.exactConfirmationRequired !== 'APPLY_REVIEWED_SCHEMA_D1_02_LUCKREADPRO') {
    fail(errors, 'review record does not preserve the manual-only schema bootstrap boundary')
  }

  return { valid: errors.length === 0, errors, currentHead }
}

export { REVIEW_REF as D1_02_REVIEW_EVIDENCE_REF }
