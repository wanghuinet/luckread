import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(process.cwd(), '..', '..')
const changeControlPath = join(
  root,
  'docs',
  'change-control',
  'CC-MAPPING-0-AUTH-002-E5-REMOTE-EXECUTION-2026-09-21.md',
)

const source = readFileSync(changeControlPath, 'utf8')
const admitted = /Status:\s*GREEN\s+—\s*EXECUTION ADMITTED/i.test(source)

const migrationPath = 'workers/W01-payload/src/migrations/20260921_003203_MIG_AUTH_002_SESSION_V1.ts'
const migrationIndexPath = 'workers/W01-payload/src/migrations/index.ts'
const expectedMigrationBlob = '2b43a7b08fe7c5be98793da7eb07ddd2cf9e6921'
const expectedMigrationIndexBlob = '436c37e395145017d9135f938d69a741a936c60b'

const baselineMigration = '20250929_111647'
const e5Migration = '20260921_003203_MIG_AUTH_002_SESSION_V1'

function gitBlob(path) {
  try {
    return execFileSync('git', ['rev-parse', `HEAD:${path}`], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function migrationSources() {
  const migrationDir = join(root, 'workers', 'W01-payload', 'src', 'migrations')
  return execFileSync(
    'find',
    [migrationDir, '-maxdepth', '1', '-type', 'f', '-name', '*.ts', '!', '-name', 'index.ts'],
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean).map((value) => value.split('/').pop())
}

if (!admitted) {
  console.error('AUTH-002_E5_REMOTE_MIGRATION_ADMISSION_BLOCKED: Change Control is not explicitly GREEN — EXECUTION ADMITTED.')
  console.error('Required: docs/change-control/CC-MAPPING-0-AUTH-002-E5-REMOTE-EXECUTION-2026-09-21.md must explicitly state: Status: GREEN — EXECUTION ADMITTED')
  process.exit(1)
}

const migrationBlob = gitBlob(migrationPath)
const indexBlob = gitBlob(migrationIndexPath)

if (migrationBlob !== expectedMigrationBlob) {
  console.error(`AUTH-002_E5_REMOTE_MIGRATION_ADMISSION_BLOCKED: E5 migration blob mismatch. Expected ${expectedMigrationBlob}; observed ${migrationBlob ?? 'MISSING'}.`)
  process.exit(1)
}

if (indexBlob !== expectedMigrationIndexBlob) {
  console.error(`AUTH-002_E5_REMOTE_MIGRATION_ADMISSION_BLOCKED: migration index blob mismatch. Expected ${expectedMigrationIndexBlob}; observed ${indexBlob ?? 'MISSING'}.`)
  process.exit(1)
}

const files = migrationSources()
const expectedFiles = [
  `${baselineMigration}.ts`,
  `${e5Migration}.ts`,
].sort()

if (JSON.stringify([...files].sort()) !== JSON.stringify(expectedFiles)) {
  console.error('AUTH-002_E5_REMOTE_MIGRATION_ADMISSION_BLOCKED: executable migration source set drifted.')
  console.error(`Expected: ${expectedFiles.join(', ')}`)
  console.error(`Observed: ${files.join(', ')}`)
  process.exit(1)
}

const indexSource = readFileSync(join(root, 'workers', 'W01-payload', 'src', 'migrations', 'index.ts'), 'utf8')
for (const name of [baselineMigration, e5Migration]) {
  const matches = indexSource.match(new RegExp(`name:\\s*'${name.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&')}'`, 'g')) ?? []
  if (matches.length !== 1) {
    console.error(`AUTH-002_E5_REMOTE_MIGRATION_ADMISSION_BLOCKED: expected exactly one index registration for ${name}; observed ${matches.length}.`)
    process.exit(1)
  }
}

console.log('AUTH-002_E5_REMOTE_MIGRATION_ADMISSION_PASS: explicit GREEN admission, exact E5 source/index, and expected two-migration source set verified.')
