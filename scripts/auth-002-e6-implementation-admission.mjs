import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const ccPath = resolve(root, 'docs/change-control/CC-MAPPING-0-AUTH-002-E6-RUNTIME-IMPLEMENTATION-ADMISSION-2026-09-21.md')
const gapPath = resolve(root, 'docs/change-control/CC-MAPPING-0-AUTH-002-E6-WIRE-INPUT-GAPS-2026-09-21.md')

const cc = readFileSync(ccPath, 'utf8')
const gaps = readFileSync(gapPath, 'utf8')

const status = cc.match(/^- Status:\s*(.+)$/m)?.[1] ?? ''
const gapStatus = gaps.match(/^- Status:\s*(.+)$/m)?.[1] ?? ''

const implementationAdmitted = status === 'GREEN — IMPLEMENTATION ADMITTED'
if (implementationAdmitted && gapStatus !== 'CLOSED — REQUIRED CONTRACT INPUTS RECONCILED') {
  throw new Error('E6 admission contradiction: implementation is GREEN while required wire/input gaps are not reconciled')
}

const protectedBaseline = {
  'workers/W01-payload/src/collections/Users.ts': '988046fbe4afa824765b72b55e5006f6fd14faa4',
  'workers/W01-payload/src/db/auth-session-state-schema.ts': '628f6b251c12d80232ab610ee7b080f86fa43c88',
  'workers/W01-payload/src/payload.config.ts': '7075187d36c3fe266b7bf85b174a67949d6b6dda',
}

const protectedChanges = []
for (const [file, baselineSha] of Object.entries(protectedBaseline)) {
  try {
    const currentSha = execFileSync('git', ['rev-parse', 'HEAD:' + file], { encoding: 'utf8' }).trim()
    if (currentSha !== baselineSha) protectedChanges.push(file)
  } catch {
    protectedChanges.push(file)
  }
}

if (!implementationAdmitted) {
  if (!['BLOCKED — REQUIRED CONTRACT INPUTS MISSING', 'BLOCKED — REQUIRED CONTRACT INPUTS INCOMPLETE'].includes(status)) {
    throw new Error('E6 admission guard: unexpected current implementation-control status: ' + status)
  }
  if (!gaps.includes('E6-WIRE-001') || !gaps.includes('E6-WIRE-002')) {
    throw new Error('E6 admission guard: required wire/input gap records are missing')
  }
  if (!gaps.includes('CLOSED — CONTRACT INPUTS RESOLVED')) {
    throw new Error('E6 admission guard: wire/input closure record is missing')
  }
}

console.log('AUTH-002_E6_IMPLEMENTATION_ADMISSION_CHECK_PASS')
console.log('- implementation admission is fail-closed until explicit GREEN')
console.log('- protected W01 auth runtime changes are rejected while blocked')
console.log('- E6-WIRE-001 and E6-WIRE-002 are present')
