import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(process.cwd(), '..', '..')
const changeControlPath = join(
  root,
  'docs',
  'change-control',
  'CC-W01-MIGRATION-BASELINE-DIFF-2026-09-20.md',
)

const source = readFileSync(changeControlPath, 'utf8')

const admitted = /^- Status:\s*GREEN\s+—\s*EXECUTION ADMITTED\s*$/m.test(source)
const migrationPath = 'workers/W01-payload/src/migrations/20250929_111647.ts'
const migrationIndexPath = 'workers/W01-payload/src/migrations/index.ts'
const expectedMigrationBlob = '21e4a9ce27c828da655e479e35eb44ea3daff0f3'
const expectedMigrationIndexBlob = 'e596aeb65381fd3bb2e0cfa7879c8f850bb77cbe'

function gitBlob(path) {
  try {
    return execFileSync('git', ['rev-parse', `HEAD:${path}`], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function assertApprovedBaselineArtifacts() {
  const migrationBlob = gitBlob(migrationPath)

  if (migrationBlob !== expectedMigrationBlob) {
    console.error(`W01_REMOTE_MIGRATION_ADMISSION_BLOCKED: approved baseline migration blob mismatch for ${migrationPath}.`)
    console.error(`Expected ${expectedMigrationBlob}; observed ${migrationBlob ?? 'MISSING'}.`)
    process.exit(1)
  }

  const indexSource = readFileSync(join(root, migrationIndexPath), 'utf8')
  const baselineRegistrations = indexSource.match(new RegExp(`name:\\s*'20250929_111647'`, 'g')) ?? []
  if (baselineRegistrations.length !== 1) {
    console.error(`W01_REMOTE_MIGRATION_ADMISSION_BLOCKED: expected exactly one baseline registration for ${migrationIndexPath}; observed ${baselineRegistrations.length}.`)
    process.exit(1)
  }
}

function assertApprovedBaselineExecutionSet() {
  const indexBlob = gitBlob(migrationIndexPath)
  if (indexBlob !== expectedMigrationIndexBlob) {
    console.error(`W01_REMOTE_MIGRATION_ADMISSION_BLOCKED: approved baseline migration index blob mismatch for ${migrationIndexPath}.`)
    console.error(`Expected ${expectedMigrationIndexBlob}; observed ${indexBlob ?? 'MISSING'}.`)
    process.exit(1)
  }

  const migrationDir = join(root, 'workers', 'W01-payload', 'src', 'migrations')
  const migrationFiles = execFileSync(
    'find',
    [migrationDir, '-maxdepth', '1', '-type', 'f', '-name', '*.ts', '!', '-name', 'index.ts'],
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)

  if (migrationFiles.length !== 1) {
    console.error(`W01_REMOTE_MIGRATION_ADMISSION_BLOCKED: expected exactly one executable migration source; observed ${migrationFiles.length}.`)
    process.exit(1)
  }
}

if (process.argv.includes('--check-state')) {
  if (admitted) {
    assertApprovedBaselineArtifacts()
    console.log('W01_REMOTE_MIGRATION_STATE_VALID: baseline artifacts remain intact; later migrations, when present, are governed by their own execution controls.')
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

assertApprovedBaselineExecutionSet()
console.log('W01_REMOTE_MIGRATION_ADMISSION_PASS: approved baseline migration is explicitly GREEN — EXECUTION ADMITTED.')
