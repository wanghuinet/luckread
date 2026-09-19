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

if (!/Status:\s*GREEN\s+—\s*EXECUTION ADMITTED/i.test(source)) {
  console.error('W01_REMOTE_MIGRATION_ADMISSION_BLOCKED: migration baseline Change Control is not explicitly GREEN — EXECUTION ADMITTED.')
  console.error('Required: establish authoritative baseline evidence and explicitly admit remote migration execution in CC-W01-MIGRATION-BASELINE-DIFF-2026-09-20.')
  process.exit(1)
}

console.log('W01_REMOTE_MIGRATION_ADMISSION_PASS: migration baseline Change Control is explicitly GREEN — EXECUTION ADMITTED.')
