import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const migrationName = '20260928_020000_MIG_AUTH_001_REGISTRATION_BATCH_V1'
const migrationPath = `workers/luck02-content/src/migrations/${migrationName}.ts`
const indexPath = 'workers/luck02-content/src/migrations/index.ts'
const changeControlPath = 'docs/change-control/CC-MAPPING-0-AUTH-001-REGISTRATION-MIGRATION-EXECUTION-2026-09-28.md'
const expectedMigrationBlob = '77ae87a7ecb6275d64c149b02347d1e4464491cc'
const expectedChangeControlStatus = /^- Status:\s*GREEN — DEV CONTROLLED EXECUTION ADMITTED \/ PRODUCTION BLOCKED\s*$/m

function gitBlob(path) {
  try {
    return execFileSync('git', ['rev-parse', `HEAD:${path}`], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const cc = readFileSync(join(root, changeControlPath), 'utf8')
if (!expectedChangeControlStatus.test(cc)) {
  console.error('AUTH-001_REGISTRATION_MIGRATION_ADMISSION_BLOCKED: Change Control is not in the admitted controlled-execution state.')
  process.exit(1)
}

const migrationBlob = gitBlob(migrationPath)
if (!migrationBlob) {
  console.error(`AUTH-001_REGISTRATION_MIGRATION_ADMISSION_BLOCKED: missing migration ${migrationPath}.`)
  process.exit(1)
}

// The blob is pinned after the first exact-source validation commit; this protects the
// execution gate from silently changing the SQL body between admission and dispatch.
if (migrationBlob !== expectedMigrationBlob) {
  console.error(`AUTH-001_REGISTRATION_MIGRATION_ADMISSION_BLOCKED: migration blob mismatch; expected ${expectedMigrationBlob}, got ${migrationBlob}.`)
  process.exit(1)
}

const index = readFileSync(join(root, indexPath), 'utf8')
const registrations = [...index.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1])
if (registrations.filter((name) => name === migrationName).length !== 1) {
  console.error(`AUTH-001_REGISTRATION_MIGRATION_ADMISSION_BLOCKED: expected exactly one ${migrationName} registration.`)
  process.exit(1)
}

const migrationDir = join(root, 'workers', 'luck02-content', 'src', 'migrations')
const files = execFileSync(
  'find',
  [migrationDir, '-maxdepth', '1', '-type', 'f', '-name', '*.ts', '!', '-name', 'index.ts'],
  { cwd: root, encoding: 'utf8' },
).trim().split('\n').filter(Boolean).map((value) => value.split('/').pop()).sort()

const expectedTargetFile = `${migrationName}.ts`
if (files[files.length - 1] !== expectedTargetFile) {
  console.error(`AUTH-001_REGISTRATION_MIGRATION_ADMISSION_BLOCKED: ${migrationName} is not the last executable W01 migration in this source. Later migration(s) would make payload migrate unsafe for this scoped execution: ${JSON.stringify(files)}`)
  process.exit(1)
}

console.log(JSON.stringify({
  result: 'PASS',
  migrationName,
  migrationBlob,
  migrationIndexBlob: gitBlob(indexPath),
  executableMigrationFiles: files,
  migrationOrder: registrations,
  changeControl: changeControlPath,
}, null, 2))
