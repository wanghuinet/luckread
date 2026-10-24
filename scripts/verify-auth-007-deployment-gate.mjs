import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath))

const mfaMigrationPath = 'workers/W02-identity/migrations/0006_better_auth_two_factor.sql'
const roleAssignmentPath = 'workers/W02-identity/src/authz/role-assignment.ts'
const betterAuthPath = 'workers/W02-identity/src/auth/better-auth.ts'
const reconciliationPath = 'contracts/alignment/mapping-batches/AUTH-007-real-evidence-reconciliation.v1.md'

// Any MFA-dependent artifact makes this source subject to the gate.
// Using AND here would allow a partial/renamed implementation to skip it.
const mfaDependentRuntimePresent =
  exists(mfaMigrationPath) ||
  (exists(roleAssignmentPath) && /LEFT JOIN\s+"twoFactor"/.test(read(roleAssignmentPath))) ||
  (exists(betterAuthPath) && /twoFactor\s*\(/.test(read(betterAuthPath)))

if (!mfaDependentRuntimePresent) {
  console.log(JSON.stringify({
    status: 'NOT_REQUIRED_FOR_SOURCE',
    mfaDependentRuntimePresent: false,
    productionMutationPerformed: false,
  }, null, 2))
  process.exit(0)
}

if (!exists(reconciliationPath)) {
  console.error('AUTH-007 deployment gate: reconciliation record is missing; refusing production migration/deployment.')
  process.exit(1)
}

const reconciliation = read(reconciliationPath)
const status = reconciliation.match(/^- Status:\s*`([^`]+)`/m)?.[1] ?? null
const implementationAuthorization = reconciliation.match(/^- Implementation authorization:\s*`([^`]+)`/m)?.[1] ?? null

const allowed = status === 'GREEN' && implementationAuthorization === 'true'
const report = {
  status: allowed ? 'AUTH_007_GREEN' : 'BLOCKED_NOT_GREEN',
  mfaDependentRuntimePresent: true,
  auth007Status: status,
  implementationAuthorization,
  productionMutationPerformed: false,
}
console.log(JSON.stringify(report, null, 2))

if (!allowed) {
  console.error('AUTH-007 must be GREEN with implementation authorization true before deploying MFA-dependent W02 runtime or applying its MFA/L8 schema.')
  process.exit(1)
}
