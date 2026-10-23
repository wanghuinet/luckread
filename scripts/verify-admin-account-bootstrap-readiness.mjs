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
const w02Index = read('workers/W02-identity/src/index.ts')
const reconciliation = read('contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md')
const sourceFiles = [
  ...walk('workers/W02-identity/src'),
  ...walk('workers/W08-creator/src'),
]
const productionCode = sourceFiles
  .filter((file) => !file.endsWith('.test.ts'))
  .map(read)
  .join('\n')
const testCode = sourceFiles
  .filter((file) => file.endsWith('.test.ts'))
  .map(read)
  .join('\n')

const blockers = []
const assertReadOnlyWorkflow = !/wrangler\s+d1\s+execute|--remote|CLOUDFLARE_API_TOKEN|LUCKREAD_ADMIN_BOOTSTRAP_PASSWORD|secrets\./i.test(workflow)
if (!assertReadOnlyWorkflow) {
  blockers.push('The workflow contains a production database command or privileged secret reference.')
}

const hasDedicatedW02L8Bootstrap =
  /\/internal\/authz\/bootstrap-super-admin/.test(w02Index) &&
  /bootstrapSuperAdmin|grantSuperAdminBootstrap/.test(productionCode)
if (!hasDedicatedW02L8Bootstrap) {
  blockers.push('W02 has no dedicated, auditable one-time L8 super_admin bootstrap command.')
}

const hasMfaEnforcement =
  /verifyMfaStepUp|verifyMfaChallenge|requireMfaForPrivilegedAction/.test(productionCode) &&
  /verifyMfaStepUp|verifyMfaChallenge|requireMfaForPrivilegedAction/.test(testCode)
if (!hasMfaEnforcement || /Status:\s*`BLOCKED_NOT_GREEN`/.test(reconciliation)) {
  blockers.push('AUTH-007 MFA enforcement and executable test evidence are missing or still blocked.')
}

const hasTargetBoundDualApproval =
  /validateL8DualApproval|verifyTargetBoundDualApproval|distinctApproverIds/.test(productionCode) &&
  /validateL8DualApproval|verifyTargetBoundDualApproval|distinctApproverIds/.test(testCode)
if (!hasTargetBoundDualApproval) {
  blockers.push('L8 target-bound dual-approval enforcement and executable test evidence are missing.')
}

const report = {
  status: blockers.length === 0 ? 'READY_FOR_SEPARATE_REVIEW' : 'BLOCKED_NOT_GREEN',
  productionMutationPerformed: false,
  checks: {
    workflowIsReadOnly: assertReadOnlyWorkflow,
    dedicatedW02L8Bootstrap: hasDedicatedW02L8Bootstrap,
    mfaCodeAndTestEvidence: hasMfaEnforcement && !/Status:\s*`BLOCKED_NOT_GREEN`/.test(reconciliation),
    targetBoundDualApprovalCodeAndTestEvidence: hasTargetBoundDualApproval,
  },
  blockers,
}
console.log(JSON.stringify(report, null, 2))
if (blockers.length > 0) process.exitCode = 1
