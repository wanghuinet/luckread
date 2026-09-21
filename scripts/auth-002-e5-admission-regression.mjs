import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const admissionPath = resolve(root, 'scripts/auth-002-e5-remote-migration-admission.mjs')
const workflowPath = resolve(root, '.github/workflows/auth-002-e5-remote-migration-execution.yml')
const parentCcPath = resolve(root, 'docs/change-control/CC-MAPPING-0-AUTH-002-E5-REMOTE-EXECUTION-2026-09-21.md')

const admission = readFileSync(admissionPath, 'utf8')
const workflow = readFileSync(workflowPath, 'utf8')
const parentCc = readFileSync(parentCcPath, 'utf8')

const anchoredPattern = /^- Status:\\s*GREEN\\s+—\\s*EXECUTION ADMITTED\\s*$/m
if (!admission.includes("const admitted = /^- Status:\\s*GREEN\\s+—\\s*EXECUTION ADMITTED\\s*$/m.test(source)")) {
  throw new Error('E5 admission guard is not the exact anchored authoritative Status-line check')
}

const explanatoryFixture = [
  '# Decision boundary',
  '',
  'Remote execution is NOT authorized until this control is explicitly changed to the status: GREEN — EXECUTION ADMITTED',
].join('\n')

if (anchoredPattern.test(explanatoryFixture)) {
  throw new Error('E5 admission regression: explanatory prose incorrectly matches GREEN admission')
}

const greenFixture = '- Status: GREEN — EXECUTION ADMITTED'
if (!anchoredPattern.test(greenFixture)) {
  throw new Error('E5 admission regression: exact GREEN Status line does not admit')
}

const openFixture = '- Status: OPEN — EXECUTION DECISION REQUIRED'
if (anchoredPattern.test(openFixture)) {
  throw new Error('E5 admission regression: OPEN status incorrectly admits')
}

const workflowOnBlock = workflow.match(/^on:\n([\s\S]*?)(?=^jobs:)/m)?.[1] ?? ''
if (!workflowOnBlock.includes('workflow_dispatch:')) {
  throw new Error('E5 workflow must retain workflow_dispatch')
}
if (/^\s{2}push:\s*$/m.test(workflowOnBlock)) {
  throw new Error('E5 workflow still has an automatic push trigger')
}
if (workflow.includes('github.event_name') && workflow.includes('github.event.head_commit.message')) {
  throw new Error('E5 workflow still contains obsolete push-marker validation')
}

if (!/^\- Status:\s*OPEN\s+—\s+EXECUTION DECISION REQUIRED\s*$/m.test(parentCc)) {
  throw new Error('Parent E5 Change Control must remain explicitly OPEN until authority reconciliation')
}

const staleMarker = resolve(root, 'artifacts/mapping-0/AUTH-002-E5-EXECUTE-REQUEST.txt')
try {
  readFileSync(staleMarker, 'utf8')
  throw new Error('stale E5 execute-request marker still exists')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

console.log('AUTH-002_E5_ADMISSION_REGRESSION_PASS')
console.log('- exact Status-line admission semantics verified')
console.log('- explanatory prose cannot trigger admission')
console.log('- OPEN status cannot trigger admission')
console.log('- workflow is manual-dispatch only')
console.log('- obsolete push-marker validation is absent')
console.log('- parent authority remains OPEN and fail-closed')
console.log('- stale execution marker is absent')
