import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const walk = (directory) => {
  const absolute = path.join(root, directory)
  if (!fs.existsSync(absolute)) return []
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) return walk(relative)
    return entry.isFile() && entry.name.endsWith('.ts') ? [relative] : []
  })
}

const workflowPath = '.github/workflows/admin-account-bootstrap.yml'
const workflow = read(workflowPath)
const genesisWorkflow = read('.github/workflows/l8-genesis-bootstrap.yml')
const w02Index = read('workers/W02-identity/src/index.ts')
const reconciliation = read('contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md')
const w02SourceFiles = walk('workers/W02-identity/src')
const w08SourceFiles = walk('workers/W08-creator/src')
const sourceFiles = [...w02SourceFiles, ...w08SourceFiles]
const w02ProductionCode = w02SourceFiles
  .filter((file) => !file.endsWith('.test.ts'))
  .map(read)
  .join('\n')
const w02TestCode = w02SourceFiles
  .filter((file) => file.endsWith('.test.ts'))
  .map(read)
  .join('\n')
const productionCode = sourceFiles
  .filter((file) => !file.endsWith('.test.ts'))
  .map(read)
  .join('\n')
const testCode = sourceFiles
  .filter((file) => file.endsWith('.test.ts'))
  .map(read)
  .join('\n')

const blockers = []
const assertReadOnlyWorkflow = !/wrangler\s+d1\s+execute|--remote|CLOUDFLARE_API_TOKEN|LUCKREAD_ADMIN_BOOTSTRAP_PASSWORD|secrets\./i.test(workflow + '\n' + genesisWorkflow)
if (!assertReadOnlyWorkflow) {
  blockers.push('A bootstrap workflow contains a direct production database command or privileged secret reference.')
}
const hasProtectedSingleApprovalWorkflow =
  /environment:\s*l8-genesis-bootstrap/.test(genesisWorkflow) &&
  /run-name:.*request_pr_number/.test(genesisWorkflow) &&
  /verify-admin-account-bootstrap-readiness\.mjs/.test(genesisWorkflow)
if (!hasProtectedSingleApprovalWorkflow) {
  blockers.push('The genesis workflow lacks a target-labelled, protected environment approval or the AUTH-007 evidence gate.')
}

const hasDedicatedW02L8Bootstrap =
  /\/internal\/authz\/bootstrap-super-admin/.test(w02Index) &&
  /bootstrapSuperAdmin|grantSuperAdminBootstrap/.test(productionCode)
if (!hasDedicatedW02L8Bootstrap) {
  blockers.push('W02 has no dedicated, auditable one-time L8 super_admin bootstrap command.')
}

const hasMfaEnforcement =
  /requireMfaForPrivilegedAction/.test(productionCode) &&
  /requireMfaForPrivilegedAction/.test(testCode) &&
  /two_factor_enabled/.test(productionCode) &&
  /twoFactor\.verified|totpVerified/.test(productionCode) &&
  /mfa_enrolled_at|mfaEnrolledAt/.test(productionCode) &&
  /twoFactor\.verified|TOTP is not verified/.test(testCode) &&
  /trustDeviceMaxAge:\s*0/.test(read('workers/W02-identity/src/auth/better-auth.ts'))
const betterAuthConfig = read('workers/W02-identity/src/auth/better-auth.ts')
const hasEncryptedRecoveryCodes =
  /backupCodeOptions:\s*\{[^}]*storeBackupCodes:\s*['"]encrypted['"]/.test(betterAuthConfig)
if (!hasEncryptedRecoveryCodes) {
  blockers.push('AUTH-007 recovery codes must use Better Auth encrypted-at-rest storage.')
}

if (!hasMfaEnforcement || /Status:\s*`BLOCKED_NOT_GREEN`/.test(reconciliation)) {
  blockers.push('AUTH-007 MFA enforcement and executable test evidence are missing or still blocked.')
}

// Require a single, explicitly configured GitHub Environment reviewer, validated
// by W02 from the GitHub API, rather than accepting a user-supplied approval flag.
const hasTargetBoundSingleApproval =
  /\/internal\/authz\/bootstrap-super-admin/.test(w02Index) &&
  /bootstrapSuperAdmin|grantSuperAdminBootstrap/.test(w02ProductionCode) &&
  /verifyTargetBoundSingleApproval/.test(w02ProductionCode) &&
  /SINGLE_APPROVAL_ENVIRONMENT_NOT_CONFIGURED/.test(w02ProductionCode) &&
  /bootstrapSuperAdmin|grantSuperAdminBootstrap/.test(w02TestCode) &&
  /verifyTargetBoundSingleApproval/.test(w02TestCode)
if (!hasTargetBoundSingleApproval) {
  blockers.push('W02 bootstrap write path lacks target-bound single-environment-approval enforcement with matching W02 tests.')
}

const hasNoSelfApprovalPolicy =
  /prevent_self_review !== true/.test(w02ProductionCode) &&
  /prevent_self_review: false/.test(w02TestCode) &&
  /rejects a single-reviewer environment when self-review is permitted/.test(w02TestCode)
if (!hasNoSelfApprovalPolicy) {
  blockers.push('L8 genesis approval must prohibit initiator self-review and include a negative test.')
}

const hasVerifiedMfaBeforeGenesisGrant =
  /MFA_REQUIRED/.test(w02ProductionCode) &&
  w02ProductionCode.includes('LEFT JOIN "twoFactor"') &&
  /target MFA is not enrolled and verified/.test(w02TestCode) &&
  /blocks when target MFA has not been enabled and verified/.test(w02TestCode)
if (!hasVerifiedMfaBeforeGenesisGrant) {
  blockers.push('The L8 bootstrap readiness and write paths must both require pre-enrolled, verified MFA and have negative tests.')
}

const replayGuardSource = read('workers/W02-identity/src/auth/totp-replay-guard.ts')
const hasTotpReplayProtection =
  /lastAcceptedTotpTimeStep/.test(read('workers/W02-identity/migrations/0006_better_auth_two_factor.sql')) &&
  /two-factor\/verify-totp/.test(read('workers/W02-identity/src/auth/better-auth.ts')) &&
  /consumeTotpTimeStep/.test(read('workers/W02-identity/src/auth/better-auth.ts')) &&
  /UPDATE "twoFactor" SET lastAcceptedTotpTimeStep/.test(replayGuardSource) &&
  /atomically consumes a step once and rejects replay/.test(w02TestCode)
if (!hasTotpReplayProtection) {
  blockers.push('AUTH-007 requires a persisted atomic TOTP time-step replay guard, wired to Better Auth verification and covered by tests.')
}

const hasReadOnlyProductionPreflight =
  /\/internal\/authz\/bootstrap-super-admin\/readiness/.test(w02Index) &&
  /\/api\/v1\/admin\/bootstrap\/super-admin\/readiness/.test(read('workers/W01-payload/src/app/api/v1/admin/bootstrap/super-admin/readiness/route.ts')) &&
  /READ_ONLY_PREFLIGHT/.test(read('scripts/execute-l8-genesis-bootstrap.mjs')) &&
  /READY_FOR_BOOTSTRAP/.test(read('scripts/execute-l8-genesis-bootstrap.mjs'))
if (!hasReadOnlyProductionPreflight) {
  blockers.push('A protected W01/W02 read-only production preflight is missing from the execution workflow.')
}

const report = {
  status: blockers.length === 0 ? 'READY_FOR_CONTROLLED_EXECUTION' : 'BLOCKED_NOT_GREEN',
  productionMutationPerformed: false,
  checks: {
    workflowIsReadOnly: assertReadOnlyWorkflow,
    dedicatedW02L8Bootstrap: hasDedicatedW02L8Bootstrap,
    mfaCodeAndTestEvidence: hasMfaEnforcement && !/Status:\s*`BLOCKED_NOT_GREEN`/.test(reconciliation),
    recoveryCodesEncryptedAtRest: hasEncryptedRecoveryCodes,
    totpReplayProtection: hasTotpReplayProtection,
    w02BootstrapApprovalCodeAndTestEvidence: hasTargetBoundSingleApproval,
    noSelfApprovalPolicy: hasNoSelfApprovalPolicy,
    targetMfaRequiredBeforeGrant: hasVerifiedMfaBeforeGenesisGrant,
    readOnlyProductionPreflight: hasReadOnlyProductionPreflight,
  },
  blockers,
}
console.log(JSON.stringify(report, null, 2))
if (blockers.length > 0) process.exitCode = 1
