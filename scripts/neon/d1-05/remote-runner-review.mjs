import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

const SHA40 = /^[0-9a-f]{40}$/
const BLOB_SHA1 = /^[0-9a-f]{40}$/
const RUN_URL = /^https:\/\/github\.com\/wanghuinet\/luckread\/actions\/runs\/\d+$/
export const D105_REVIEW_REF = 'contracts/database/neon-d1-05-remote-runner-review.v1.json'

const addError = (errors, message) => errors.push(message)

export function validateD105RemoteRunnerReview({
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
  if (!review || review.status !== 'D1_05_SCHEMA_ONLY_REMOTE_PROVISIONING_APPROVED' ||
      review.schemaOnlyRemoteApplyReady !== true || review.remoteApplyReady !== false ||
      review.repository !== 'wanghuinet/luckread') {
    addError(errors, 'D1-05 release record is not approved or attempts to imply runtime readiness')
    return { valid: false, errors }
  }
  const target = review.target ?? {}
  if (target.domainId !== 'D1-05' ||
      target.databaseName !== 'allluck' ||
      target.cloudflareD1DatabaseUuid !== '77d82be2-d12e-4a17-b410-9aa7d376bc11' ||
      target.neonHostPattern !== 'ep-*.neon.tech' ||
      target.postgresMajor !== 18 || target.scope !== 'EMPTY_SCHEMA_ONLY' ||
      target.businessDataImport !== false || target.productionCutoverAuthorized !== false) {
    addError(errors, 'review record must pin the exact D1-05 allluck PostgreSQL 18 empty-schema-only target')
  }
  const scope = review.scope ?? {}
  if (scope.kind !== 'ALL_ADMITTED_W11_D1_05_ANALYTICS_SCHEMA_ONLY' ||
      JSON.stringify(scope.migrationIds) !== JSON.stringify(['d1-05-w11-analytics-schema-v1']) ||
      scope.migrationCount !== 1 || scope.tables !== 6 ||
      scope.explicitIndexes !== 8 || scope.triggers !== 0 ||
      scope.triggerFunctions !== 0 || scope.foreignKeys !== 0 ||
      scope.businessRows !== 0 || scope.controlSeedRows !== 0 ||
      scope.admittedSchemaSliceComplete !== true ||
      scope.runtimeDataIngestionEnabled !== false ||
      scope.runtimeBindingChangeAllowed !== false) {
    addError(errors, 'review scope must remain exactly the six-table D1-05 analytics schema-only migration')
  }
  const info = review.review ?? {}
  if (info.reviewer !== 'GPT-6' ||
      info.reviewType !== 'SCOPED_REMOTE_CODE_PATH_AUDIT_AND_CURRENT_MAIN_SOURCE_PIN_RECONCILIATION' ||
      !/^2026-11-[0-9]{2}$/.test(info.reviewedAt ?? '') ||
      info.reviewedMainSha !== info.implementationMergeSha ||
      info.result !== 'NO_BLOCKING_FINDINGS' ||
      info.formalGitHubReviewSubmissions !== 0) {
    addError(errors, 'D1-05 review provenance, result or formal-review limitations are incomplete')
  }
  if (!SHA40.test(info.reviewedMainSha ?? '') || !SHA40.test(info.implementationMergeSha ?? '')) {
    addError(errors, 'D1-05 review provenance SHA is malformed')
  }
  if (currentHead && (!SHA40.test(currentHead) || !isAncestor(info.reviewedMainSha, currentHead))) {
    addError(errors, 'reviewed D1-05 main commit is not an ancestor of the checked-out release commit')
  }
  if (!Array.isArray(info.findings) || info.findings.length !== 0) {
    addError(errors, 'D1-05 schema-only review contains unresolved findings')
  }
  if (!Array.isArray(info.limitations) ||
      !info.limitations.some((item) => /not a human GitHub APPROVE review/i.test(item)) ||
      !info.limitations.some((item) => /manual workflow_dispatch/i.test(item)) ||
      !info.limitations.some((item) => /runtime data ingestion remains blocked/i.test(item))) {
    addError(errors, 'D1-05 release review must disclose its scope and approval limitations')
  }
  const validation = review.verificationEvidence?.releaseValidation
  if (!Number.isSafeInteger(validation?.runId) ||
      validation?.conclusion !== 'success' ||
      !SHA40.test(validation?.headSha ?? '') ||
      validation?.validationScope !== 'D1_05_SCHEMA_ONLY_REMOTE_RUNNER_VALIDATION_NO_NEON_CREDENTIALS' ||
      typeof validation?.url !== 'string' || !RUN_URL.test(validation.url) ||
      validation?.remoteApplyJob !== 'skipped' ||
      !Number.isSafeInteger(validation?.artifactId) ||
      !/^sha256:[0-9a-f]{64}$/.test(validation?.artifactDigest ?? '')) {
    addError(errors, 'D1-05 current-main validation and sanitized PostgreSQL 18 artifact evidence is missing or mismatched')
  }
  const files = info.reviewedFiles
  if (!Array.isArray(files) || files.length < 20) {
    addError(errors, 'D1-05 review must pin the workflow, remote runner, release gate, shared runner and all W11 schema sources')
  } else {
    const seen = new Set()
    for (const item of files) {
      const path = item?.path
      if (typeof path !== 'string' || isAbsolute(path) ||
          path.includes('\\') || path.split('/').includes('..') ||
          !BLOB_SHA1.test(item?.gitBlobSha1 ?? '') || seen.has(path)) {
        addError(errors, 'D1-05 reviewed file pins contain an unsafe/duplicate path or malformed Git blob SHA')
        continue
      }
      seen.add(path)
      const absolute = resolve(root, path)
      if (!absolute.startsWith(resolve(root) + sep) || !existsSync(absolute)) {
        addError(errors, 'reviewed D1-05 source is absent from the checked-out tree: ' + path)
        continue
      }
      try {
        if (hashBlob(path) !== item.gitBlobSha1) {
          addError(errors, 'reviewed D1-05 source blob drift invalidates release: ' + path)
        }
        if (hashBlobAtCommit(validation.headSha, path) !== item.gitBlobSha1) {
          addError(errors, 'D1-05 CI validation source blob differs from the reviewed source: ' + path)
        }
      } catch (error) {
        addError(errors, 'cannot verify reviewed D1-05 source blob for ' + path + ': ' + error.message)
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
      review.runtimeDataIngestionEnabled !== false ||
      review.exactConfirmationRequired !== 'APPLY_REVIEWED_SCHEMA_D1_05_ALLLUCK_SCHEMA_ONLY') {
    addError(errors, 'D1-05 review does not preserve the isolated manual-only schema bootstrap boundary')
  }
  const blockers = review.runtimeAdmissionBlockers ?? []
  if (!blockers.some((item) => /retention/i.test(item)) ||
      !blockers.some((item) => /deletion/i.test(item)) ||
      !blockers.some((item) => /consent/i.test(item))) {
    addError(errors, 'D1-05 runtime privacy blockers must remain explicit after schema-only provisioning')
  }
  return { valid: errors.length === 0, errors, currentHead }
}
