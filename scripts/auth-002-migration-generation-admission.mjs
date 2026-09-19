import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const payloadRoot = join(root, 'workers', 'W01-payload')
const fail = (message) => {
  console.error(`AUTH-002_MIGRATION_GENERATION_BLOCKED: ${message}`)
  process.exit(1)
}
const pkg = JSON.parse(readFileSync(join(payloadRoot, 'package.json'), 'utf8'))
const config = readFileSync(join(payloadRoot, 'src', 'payload.config.ts'), 'utf8')
const users = readFileSync(join(payloadRoot, 'src', 'collections', 'Users.ts'), 'utf8')

// Current W01 lock is Payload 3.87.1; 3.82.1 remains only the upstream
// Cloudflare-template observation (see PAYLOAD-CLOUDFLARE-D1-UPSTREAM-MANIFEST.md).
if (pkg.dependencies?.payload !== '3.87.1') fail('W01 Payload dependency is not exactly 3.87.1')
if (pkg.dependencies?.['@payloadcms/db-d1-sqlite'] !== '3.87.1') fail('W01 D1 adapter dependency is not exactly 3.87.1')
if (!config.includes('sqliteD1Adapter')) fail('W01 sqliteD1Adapter is not configured')
if (!config.includes('push: false')) fail('W01 push:false is required')
if (!config.includes('migrationDir')) fail('W01 migrationDir is not configured')
if (!users.includes('auth: true')) fail('W01 Users native auth is not enabled')

const migrationsDir = join(payloadRoot, 'src', 'migrations')
if (!existsSync(migrationsDir)) {
  console.error('AUTH-002_MIGRATION_GENERATION_READY: W01 configuration is admissible, but no migration artifact exists yet')
  console.error('NEXT: generate with the W01 repository Payload CLI; do not hand-author DDL and do not apply a migration in this admission check')
  process.exit(2)
}

const entries = readdirSync(migrationsDir)
const artifacts = entries.filter((name) => /\.(ts|js|mjs|cjs)$/.test(name))
const baselineMigrations = artifacts.filter((name) => name !== 'index.ts')
const baselineSnapshots = entries.filter((name) => name.endsWith('.json'))

if (baselineMigrations.length > 0 && baselineSnapshots.length === 0) {
  console.warn('AUTH-002_MIGRATION_GENERATION_BASELINE_WARNING: committed migration sources have no JSON schema snapshot')
  console.warn('Observed: 20250929_111647.ts exists; no migration JSON snapshot exists in W01 src/migrations/')
  console.warn('Impact: do not accept migrate:create output as an additive migration until the authoritative baseline/snapshot state is established')
  console.warn('Reference: docs/change-control/CC-W01-MIGRATION-BASELINE-DIFF-2026-09-20.md')
}
if (artifacts.length === 0) {
  console.error('AUTH-002_MIGRATION_GENERATION_READY: W01 src/migrations exists but contains no migration artifact')
  process.exit(2)
}

console.log(`AUTH-002_MIGRATION_GENERATION_ARTIFACT_PRESENT: ${artifacts.length}`)
console.log('W01 generation admission prerequisites pass; migration review and execution remain separate gates.')
