import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const fail = (message) => {
  console.error(`AUTH-002_MIGRATION_GENERATION_BLOCKED: ${message}`)
  process.exit(1)
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const config = readFileSync(join(root, 'src', 'payload.config.ts'), 'utf8')
const users = readFileSync(join(root, 'src', 'collections', 'Users.ts'), 'utf8')

if (pkg.dependencies?.payload !== '3.87.1') fail('Payload dependency is not exactly 3.87.1')
if (pkg.dependencies?.['@payloadcms/db-d1-sqlite'] !== '3.87.1') fail('D1 adapter dependency is not exactly 3.87.1')
if (!config.includes('sqliteD1Adapter')) fail('sqliteD1Adapter is not configured')
if (!config.includes('push: false')) fail('push:false is required')
if (!config.includes('migrationDir')) fail('migrationDir is not configured')
if (!users.includes('auth: true')) fail('Users native auth is not enabled')

const migrationsDir = join(root, 'src', 'migrations')
if (!existsSync(migrationsDir)) {
  console.error('AUTH-002_MIGRATION_GENERATION_READY: configuration is admissible, but no migration artifact exists yet')
  console.error('NEXT: generate with the repository Payload CLI; do not hand-author DDL and do not apply a migration in this admission check')
  process.exit(2)
}

const entries = readdirSync(migrationsDir)
const artifacts = entries.filter((name) => /\.(ts|js|mjs|cjs)$/.test(name))
if (artifacts.length === 0) {
  console.error('AUTH-002_MIGRATION_GENERATION_READY: src/migrations exists but contains no migration artifact')
  process.exit(2)
}

console.log(`AUTH-002_MIGRATION_GENERATION_ARTIFACT_PRESENT: ${artifacts.length}`)
console.log('Generation admission prerequisites pass; migration review and execution remain separate gates.')
