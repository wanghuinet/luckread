import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const packetPath = resolve(root, 'artifacts/mapping-0/priv004-policy-instance-admission-packet-2026-09-27.json')
const instancePath = resolve(root, 'artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json')
const contractPath = resolve(root, 'contracts/privacy/PRIV-004-retention-policy-authority.v1.json')

const packet = JSON.parse(readFileSync(packetPath, 'utf8'))
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))

const fail = (message) => {
  throw new Error(`PRIV-004 admission guard: ${message}`)
}

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const requireNonEmptyString = (value, name) => {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} is required`)
  }
}

if (contract.featureId !== 'PRIV-004') {
  fail('authoritative contract featureId changed unexpectedly')
}

if (!existsSync(instancePath)) {
  if (packet.status !== 'INPUT_REQUIRED') {
    fail('approved instance is absent but admission packet is not INPUT_REQUIRED')
  }

  console.log('PRIV004_ADMISSION_GUARD_PASS_FAIL_CLOSED')
  console.log('- no concrete approved policy instance is present')
  console.log('- admission packet remains INPUT_REQUIRED')
  console.log('- no runtime authorization is inferred')
  process.exit(0)
}

const instance = JSON.parse(readFileSync(instancePath, 'utf8'))

for (const field of [
  'policyId',
  'policyVersion',
  'owner',
  'environment',
  'sourceAuthority',
  'approvalRef',
  'rollbackVersion',
]) {
  requireNonEmptyString(instance[field], field)
}

if (!isRecord(instance.scope)) {
  fail('scope must be an object')
}
if (Object.keys(instance.scope).length === 0) {
  fail('scope must not be empty')
}

if (!['APPROVED', 'ACTIVE'].includes(instance.status)) {
  fail('status must be APPROVED or ACTIVE')
}

if (instance.retentionClass !== 'LEGAL_AUDIT') {
  fail('retentionClass must be LEGAL_AUDIT')
}

const effectiveFrom = Date.parse(instance.effectiveFrom ?? '')
if (!Number.isFinite(effectiveFrom)) {
  fail('effectiveFrom must be a valid date-time')
}

if (instance.effectiveTo !== null && instance.effectiveTo !== undefined) {
  const effectiveTo = Date.parse(instance.effectiveTo)
  if (!Number.isFinite(effectiveTo)) {
    fail('effectiveTo must be null or a valid date-time')
  }
  if (effectiveTo < effectiveFrom) {
    fail('effectiveTo must not precede effectiveFrom')
  }
}

if (!isRecord(instance.rule)) {
  fail('rule must be an object')
}

const mode = instance.rule.mode
if (!['DURATION', 'FIXED_UNTIL'].includes(mode)) {
  fail('rule.mode must be DURATION or FIXED_UNTIL')
}

if (mode === 'DURATION') {
  if (!Number.isInteger(instance.rule.durationSeconds) || instance.rule.durationSeconds < 0) {
    fail('DURATION requires integer durationSeconds >= 0')
  }
  if (instance.rule.fixedUntil !== undefined && instance.rule.fixedUntil !== null) {
    fail('DURATION forbids fixedUntil')
  }
}

if (mode === 'FIXED_UNTIL') {
  if (typeof instance.rule.fixedUntil !== 'string' || !Number.isFinite(Date.parse(instance.rule.fixedUntil))) {
    fail('FIXED_UNTIL requires a valid fixedUntil date-time')
  }
  if (instance.rule.durationSeconds !== undefined && instance.rule.durationSeconds !== null) {
    fail('FIXED_UNTIL forbids durationSeconds')
  }
}

if (!isRecord(instance.provenance)) {
  fail('provenance is required for current-main traceability')
}
if (!/^[0-9a-f]{40}$/.test(instance.provenance.commitSha ?? '')) {
  fail('provenance.commitSha must be an exact 40-hex commit SHA')
}
requireNonEmptyString(instance.provenance.sourcePath, 'provenance.sourcePath')

const currentCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const instanceSourceCommitSha = execFileSync(
  'git',
  ['log', '-1', '--format=%H', '--', 'artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json'],
  { encoding: 'utf8' },
).trim()

if (!instanceSourceCommitSha) {
  fail('canonical policy instance must be present in repository history')
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', instance.provenance.commitSha, instanceSourceCommitSha])
} catch {
  fail(
    `provenance.commitSha (${instance.provenance.commitSha}) must be an ancestor of the commit that last changed the canonical policy instance (${instanceSourceCommitSha})`,
  )
}

try {
  execFileSync('git', ['merge-base', '--is-ancestor', instance.provenance.commitSha, currentCommitSha])
} catch {
  fail(
    `provenance.commitSha (${instance.provenance.commitSha}) must be an ancestor of current HEAD (${currentCommitSha})`,
  )
}

if (instance.provenance.sourcePath !== 'artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json') {
  fail('provenance.sourcePath must identify the canonical approved policy instance artifact')
}

if (packet.status === 'INPUT_REQUIRED') {
  fail('concrete policy instance exists but admission packet remains INPUT_REQUIRED')
}

console.log('PRIV004_ADMISSION_GUARD_PASS')
console.log('- concrete policy instance satisfies the contracted admission shape')
console.log('- policy-instance provenance is tied to an approved/source checkpoint ancestor of the artifact commit and verified as reachable from current HEAD')
console.log('- packet is no longer INPUT_REQUIRED')
console.log('- no runtime implementation or Evidence Registry promotion is performed')
