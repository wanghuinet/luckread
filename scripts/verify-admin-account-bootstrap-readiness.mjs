import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath))
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
const w02Index = read('workers/W02-identity/src/index.ts')
const reconciliation = read('contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md')
const w02SourceFiles = walk('workers/W02-identity/src')
const w02Production = w02SourceFiles
  .filter((file) => !file.endsWith('.test.ts'))
  .map(read)
  .join('\n')
const w02Tests = w02SourceFiles
  .filter((file) => file.endsWith('.test.ts'))
  .map(read)
  .join('\n')

// Only W02's authoritative identity/RoleAssignment code can prove bootstrap
// readiness. A similarly named helper or test in W08 cannot satisfy this gate.
const bootstrapModulePath = 'workers/W02-identity/src/authz/l8-super-admin-bootstrap.ts'
const bootstrapTestPath = 'workers/W02-identity/src/authz/l8-super-admin-bootstrap.test.ts'
const hasBootstrapModule = exists(bootstrapModulePath)
const hasBootstrapTest = exists(bootstrapTestPath)
const bootstrapModule = hasBootstrapModule ? read(bootstrapModulePath) : ''
const bootstrapTest = hasBootstrapTest ? read(bootstrapTestPath) : ''

const blockers = []
const assertReadOnlyWorkflow = !/wrangler\s+d1\s+execute|--remote|CLOUDFLARE_API_TOKEN|LUCKREAD_ADMIN_BOOTSTRAP_PASSWORD|secrets\./i.test(workflow)
if (!assertReadOnlyWorkflow) {
  blockers.push('The workflow contains a production database command or privileged secret reference.')
}

const hasDedicatedW02L8Bootstrap =
  /\/internal\/authz\/bootstrap-super-admin/.test(w02Index) &&
  /bootstrapSuperAdmin/.test(w02Index) &&
  hasBootstrapModule &&
  /bootstrapSuperAdmin/.test(bootstrapModule) &&
  /super_admin/.test(bootstrapModule) &&
  /scopeType|scope_type/.test(bootstrapModule) &&
  /L8/.test(bootstrapModule)
if (!hasDedicatedW02L8Bootstrap) {
  blockers.push('W02 is missing the dedicated POST /internal/authz/bootstrap-super-admin implementation for a canonical global L8 super_admin grant.')
}

const hasMfaEnforcement =
  hasBootstrapModule &&
  hasBootstrapTest &&
  /requireMfaForPrivilegedAction|verifyMfaStepUp/.test(bootstrapModule) &&
  /MFA_REQUIRED|MFA_STEP_UP_REQUIRED/.test(bootstrapModule) &&
  /MFA_REQUIRED|MFA_STEP_UP_REQUIRED/.test(bootstrapTest) &&
  /rejects|toThrow|toMatchObject/.test(bootstrapTest)
if (!hasMfaEnforcement || /Status:\s*`BLOCKED_NOT_GREEN`/.test(reconciliation)) {
  blockers.push('L8 bootstrap is not proven to require server-verified MFA step-up with executable negative-test evidence; AUTH-007 also remains BLOCKED_NOT_GREEN.')
}

const hasTargetBoundDualApproval =
  hasBootstrapModule &&
  hasBootstrapTest &&
  /validateL8DualApproval/.test(bootstrapModule) &&
  /distinctApproverIds/.test(bootstrapModule) &&
  /targetUserId|subjectId/.test(bootstrapModule) &&
  /approvalRef/.test(bootstrapModule) &&
  /validateL8DualApproval/.test(bootstrapTest) &&
  /DUPLICATE_APPROVER|DISTINCT_APPROVER_REQUIRED/.test(bootstrapTest) &&
  /TARGET_BINDING_MISMATCH|APPROVAL_TARGET_MISMATCH/.test(bootstrapTest) &&
  /rejects|toThrow|toMatchObject/.test(bootstrapTest)
if (!hasTargetBoundDualApproval) {
  blockers.push('W02 lacks target-bound dual-approval verification and negative tests for duplicate approvers and mismatched targets.')
}

const hasOneTimeAndBoundedGrant =
  hasBootstrapModule &&
  hasBootstrapTest &&
  /BOOTSTRAP_ALREADY_USED|ALREADY_BOOTSTRAPPED/.test(bootstrapModule) &&
  /validUntil/.test(bootstrapModule) &&
  /4\s*\*\s*60\s*\*\s*60|14400000/.test(bootstrapModule) &&
  /BOOTSTRAP_ALREADY_USED|ALREADY_BOOTSTRAPPED/.test(bootstrapTest) &&
  /validUntil/.test(bootstrapTest) &&
  /rejects|toThrow|toMatchObject/.test(bootstrapTest)
if (!hasOneTimeAndBoundedGrant) {
  blockers.push('W02 lacks evidence for atomic one-time bootstrap enforcement and the contract maximum four-hour L8 assignment lifetime.')
}

const hasFocusedTestCoverage = hasBootstrapTest &&
  /ACTIVE|accountState/.test(bootstrapTest) &&
  /super_admin/.test(bootstrapTest) &&
  /replay|REPLAY|idempotent/i.test(bootstrapTest) &&
  /expect\(/.test(bootstrapTest)
if (!hasFocusedTestCoverage) {
  blockers.push('The dedicated W02 bootstrap test suite is missing target account-state, L8 role, and replay/one-time assertions.')
}

const report = {
  status: blockers.length === 0 ? 'READY_FOR_SEPARATE_REVIEW' : 'BLOCKED_NOT_GREEN',
  productionMutationPerformed: false,
  checks: {
    workflowIsReadOnly: assertReadOnlyWorkflow,
    dedicatedW02L8Bootstrap,
    mfaCodeAndTestEvidence: hasMfaEnforcement && !/Status:\s*`BLOCKED_NOT_GREEN`/.test(reconciliation),
    targetBoundDualApprovalCodeAndTestEvidence: hasTargetBoundDualApproval,
    oneTimeAndFourHourGrant: hasOneTimeAndBoundedGrant,
    focusedW02BootstrapTests: hasFocusedTestCoverage,
  },
  blockers,
}
console.log(JSON.stringify(report, null, 2))
if (blockers.length > 0) process.exitCode = 1
