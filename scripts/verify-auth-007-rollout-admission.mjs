import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const repository = 'wanghuinet/luckread'
const environmentName = 'auth-mfa-rollout'
const expectedReviewerId = 190754094

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath))
const blockers = []
const staticOnly = process.argv.includes('--static-only')
const readOnlyConfigPreflight = process.argv.includes('--read-only-config-preflight')

function requireSource(condition, message) {
  if (!condition) blockers.push(message)
}

async function githubGet(apiPath, token) {
  const response = await fetch('https://api.github.com' + apiPath, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'LuckRead-AUTH-007-Rollout-Admission',
    },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('GitHub rollout approval configuration could not be verified (HTTP ' + response.status + ')')
  }
  return response.json()
}

async function verifyProtectedEnvironment({ requireDistinctActor = true } = {}) {
  const token = process.env.GITHUB_TOKEN ?? ''
  const repo = process.env.GITHUB_REPOSITORY ?? ''
  const actor = (process.env.GITHUB_ACTOR ?? '').toLowerCase()
  const ref = process.env.GITHUB_REF ?? ''
  const eventName = process.env.GITHUB_EVENT_NAME ?? ''
  const configuredEnvironment = process.env.AUTH007_ROLLOUT_ENVIRONMENT ?? ''
  const sourceSha = process.env.SOURCE_SHA ?? ''
  const currentSha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
  const sourceExists = /^[a-f0-9]{40}$/i.test(sourceSha) &&
    spawnSync('git', ['cat-file', '-e', sourceSha + '^{commit}']).status === 0
  const sourceIsMainAncestor = sourceExists &&
    spawnSync('git', ['merge-base', '--is-ancestor', sourceSha, 'origin/main']).status === 0

  if (
    token.length < 20 ||
    repo.toLowerCase() !== repository ||
    !actor ||
    ref !== 'refs/heads/main' ||
    eventName !== 'workflow_dispatch' ||
    configuredEnvironment !== environmentName ||
    !sourceExists ||
    !sourceIsMainAncestor ||
    currentSha.status !== 0 ||
    currentSha.stdout.trim().toLowerCase() !== sourceSha.toLowerCase()
  ) {
    throw new Error('Rollout must use an immutable source SHA already committed to protected main and be explicitly dispatched there')
  }

  const environment = await githubGet('/repos/' + repository + '/environments/' + environmentName, token)
  const rules = (environment.protection_rules ?? []).filter((rule) => rule.type === 'required_reviewers')
  const reviewers = rules[0]?.reviewers ?? []
  const configuredReviewer = reviewers[0]
  const reviewerLogin = configuredReviewer?.reviewer?.login?.toLowerCase()

  if (
    environment.name !== environmentName ||
    environment.can_admins_bypass !== false ||
    rules.length !== 1 ||
    reviewers.length !== 1 ||
    rules[0]?.prevent_self_review !== true ||
    environment.deployment_branch_policy?.protected_branches !== true ||
    environment.deployment_branch_policy?.custom_branch_policies !== false ||
    configuredReviewer?.type !== 'User' ||
    !reviewerLogin ||
    configuredReviewer?.reviewer?.id !== expectedReviewerId ||
    (requireDistinctActor && reviewerLogin === actor)
  ) {
    throw new Error('AUTH-007 rollout environment must disable admin bypass, require the designated human maintainer, forbid self-review, and allow protected branches only')
  }

  const permission = await githubGet(
    '/repos/' + repository + '/collaborators/' + encodeURIComponent(reviewerLogin) + '/permission',
    token,
  )
  const permissionValue = String(permission.permission ?? '').toLowerCase()
  const roleName = String(permission.role_name ?? '').toLowerCase()
  if (
    permissionValue !== 'admin' &&
    roleName !== 'admin' &&
    roleName !== 'maintain'
  ) {
    throw new Error('AUTH-007 rollout reviewer must have repository admin or maintain permission')
  }

  return {
    environment: environmentName,
    reviewer: reviewerLogin,
    reviewerRole: permissionValue === 'admin' || roleName === 'admin' ? 'admin' : roleName,
    selfReviewPrevented: true,
    protectedBranchesOnly: true,
    initiatorDiffersFromReviewer: reviewerLogin !== actor,
  }
}

const mfaMigrationPath = 'workers/W02-identity/migrations/0006_better_auth_two_factor.sql'
const bootstrapMigrationPath = 'workers/W02-identity/migrations/0007_l8_genesis_bootstrap_audit.sql'
const mfaAuditOutboxMigrationPath = 'workers/W02-identity/migrations/0008_auth_007_mfa_publication_journal.sql'
const mfaAuditBindingPath = 'contracts/events/AUTH-007-mfa-audit-binding.v1.json'
const mfaAuditOutboxContractPath = 'contracts/migration/AUTH-007-mfa-publication-journal.v1.json'
const logicalDataAuthorityPath = 'contracts/transport/logical-data-authority.v1.json'
const authContractPath = 'contracts/api/AUTH-007-mfa-totp-contract.v1.json'
const factorContractPath = 'contracts/entity/AUTH-007-mfa-factor-field-contract.v1.json'
const lifecyclePath = 'contracts/state-machines/AUTH-007-mfa-lifecycle.v1.json'
const reconciliationPath = 'contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md'
const betterAuthPath = 'workers/W02-identity/src/auth/better-auth.ts'
const replayGuardPath = 'workers/W02-identity/src/auth/totp-replay-guard.ts'
const policyPath = 'contracts/api/auth-operation-policy.v1.json'

for (const file of [
  mfaMigrationPath,
  bootstrapMigrationPath,
  mfaAuditOutboxMigrationPath,
  mfaAuditBindingPath,
  mfaAuditOutboxContractPath,
  logicalDataAuthorityPath,
  authContractPath,
  factorContractPath,
  lifecyclePath,
  reconciliationPath,
  betterAuthPath,
  replayGuardPath,
  policyPath,
  '.github/workflows/auth-mfa-rollout-preflight.yml',
]) {
  requireSource(exists(file), 'Required reviewed rollout artifact is missing: ' + file)
}

const legacyConflictingMigration = 'workers/W02-identity/migrations/0006_auth_mfa_two_factor.sql'
requireSource(
  !exists(legacyConflictingMigration),
  'Conflicting second MFA migration exists; select one canonical D1-01 schema before rollout.',
)

let sourceChecks = {}
let auth007Status = null
let implementationAuthorization = null

if (blockers.length === 0) {
  const migration = read(mfaMigrationPath)
  const bootstrapMigration = read(bootstrapMigrationPath)
  const mfaAuditOutboxMigration = read(mfaAuditOutboxMigrationPath)
  const mfaAuditBinding = JSON.parse(read(mfaAuditBindingPath))
  const mfaAuditOutboxContract = JSON.parse(read(mfaAuditOutboxContractPath))
  const logicalDataAuthority = JSON.parse(read(logicalDataAuthorityPath))
  const betterAuth = read(betterAuthPath)
  const replayGuard = read(replayGuardPath)
  const apiContract = JSON.parse(read(authContractPath))
  const factorContract = JSON.parse(read(factorContractPath))
  const lifecycle = JSON.parse(read(lifecyclePath))
  const policy = JSON.parse(read(policyPath))
  const reconciliation = read(reconciliationPath)
  // Resolve gate status before computing sourceEvidenceChecks below.
  auth007Status = reconciliation.match(/^- Status:\s*`([^`]+)`/m)?.[1] ?? null
  implementationAuthorization = reconciliation.match(/^- Implementation authorization:\s*`([^`]+)`/m)?.[1] ?? null
  const standaloneW01Workflow = read('.github/workflows/w01-payload-app-deploy.yml')
  const readOnlyPreflightWorkflow = read('.github/workflows/auth-mfa-rollout-preflight.yml')

  const requiredMigrationTokens = [
    'two_factor_enabled',
    'mfa_enrolled_at',
    'CREATE TABLE "twoFactor"',
    'lastAcceptedTotpTimeStep',
    'user_mfa_enable_revoke_sessions',
    'user_mfa_disable_clear_enrollment',
  ]
  const requiredBootstrapTokens = [
    "bootstrap_key = 'first-l8'",
    'nonce_sha256',
    'request_merge_sha',
    'approved_reviewers_json',
    'workflow_run_id',
  ]
  const requiredMfaAuditOutboxTokens = [
    'CREATE TABLE auth_007_mfa_publication_journal',
    'event_id TEXT NOT NULL UNIQUE',
    'idempotency_key TEXT NOT NULL UNIQUE',
    "CHECK (schema_version = '1.0')",
    'json_valid(payload)',
    'auth.mfa.enrollment_started',
    'auth_007_mfa_publication_journal_status_next_attempt_idx',
  ]
  const operations = [
    { id: 'authMfaStatus', route: 'workers/W01-payload/src/app/api/v1/auth/mfa/route.ts', test: 'workers/W01-payload/tests/int/mfa-status-route.int.spec.ts' },
    { id: 'authMfaEnrollmentStart', route: 'workers/W01-payload/src/app/api/v1/auth/mfa/enrollment/route.ts', test: 'workers/W01-payload/tests/int/mfa-enrollment-start-route.int.spec.ts' },
    { id: 'authMfaEnrollmentConfirm', route: 'workers/W01-payload/src/app/api/v1/auth/mfa/enrollment/confirm/route.ts', test: 'workers/W01-payload/tests/int/mfa-enrollment-confirm-route.int.spec.ts' },
    { id: 'authMfaChallengeVerify', route: 'workers/W01-payload/src/app/api/v1/auth/mfa/challenge/verify/route.ts', test: 'workers/W01-payload/tests/int/mfa-challenge-verify-route.int.spec.ts' },
    { id: 'authMfaDisable', route: 'workers/W01-payload/src/app/api/v1/auth/mfa/disable/route.ts', test: 'workers/W01-payload/tests/int/mfa-factor-management-route.int.spec.ts' },
    { id: 'authMfaRecoveryCodesRotate', route: 'workers/W01-payload/src/app/api/v1/auth/mfa/recovery-codes/rotate/route.ts', test: 'workers/W01-payload/tests/int/mfa-factor-management-route.int.spec.ts' },
  ]
  const policyIds = new Set((policy.operations ?? []).map((operation) => operation.operationId))
  const canonicalOperationIds = new Set((apiContract.operations ?? []).map((operation) => operation.operationId))

  const sourceEvidenceChecks = {
    apiListsAllSixOperations: apiContract.evidenceStatus?.api?.includes('all six canonical operationIds') === true,
    apiNoLongerClaimsRoutesMissing: !apiContract.evidenceStatus?.api?.includes('other five operations lack runtime adapters'),
    runtimeDescriptionAccurate:
      (apiContract.evidenceStatus?.runtime?.startsWith('SOURCE_IMPLEMENTED_TESTED_LOCALLY;') === true ||
       ['PASS', 'VERIFIED'].includes(apiContract.evidenceStatus?.runtime)),
    apiSecurityAndMappingStatusesAllowed:
      ['MISSING', 'PASS', 'VERIFIED'].includes(apiContract.evidenceStatus?.securityE2E) &&
      ['MISSING', 'PASS', 'VERIFIED'].includes(apiContract.evidenceStatus?.mapping0),
    auth007StatusIsRecognized: ['BLOCKED_NOT_GREEN', 'GREEN'].includes(auth007Status),
    contractStatusesMatchReconciliation:
      apiContract.evidenceStatus?.auth007 === auth007Status &&
      factorContract.evidenceStatus?.auth007 === auth007Status,
    implementationAuthorizationMatchesStatus:
      auth007Status === 'GREEN'
        ? implementationAuthorization === 'true'
        : implementationAuthorization !== 'true',
    greenRequiresAllProductionEvidence: auth007Status !== 'GREEN' || (
      ['PASS', 'VERIFIED'].includes(apiContract.evidenceStatus?.securityE2E) &&
      ['PASS', 'VERIFIED'].includes(apiContract.evidenceStatus?.mapping0) &&
      ['PASS', 'VERIFIED'].includes(apiContract.evidenceStatus?.persistence) &&
      ['PASS', 'VERIFIED'].includes(factorContract.evidenceStatus?.totpReplayProtection) &&
      ['PASS', 'VERIFIED'].includes(factorContract.evidenceStatus?.runtime) &&
      ['PASS', 'VERIFIED'].includes(factorContract.evidenceStatus?.securityE2E) &&
      ['PASS', 'VERIFIED'].includes(factorContract.evidenceStatus?.evidenceRegistry) &&
      ['VERIFIED', 'GREEN'].includes(factorContract.status) &&
      ['PASS', 'VERIFIED'].includes(factorContract.evidenceStatus?.entity) &&
      ['PASS', 'VERIFIED'].includes(factorContract.evidenceStatus?.apiDto)
    ),
    factorMissingEvidenceStatusesAllowed:
      ['MISSING', 'PASS', 'VERIFIED'].includes(factorContract.evidenceStatus?.securityE2E) &&
      ['MISSING', 'PASS', 'VERIFIED'].includes(factorContract.evidenceStatus?.evidenceRegistry),
    noStaleReplayInvariant:
      !factorContract.securityInvariants.some((invariant) =>
        invariant.includes('current migration 0006 does not provide this field')),
  }

  sourceChecks = {
    reviewedMfaMigrationShape: requiredMigrationTokens.every((token) => migration.includes(token)),
    reviewedBootstrapAuditShape: requiredBootstrapTokens.every((token) => bootstrapMigration.includes(token)),
    reviewedMfaAuditOutboxMigrationShape: requiredMfaAuditOutboxTokens.every((token) => mfaAuditOutboxMigration.includes(token)),
    mfaAuditOutboxContractMatchesMigration:
      mfaAuditOutboxContract.target?.physicalTable === 'auth_007_mfa_publication_journal' &&
      mfaAuditOutboxContract.target?.sourceMigration === mfaAuditOutboxMigrationPath &&
      mfaAuditOutboxContract.target?.databaseBinding === 'workers/W02-identity/wrangler.jsonc:D1_01' &&
      mfaAuditOutboxContract.promotion === 'NOT_GREEN',
    mfaAuditBindingUsesExistingQueueWithoutProductionClaim:
      mfaAuditBinding.delivery?.existingW02ToW06Binding === 'AUTH013_QUEUE' &&
      mfaAuditBinding.delivery?.existingQueueName === 'luckread-auth013-account-state' &&
      mfaAuditBinding.delivery?.newWorkerD1QueueOrServiceBindingAllowed === false &&
      mfaAuditBinding.delivery?.sourceImplementationStatus === 'IMPLEMENTED_IN_SOURCE_NOT_PRODUCTION_VERIFIED',
    mfaOutboxTableIsW02OwnedAndCrossWorkerReadRestricted:
      ['auth_013_publication_journal', 'auth_007_mfa_publication_journal'].every((tableName) =>
        (logicalDataAuthority.tables ?? []).some((table) =>
          table.name === tableName &&
          table.ownerWorker === 'W02' &&
          table.readPolicy === 'OWNER_ONLY_WITH_EXCEPTIONS' &&
          Array.isArray(table.readExceptions) &&
          table.readExceptions.length === 0
        )
      ),
    mfaAuditProducerCoverageRemainsExplicit:
      JSON.stringify(mfaAuditBinding.runtimeEmissionCoverage?.implementedInW02Source) ===
        JSON.stringify([
          'auth.mfa.enrollment_started',
          'auth.mfa.enrollment_verified',
          'auth.mfa.enrollment_failed',
          'auth.mfa.challenge_succeeded',
          'auth.mfa.challenge_failed',
          'auth.mfa.factor_disabled',
          'auth.mfa.recovery_codes_rotated',
          'auth.mfa.recovery_code_consumed',
          'auth.mfa.locked',
          'auth.mfa.replay_rejected',
        ]) &&
      Array.isArray(mfaAuditBinding.runtimeEmissionCoverage?.notYetEmittedByW02) &&
      mfaAuditBinding.runtimeEmissionCoverage.notYetEmittedByW02.length === 0 &&
      mfaAuditBinding.runtimeEmissionCoverage.consumerSupportsAllRegisteredEvents === true,
    mfaAuditLifecycleProducerHooksWired:
      /after:\s*createAuthMiddleware/.test(betterAuth) &&
      /classifyMfaAuditHookOutcome/.test(betterAuth) &&
      /recordMfaAuditEventOnce/.test(betterAuth) &&
      /auth\.mfa\.replay_rejected/.test(betterAuth),
    mfaAuditSourceAndTestsPresent:
      exists('workers/W02-identity/src/auth/mfa-audit-events.ts') &&
      exists('workers/W02-identity/src/auth/mfa-audit-events.test.ts') &&
      exists('workers/W02-identity/src/auth/mfa-audit-hooks.ts') &&
      exists('workers/W02-identity/src/auth/mfa-audit-hooks.test.ts') &&
      exists('workers/W02-identity/src/auth/mfa-audit-publication-journal.ts') &&
      exists('workers/W02-identity/src/auth/mfa-audit-publication-journal.test.ts') &&
      exists('scripts/auth-007-mfa-journal-migration-static-audit.mjs') &&
      exists('workers/W06-governance/src/mfa-audit-queue-consumer.ts') &&
      exists('workers/W06-governance/src/mfa-audit-queue-consumer.test.ts'),
    encryptedRecoveryCodes: /backupCodeOptions:\s*\{[^}]*storeBackupCodes:\s*['"]encrypted['"]/.test(betterAuth),
    privilegedTrustDeviceDisabled: /trustDeviceMaxAge:\s*0/.test(betterAuth),
    persistedTotpReplayGuard: /consumeTotpTimeStep/.test(betterAuth) &&
      /two-factor\/verify-totp/.test(betterAuth) &&
      /UPDATE "twoFactor" SET lastAcceptedTotpTimeStep/.test(replayGuard),
    canonicalContractsDeclareExplicitStatus: ['CONTRACTED_NOT_VERIFIED', 'VERIFIED', 'GREEN'].includes(apiContract.status) &&
      ['CONTRACTED_NOT_VERIFIED', 'VERIFIED', 'GREEN'].includes(factorContract.status) &&
      ['CONTRACTED_NOT_VERIFIED', 'VERIFIED', 'GREEN'].includes(lifecycle.status),
    sourceEvidenceIsAccurateAndPromotionConsistent: Object.values(sourceEvidenceChecks).every((passed) => passed === true),
    ...Object.fromEntries(Object.entries(sourceEvidenceChecks).map(([key, passed]) => ['evidence_' + key, passed])),
    allSixPublicRoutesAndTestsPresent: operations.every((operation) =>
      exists(operation.route) &&
      exists(operation.test) &&
      policyIds.has(operation.id) &&
      canonicalOperationIds.has(operation.id)
    ),
    w02ReplayAndEnrollmentTestsPresent: [
      'workers/W02-identity/src/auth/mfa-status.test.ts',
      'workers/W02-identity/src/auth/mfa-enrollment-start.test.ts',
      'workers/W02-identity/src/auth/mfa-enrollment-confirm.test.ts',
      'workers/W02-identity/src/auth/totp-replay-guard.test.ts',
      'workers/W02-identity/src/auth/mfa-lifecycle-contract.test.ts',
    ].every(exists),
    finalGenesisGateRequiresExplicitGreenPromotion: exists('scripts/verify-admin-account-bootstrap-readiness.mjs') &&
      /auth007Status === 'GREEN'/.test(read('scripts/verify-admin-account-bootstrap-readiness.mjs')) &&
      /implementationAuthorization === 'true'/.test(read('scripts/verify-admin-account-bootstrap-readiness.mjs')) &&
      /!auth007PromotionVerified/.test(read('scripts/verify-admin-account-bootstrap-readiness.mjs')) &&
      /AUTH-007 must be GREEN with implementation authorization true/.test(read('scripts/verify-admin-account-bootstrap-readiness.mjs')),
    rolloutEnvironmentDisablesAdminBypass: read('scripts/verify-auth-007-rollout-admission.mjs').includes('environment.can_admins_bypass !== false'),
    l8EnvironmentDisablesAdminBypass: read('workers/W02-identity/src/authz/l8-genesis-bootstrap-approval.ts').includes('environment.can_admins_bypass !== false') &&
      /can_admins_bypass: true/.test(read('workers/W02-identity/src/authz/l8-genesis-bootstrap-approval.test.ts')) &&
      /rejects environments that permit administrator bypass of protection rules/.test(read('workers/W02-identity/src/authz/l8-genesis-bootstrap-approval.test.ts')),
    standaloneW01DeployUsesProtectedAdmission:
      /environment:\s*auth-mfa-rollout/.test(standaloneW01Workflow) &&
      /github\.ref == 'refs\/heads\/main'/.test(standaloneW01Workflow) &&
      /merge-base --is-ancestor/.test(standaloneW01Workflow) &&
      /verify-auth-007-rollout-admission\.mjs/.test(standaloneW01Workflow) &&
      standaloneW01Workflow.indexOf('verify-auth-007-rollout-admission.mjs') >= 0 &&
      standaloneW01Workflow.indexOf('verify-auth-007-rollout-admission.mjs') < standaloneW01Workflow.indexOf('run: pnpm run deploy:app'),
    readOnlyEnvironmentPreflightCannotMutateProduction:
      /workflow_dispatch:/.test(readOnlyPreflightWorkflow) &&
      /github\.ref == 'refs\/heads\/main'/.test(readOnlyPreflightWorkflow) &&
      /--read-only-config-preflight/.test(readOnlyPreflightWorkflow) &&
      /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/.test(readOnlyPreflightWorkflow) &&
      !/environment:\s*auth-mfa-rollout/.test(readOnlyPreflightWorkflow) &&
      !/wrangler\s+d1\s+(?:migrations\s+apply|execute)|CLOUDFLARE_API_TOKEN|wrangler[^\n]*\bdeploy\b/i.test(readOnlyPreflightWorkflow),
  }

  for (const [check, passed] of Object.entries(sourceChecks)) {
    if (!passed) blockers.push('AUTH-007 rollout source check failed: ' + check)
  }

  auth007Status = reconciliation.match(/^- Status:\s*`([^`]+)`/m)?.[1] ?? null
  implementationAuthorization = reconciliation.match(/^- Implementation authorization:\s*`([^`]+)`/m)?.[1] ?? null
}

let protectedEnvironment = null
if (blockers.length === 0 && !staticOnly) {
  try {
    protectedEnvironment = await verifyProtectedEnvironment({ requireDistinctActor: !readOnlyConfigPreflight })
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : 'Protected rollout environment could not be verified')
  }
}

const report = {
  status: blockers.length > 0 ? 'BLOCKED_NOT_GREEN' : staticOnly ? 'STATIC_ROLLOUT_SOURCE_READY' : readOnlyConfigPreflight ? 'READ_ONLY_ENVIRONMENT_PREFLIGHT_COMPLETE' : 'ROLLOUT_ADMISSION_READY_NOT_FINAL_GREEN',
  gateMode: staticOnly ? 'STATIC_ONLY_NO_PRODUCTION_AUTHORIZATION' : readOnlyConfigPreflight ? 'READ_ONLY_ENVIRONMENT_CONFIGURATION_PREFLIGHT' : 'PROTECTED_MANUAL_ROLLOUT',
  rolloutEnvironment: protectedEnvironment,
  sourceChecks,
  finalAuth007Status: auth007Status,
  implementationAuthorization,
  finalAuth007PromotionAllowed: false,
  l8GenesisGrantAllowed: false,
  productionMutationPerformed: false,
  blockers,
}
console.log(JSON.stringify(report, null, 2))
if (blockers.length > 0) process.exitCode = 1
