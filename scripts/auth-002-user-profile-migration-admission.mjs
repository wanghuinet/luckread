import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const migrationName = '20260925_111503_MIG_ENT_USER_PROFILE_V1'
const migrationPath = `workers/W01-payload/src/migrations/${migrationName}.ts`
const indexPath = 'workers/W01-payload/src/migrations/index.ts'
const expectedMigrationBlob = '3f469bea4d1bc74b81815848f71334b507358b7a'
const expectedIndexBlob = 'fab4442a1840899c10e25af2ddb9a7f0f004aa7a'
const expectedChangeControl = 'docs/change-control/CC-W01-ENT-USER-PROFILE-MIGRATION-2026-09-25.md'

function gitBlob(path) {
  try { return execFileSync('git', ['rev-parse', `HEAD:${path}`], { cwd: root, encoding: 'utf8' }).trim() }
  catch { return null }
}

const cc = readFileSync(join(root, expectedChangeControl), 'utf8')
if (!/^- Status:\s*GREEN\s+—\s*EXECUTION ADMITTED\s*$/m.test(cc)) {
  console.error('AUTH-002_USER_PROFILE_ADMISSION_BLOCKED: Change Control is not explicitly GREEN — EXECUTION ADMITTED.')
  process.exit(1)
}

const migrationBlob = gitBlob(migrationPath)
if (migrationBlob !== expectedMigrationBlob) {
  console.error(`AUTH-002_USER_PROFILE_ADMISSION_BLOCKED: migration blob mismatch; expected ${expectedMigrationBlob}, got ${migrationBlob ?? 'MISSING'}.`)
  process.exit(1)
}

const indexBlob = gitBlob(indexPath)
if (indexBlob !== expectedIndexBlob) {
  console.error(`AUTH-002_USER_PROFILE_ADMISSION_BLOCKED: migration index blob mismatch; expected ${expectedIndexBlob}, got ${indexBlob ?? 'MISSING'}.`)
  process.exit(1)
}

const index = readFileSync(join(root, indexPath), 'utf8')
const registrations = index.match(new RegExp(`name:\\s*'${migrationName}'`, 'g')) ?? []
if (registrations.length !== 1) {
  console.error(`AUTH-002_USER_PROFILE_ADMISSION_BLOCKED: expected exactly one ${migrationName} registration; got ${registrations.length}.`)
  process.exit(1)
}

const migrationDir = join(root, 'workers', 'W01-payload', 'src', 'migrations')
const files = execFileSync('find', [migrationDir, '-maxdepth', '1', '-type', 'f', '-name', '*.ts', '!', '-name', 'index.ts'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map((value) => value.split('/').pop()).sort()
const expectedFiles = ['20250929_111647.ts', '20260921_003203_MIG_AUTH_002_SESSION_V1.ts', `${migrationName}.ts`].sort()
if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
  console.error(`AUTH-002_USER_PROFILE_ADMISSION_BLOCKED: executable migration set mismatch. Expected ${JSON.stringify(expectedFiles)}, got ${JSON.stringify(files)}.`)
  process.exit(1)
}

console.log(JSON.stringify({ result: 'PASS', migrationName, migrationBlob, indexBlob, executableMigrationFiles: files, changeControl: expectedChangeControl }, null, 2))