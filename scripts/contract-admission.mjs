#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'

const REQUIRED = ['common', 'enums', 'state-machines', 'authz', 'openapi']
const expectedSha = process.env.GITHUB_SHA
const dir = process.argv[2] ?? 'contract-evidence'
const errors = []

if (!expectedSha) errors.push('GITHUB_SHA is required')

let files = []
try { files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort() }
catch { errors.push(`evidence registry '${dir}' is missing`) }

const evidence = []
for (const file of files) {
  try { evidence.push(JSON.parse(await readFile(`${dir}/${file}`, 'utf8'))) }
  catch (error) { errors.push(`${dir}/${file}: invalid JSON (${error.message})`) }
}

if (evidence.length === 0) errors.push('Evidence Registry is empty — PASS is forbidden')

const seen = new Set()
for (const item of evidence) {
  for (const field of ['evidenceId', 'contractId', 'contractVersion', 'artifact', 'validator', 'validatorVersion', 'commitSha', 'workflowRunId', 'workflowRunAttempt', 'job', 'generatedAt', 'result', 'execution']) {
    if (typeof item[field] !== 'string' || item[field].length === 0) errors.push(`evidence '${item.evidenceId ?? 'unknown'}': missing ${field}`)
  }
  if (seen.has(item.evidenceId)) errors.push(`duplicate evidenceId '${item.evidenceId}'`)
  seen.add(item.evidenceId)
  if (item.result !== 'PASS') errors.push(`evidence '${item.evidenceId}': result must be PASS`)
  if (item.execution !== 'actual-ci-step') errors.push(`evidence '${item.evidenceId}': execution is not actual-ci-step`)
  if (item.commitSha !== expectedSha) errors.push(`evidence '${item.evidenceId}': commit SHA ${item.commitSha} != ${expectedSha}`)
  if (item.workflowRunId === 'local' || item.job === 'local') errors.push(`evidence '${item.evidenceId}': local evidence is forbidden`)
}

for (const domain of REQUIRED) {
  const matches = evidence.filter((item) => item.contractId === `https://luckread.com/contracts/v1/${domain}` && item.result === 'PASS' && item.commitSha === expectedSha)
  if (matches.length !== 1) errors.push(`required domain '${domain}' must have exactly one exact-commit PASS evidence record`)
}

if (errors.length) {
  console.error('Contract Development Admission BLOCKED — evidence validation FAILED:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log(`Contract Development Admission READY — ${REQUIRED.length} exact-commit PASS evidence records verified`)
