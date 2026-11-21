#!/usr/bin/env node
/**
 * PRIV-004 production readiness gate.
 *
 * This gate is intentionally separate from the structural admission guard:
 * a development/test policy instance may be structurally valid, but it MUST
 * never be treated as production authority.
 *
 * The gate does not select or infer any retention rule. It only verifies that
 * the repository contains an explicitly admitted production instance and an
 * explicit production runtime authorization state.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const instancePath = path.join(root, 'artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json')
const packetPath = path.join(root, 'artifacts/mapping-0/priv004-policy-instance-admission-packet-2026-09-27.json')
const contractPath = path.join(root, 'contracts/privacy/PRIV-004-retention-policy-authority.v1.json')

const failures = []
const fail = (message) => failures.push(message)
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const readJson = (file) => {
  if (!fs.existsSync(file)) {
    fail(`missing ${path.relative(root, file)}`)
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`invalid JSON ${path.relative(root, file)}: ${error.message}`)
    return null
  }
}

const instance = readJson(instancePath)
const packet = readJson(packetPath)
const contract = readJson(contractPath)

if (!instance || !packet || !contract) {
  console.error('PRIV004_PRODUCTION_GATE_BLOCKED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

if (contract.featureId !== 'PRIV-004') fail('authoritative contract featureId must be PRIV-004')

if (instance.environment !== 'PRODUCTION') {
  fail(`policy instance environment must be PRODUCTION; found ${instance.environment ?? 'missing'}`)
}

for (const [field, value] of [['policyId', instance.policyId], ['owner', instance.owner], ['rollbackVersion', instance.rollbackVersion], ['sourceAuthority', instance.sourceAuthority], ['approvalRef', instance.approvalRef]]) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} is required`)
}

if (!isRecord(instance.scope) || Object.keys(instance.scope).length === 0) {
  fail('production policy scope must be a non-empty object')
}

if (instance.scope.environment !== 'PRODUCTION') {
  fail(`production policy scope.environment must be PRODUCTION; found ${instance.scope.environment ?? 'missing'}`)
}

if (!['APPROVED', 'ACTIVE'].includes(instance.status)) {
  fail(`policy instance status must be APPROVED or ACTIVE; found ${instance.status ?? 'missing'}`)
}

if (instance.scope?.operationId !== 'authRegister') {
  fail('production policy scope.operationId must be authRegister')
}

if (instance.scope?.purpose !== 'ACCOUNT_REGISTRATION') {
  fail('production policy scope.purpose must be ACCOUNT_REGISTRATION')
}

if (instance.retentionClass !== 'LEGAL_AUDIT') {
  fail('production policy retentionClass must be LEGAL_AUDIT')
}

if (instance.usage?.productionUse !== true) {
  fail('production policy must explicitly declare usage.productionUse=true')
}

if (!isRecord(instance.usage)) {
  fail('production usage declaration is required')
}

if (typeof instance.policyVersion !== 'string' || instance.policyVersion.trim() === '') {
  fail('policyVersion is required')
}

if (typeof instance.sourceAuthority !== 'string' || instance.sourceAuthority.trim() === '') {
  fail('sourceAuthority is required')
}

if (typeof instance.approvalRef !== 'string' || instance.approvalRef.trim() === '') {
  fail('approvalRef is required')
}

const effectiveFrom = Date.parse(instance.effectiveFrom ?? '')
if (!Number.isFinite(effectiveFrom)) fail('effectiveFrom must be a valid date-time')

if (instance.effectiveTo !== null && instance.effectiveTo !== undefined) {
  const effectiveTo = Date.parse(instance.effectiveTo)
  if (!Number.isFinite(effectiveTo)) fail('effectiveTo must be null or a valid date-time')
  if (effectiveTo < effectiveFrom) fail('effectiveTo must not precede effectiveFrom')
}

if (!isRecord(instance.rule)) {
  fail('rule must be an object')
} else if (!['DURATION', 'FIXED_UNTIL'].includes(instance.rule.mode)) {
  fail('rule.mode must be DURATION or FIXED_UNTIL')
} else if (instance.rule.mode === 'DURATION') {
  if (!Number.isInteger(instance.rule.durationSeconds) || instance.rule.durationSeconds < 0) {
    fail('DURATION requires integer durationSeconds >= 0')
  }
  if (instance.rule.fixedUntil !== undefined && instance.rule.fixedUntil !== null) {
    fail('DURATION forbids fixedUntil')
  }
} else {
  if (typeof instance.rule.fixedUntil !== 'string' || !Number.isFinite(Date.parse(instance.rule.fixedUntil))) {
    fail('FIXED_UNTIL requires a valid fixedUntil date-time')
  }
  if (instance.rule.durationSeconds !== undefined && instance.rule.durationSeconds !== null) {
    fail('FIXED_UNTIL forbids durationSeconds')
  }
}

if (!isRecord(instance.provenance)) {
  fail('current-commit provenance is required')
} else {
  if (!/^[0-9a-f]{40}$/.test(instance.provenance.commitSha ?? '')) {
    fail('provenance.commitSha must be an exact 40-hex commit SHA')
  }
  if (instance.provenance.sourcePath !== 'artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json') {
    fail('provenance.sourcePath must identify the canonical policy-instance artifact')
  }

  try {
    const currentCommitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const instanceSourceCommitSha = execFileSync(
      'git',
      ['log', '-1', '--format=%H', '--', 'artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json'],
      { encoding: 'utf8' },
    ).trim()

    if (!instanceSourceCommitSha) {
      fail('canonical policy instance must be present in repository history')
    } else {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', instance.provenance.commitSha, instanceSourceCommitSha])
      } catch {
        fail('provenance.commitSha must be an ancestor of the commit that last changed the canonical policy instance')
      }

      try {
        execFileSync('git', ['merge-base', '--is-ancestor', instance.provenance.commitSha, currentCommitSha])
      } catch {
        fail('provenance.commitSha must be an ancestor of current HEAD')
      }
    }
  } catch (error) {
    fail(`unable to validate git provenance: ${error.message}`)
  }
}

if (packet.status !== 'PRODUCTION_INSTANCE_ADMITTED') {
  fail(`admission packet status must be PRODUCTION_INSTANCE_ADMITTED; found ${packet.status ?? 'missing'}`)
}

if (packet.runtimeAuthorization?.production !== 'AUTHORIZED') {
  fail('admission packet runtimeAuthorization.production must be AUTHORIZED')
}

if (!Array.isArray(packet.productionMissingInputs)) {
  fail('admission packet productionMissingInputs must be an array')
} else if (packet.productionMissingInputs.length > 0) {
  fail('admission packet still contains productionMissingInputs')
}

if (!isRecord(packet.admittedInstance)) {
  fail('admission packet admittedInstance is required')
}

if (packet.admittedInstance?.policyId !== instance.policyId) {
  fail('packet admittedInstance.policyId must match the canonical production policy instance')
}

if (packet.admittedInstance?.environment !== 'PRODUCTION') {
  fail(`packet admittedInstance.environment must be PRODUCTION; found ${packet.admittedInstance?.environment ?? 'missing'}`)
}

if (packet.admittedInstance?.policyVersion !== instance.policyVersion) {
  fail('packet admittedInstance.policyVersion must match the canonical production policy instance')
}

if (packet.admittedInstance?.rule?.mode !== instance.rule?.mode) {
  fail('packet admittedInstance.rule.mode must match the canonical production policy instance')
}

if (failures.length) {
  console.error('PRIV004_PRODUCTION_GATE_BLOCKED')
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('No production authorization is inferred from a structurally valid development policy instance.')
  process.exit(1)
}

console.log('PRIV004_PRODUCTION_GATE_PASS')
console.log('- canonical policy instance is explicitly PRODUCTION')
console.log('- production admission packet is explicitly admitted')
console.log('- production runtime authorization is explicit')
console.log('- no retention value or legal conclusion was inferred by this gate')
