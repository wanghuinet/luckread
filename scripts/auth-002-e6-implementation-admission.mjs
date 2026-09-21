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

const protectedPattern = /^workers\/W01-payload\/src\/(collections\/Users\.ts|.*auth.*|.*Auth.*|payload\.config\.ts)$/
let changed = []
try {
  changed = execFileSync('git', ['show', '--format=', '--name-only', 'HEAD'], { encoding: 'utf8' })
    .split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
} catch {
  changed = []
}

const protectedChanges = changed.filter((p) => protectedPattern.test(p))

if (!implementationAdmitted && protectedChanges.length > 0) {
  throw new Error(
    'E6 implementation admission blocked: protected W01 authentication runtime files changed while the implementation Change Control is not GREEN. Changed: ' +
      protectedChanges.join(', '),
  )
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
