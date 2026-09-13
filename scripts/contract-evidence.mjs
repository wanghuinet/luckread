#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'

const result = process.env.CONTRACT_CI_RESULT ?? 'UNKNOWN'
const domain = process.env.CONTRACT_DOMAIN ?? 'unknown'
const commitSha = process.env.GITHUB_SHA ?? 'local'
const workflowRunId = process.env.GITHUB_RUN_ID ?? 'local'
const workflowRunAttempt = process.env.GITHUB_RUN_ATTEMPT ?? 'local'
const job = process.env.GITHUB_JOB ?? 'local'
const validatorVersion = process.env.CONTRACT_VALIDATOR_VERSION ?? '1.0.0'

if (!['PASS', 'FAIL'].includes(result)) {
  console.error('contract evidence: CONTRACT_CI_RESULT must be PASS or FAIL')
  process.exit(2)
}
if (commitSha === 'local' || workflowRunId === 'local' || job === 'local') {
  console.error('contract evidence: local execution cannot produce admission evidence')
  process.exit(2)
}

const evidence = {
  schemaVersion: '1.0',
  evidenceId: `contract-ci:${commitSha}:${workflowRunId}:${workflowRunAttempt}:${job}:${domain}`,
  contractId: `https://luckread.com/contracts/v1/${domain}`,
  contractVersion: '1.0.0',
  artifact: domain === 'openapi' ? 'contracts/openapi/v1/openapi.yaml' : `contracts/${domain}`,
  validator: 'scripts/contract-ci.mjs',
  validatorVersion,
  commitSha,
  workflowRunId,
  workflowRunAttempt,
  job,
  generatedAt: new Date().toISOString(),
  result,
  execution: 'actual-ci-step',
}

await mkdir('contract-evidence', { recursive: true })
const output = `contract-evidence/${domain}.json`
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(`Contract evidence written: ${output}`)
