import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

const SHA40 = /^[0-9a-f]{40}$/
const BLOB_SHA1 = /^[0-9a-f]{40}$/
const RUN_URL = /^https:\/\/github\.com\/wanghuinet\/luckread\/actions\/runs\/\d+$/
export const D103_REVIEW_REF = 'contracts/database/neon-d1-03-remote-runner-review.v1.json'

const fail = (errors, message) => errors.push(message)

export function validateD103RemoteRunnerReview({
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
  if (!review || review.status !== 'PARTIAL_SCHEMA_REMOTE_RELEASE_APPROVED' ||
      review.partialRemoteApplyReady !== true || review.remoteApplyReady !== false ||
      review.repository !== 'wanghuinet/luckread') {
    fail(errors, 'D1-03 partial remote release record is not approved or attempts to imply full-domain readiness')
    return { valid: false, errors }
  }
  const target = review.target ?? {}
  if (target.domainId !== 'D1-03' ||
      target.databaseName !== 'luckread_governance' ||
      target.cloudflareD1DatabaseUuid !== 'bda1d247-a371-4244-91ae-aef96034db7f' ||
      target.neonHost !== 'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech' ||
      target.postgresMajor !== 18 || target.scope !== 'schema-only' ||
      target.businessDataImport !== false || target.productionCutoverAuthorized !== false) {
    fail(errors, 'review record must pin the exact D1-03 luckread_governance PostgreSQL 18 schema-only target')
  }
  const scope = review.scope ?? {}
  const expectedIds = ['d1-03-w06-moderation-schema-v1','d1-03-w09-platform-schema-v1','d1-03-w10-async-execution-schema-v1']
  if (scope.kind !== 'ADMITTED_MANIFEST_ENTRIES_ONLY' ||
      JSON.stringify(scope.migrationIds) !== JSON.stringify(expectedIds) ||
      scope.migrationCount !== 3 || scope.tables !== 15 ||
      scope.explicitIndexes !== 22 || scope.triggers !== 2 ||
      scope.triggerFunctions !== 1 || scope.foreignKeys !== 2 ||
      scope.businessRows !== 0 || scope.controlSeedRows !== 0 ||
      scope.fullDomainSchemaComplete !== false ||
      scope.omittedEntitiesRemainUnadmitted !== true) {
    fail(errors, 'review scope must remain exactly the three admitted W06/W09/W10 migrations and 15-table inventory')
  }
  const omitted = [...(scope.omittedEntities ?? [])].sort()
  const expectedOmitted = ['Appeal','Campaign','GrowthOperation','PlatformRuntime','ReconciliationOperation','RecoveryOperation'].sort()
  if (JSON.stringify(omitted) !== JSON.stringify(expectedOmitted)) {
    fail(errors, 'review must keep every unadmitted D1-03 entity excluded from this partial release')
  }
  const info = review.review ?? {}
  if (info.reviewer !== 'GPT-6' ||
      info.reviewType !== 'SCOPED_REMOTE_CODE_PATH_AUDIT_AND_CURRENT_MAIN_SOURCE_PIN_RECONCILIATION' ||
      !/^2026-11-[0-9]{2}$/.test(info.reviewedAt ?? '') ||
      info.reviewedMainSha !== info.implementationMergeSha ||
      info.result !== 'NO_BLOCKING_FINDINGS' ||
      info.formalGitHubReviewSubmissions !== 0) {
    fail(errors, 'D1-03 review provenance, result or formal-review limitations are incomplete')
  }
  if (!SHA40.test(info.reviewedMainSha ?? '') || !SHA40.test(info.implementationMergeSha ?? '')) {
    fail(errors, 'D1-03 review provenance SHA is malformed')
  }
  if (currentHead && (!SHA40.test(currentHead) || !isAncestor(info.reviewedMainSha, currentHead))) {
    fail(errors, 'reviewed D1-03 main commit is not an ancestor of the checked-out release commit')
  }
  if (!Array.isArray(info.findings) || info.findings.length !== 0) {
    fail(errors, 'D1-03 partial remote review contains unresolved findings')
  }
  if (!Array.isArray(info.limitations) ||
      !info.limitations.some((item) => /not a human GitHub APPROVE review/i.test(item)) ||
      !info.limitations.some((item) => /manual workflow_dispatch/i.test(item)) ||
      !info.limitations.some((item) => /does not complete the full D1-03/i.test(item))) {
    fail(errors, 'D1-03 remote release review must disclose its scope and approval limitations')
  }
  const validation = review.verificationEvidence?.releaseValidation
  if (!Number.isSafeInteger(validation?.runId) ||
      validation?.conclusion !== 'success' ||
      !SHA40.test(validation?.headSha ?? '') ||
      validation?.validationScope !== 'D1_03_PARTIAL_SCHEMA_REMOTE_RUNNER_VALIDATION_NO_NEON_CREDENTIALS' ||
      typeof validation?.url !== 'string' || !RUN_URL.test(validation.url) ||
      validation?.remoteApplyJob !== 'skipped' ||
      !Number.isSafeInteger(validation?.artifactId) ||
      !/^sha256:[0-9a-f]{64}$/.test(validation?.artifactDigest ?? '')) {
    fail(errors, 'D1-03 source-equivalent validation and sanitized PostgreSQL 18 artifact evidence is missing or mismatched')
  }
  const files = info.reviewedFiles
  if (!Array.isArray(files) || files.length < 20) {
    fail(errors, 'D1-03 review must pin the remote path, release gate, workflow, shared runner and all owner schema sources')
  } else {
    const seen = new Set()
    for (const item of files) {
      const path = item?.path
      if (typeof path !== 'string' || isAbsolute(path) ||
          path.includes('\\') || path.split('/').includes('..') ||
          !BLOB_SHA1.test(item?.gitBlobSha1 ?? '') || seen.has(path)) {
        fail(errors, 'D1-03 reviewed file pins contain an unsafe/duplicate path or malformed Git blob SHA')
        continue
      }
      seen.add(path)
      const absolute = resolve(root, path)
      if (!absolute.startsWith(resolve(root) + sep) || !existsSync(absolute)) {
        fail(errors, 'reviewed D1-03 source is absent from the checked-out tree: ' + path)
        continue
      }
      try {
        if (hashBlob(path) !== item.gitBlobSha1) {
          fail(errors, 'reviewed D1-03 source blob drift invalidates release: ' + path)
        }
        if (hashBlobAtCommit(validation.headSha, path) !== item.gitBlobSha1) {
          fail(errors, 'D1-03 CI validation source blob differs from the reviewed source: ' + path)
        }
      } catch (error) {
        fail(errors, 'cannot verify reviewed D1-03 source blob for ' + path + ': ' + error.message)
      }
    }
  }
  const safety = review.safety ?? {}
  if (safety.remoteNeonDdlExecuted !== false ||
      safety.cloudflareD1Touched !== false ||
      safety.businessDataImported !== false ||
      safety.runtimeBindingsChanged !== false ||
      safety.productionCutoverAuthorized !== false ||
      safety.newWorkers !== 0 || safety.newD1Databases !== 0 ||
      safety.newQueues !== 0 || safety.newServiceBindings !== 0 ||
      review.businessDataImport !== false ||
      review.productionCutoverAuthorized !== false ||
      review.exactConfirmationRequired !== 'APPLY_REVIEWED_SCHEMA_D1_03_GOVERNANCE_PARTIAL') {
    fail(errors, 'D1-03 review record does not preserve the isolated manual-only schema bootstrap boundary')
  }
  return { valid: errors.length === 0, errors, currentHead }
}
