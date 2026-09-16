import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const packageJsonPath = join(root, 'package.json')
const payloadConfigPath = join(root, 'src', 'payload.config.ts')
const usersPath = join(root, 'src', 'collections', 'Users.ts')
const migrationsDir = join(root, 'src', 'migrations')

const fail = (message) => {
  console.error(`AUTH-002_SCHEMA_EVIDENCE_BLOCKED: ${message}`)
  process.exitCode = 1
}

for (const path of [packageJsonPath, payloadConfigPath, usersPath]) {
  if (!existsSync(path)) fail(`required file missing: ${path.replace(`${root}/`, '')}`)
}

if (!existsSync(packageJsonPath) || !existsSync(payloadConfigPath) || !existsSync(usersPath)) process.exit()

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const config = readFileSync(payloadConfigPath, 'utf8')
const users = readFileSync(usersPath, 'utf8')

if (pkg.dependencies?.payload !== '3.87.1') {
  fail(`payload dependency must be exactly 3.87.1, found ${pkg.dependencies?.payload ?? 'missing'}`)
}
if (pkg.dependencies?.['@payloadcms/db-d1-sqlite'] !== '3.87.1') {
  fail(`@payloadcms/db-d1-sqlite dependency must be exactly 3.87.1, found ${pkg.dependencies?.['@payloadcms/db-d1-sqlite'] ?? 'missing'}`)
}
if (!users.includes('auth: true')) fail('Users collection does not enable native auth')
if (!config.includes('sqliteD1Adapter')) fail('Payload D1 adapter is not configured')
if (!config.includes('push: false')) fail('Payload migration safety requires push: false')
if (!config.includes('migrationDir')) fail('Payload migrationDir is not configured')

if (!existsSync(migrationsDir)) {
  fail('src/migrations is absent; actual Payload-generated migration/schema evidence cannot be captured yet')
}

const migrationFiles = []
const collect = (dir) => {
  for (const name of readdirSafe(dir)) {
    const path = join(dir, name)
    if (name.startsWith('.') || name === 'node_modules') continue
    if (existsSync(path) && requireStat(path).isDirectory()) collect(path)
    else if (/\.(ts|js|mjs|cjs)$/.test(name)) migrationFiles.push(path)
  }
}

function readdirSafe(dir) {
  try {
    return requireFs().readdirSync(dir)
  } catch {
    return []
  }
}
function requireFs() {
  return require('node:fs')
}
function requireStat(path) {
  return requireFs().statSync(path)
}

collect(migrationsDir)
if (migrationFiles.length === 0) {
  fail('src/migrations exists but contains no migration artifact; schema remains unverified')
}

console.log('AUTH-002 schema evidence preconditions: PASS')
console.log(`Payload: ${pkg.dependencies.payload}`)
console.log(`D1 adapter: ${pkg.dependencies['@payloadcms/db-d1-sqlite']}`)
console.log(`Migration artifacts discovered: ${migrationFiles.length}`)
console.log('NOTE: this probe does not promote AUTH-002; executed D1 schema inspection and applied migration evidence remain required.')
