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

if (/^-\s*Status:\s*OPEN\s*—/m.test(source) || /Status:\s*OPEN\s+—\s*EXECUTION NOT ADMITTED/i.test(source)) {
  console.error('W01_REMOTE_MIGRATION_ADMISSION_BLOCKED: migration baseline Change Control is OPEN and remote execution is not admitted.')
  console.error('Required: close CC-W01-MIGRATION-BASELINE-DIFF-2026-09-20 with authoritative baseline evidence before remote deploy:database execution.')
  process.exit(1)
}

console.log('W01_REMOTE_MIGRATION_ADMISSION_PASS: migration baseline Change Control is not OPEN.')
