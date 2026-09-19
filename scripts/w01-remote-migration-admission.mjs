import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd(), '..', '..')
const changeControlPath = join(
  root,
  'docs',
  'change-control',
  'CC-W01-MIGRATION-BASELINE-DIFF-2026-09-20.md',
)

const source = readFileSync(changeControlPath, 'utf8')

const admitted = /Status:\s*GREEN\s+—\s*EXECUTION ADMITTED/i.test(source)

if (process.argv.includes('--check-state')) {
  if (admitted) {
    console.log('W01_REMOTE_MIGRATION_STATE_VALID: GREEN — EXECUTION ADMITTED.')
  } else {
    console.log('W01_REMOTE_MIGRATION_STATE_VALID: execution remains BLOCKED until explicit GREEN — EXECUTION ADMITTED.')
  }
  process.exit(0)
}

if (!admitted) {
  console.error('W01_REMOTE_MIGRATION_ADMISSION_BLOCKED: migration baseline Change Control is not explicitly GREEN — EXECUTION ADMITTED.')
  console.error('Required: establish authoritative baseline evidence and explicitly admit remote migration execution in CC-W01-MIGRATION-BASELINE-DIFF-2026-09-20.')
  process.exit(1)
}

console.log('W01_REMOTE_MIGRATION_ADMISSION_PASS: migration baseline Change Control is explicitly GREEN — EXECUTION ADMITTED.')
