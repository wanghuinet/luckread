import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const payloadRoot = join(root, 'workers', 'W01-payload')
const gate1Only = process.argv.includes('--gate1')
const packageJsonPath = join(payloadRoot, 'package.json')
const payloadConfigPath = join(payloadRoot, 'src', 'payload.config.ts')
const usersPath = join(payloadRoot, 'src', 'collections', 'Users.ts')
const migrationsDir = join(payloadRoot, 'src', 'migrations')

let blocked = false
const fail = (message) => {
  console.error(`AUTH-002_SCHEMA_EVIDENCE_BLOCKED: ${message}`)
  blocked = true
}

for (const path of [packageJsonPath, payloadConfigPath, usersPath]) {
  if (!existsSync(path)) fail(`required W01 file missing: ${path.replace(`${root}/`, '')}`)
}

if (blocked) process.exit(1)

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const config = readFileSync(payloadConfigPath, 'utf8')
const users = readFileSync(usersPath, 'utf8')

if (pkg.dependencies?.payload !== '3.82.1') {
  fail(`W01 payload dependency must be exactly 3.82.1, found ${pkg.dependencies?.payload ?? 'missing'}`)
}
if (pkg.dependencies?.['@payloadcms/db-d1-sqlite'] !== '3.82.1') {
  fail(`W01 @payloadcms/db-d1-sqlite dependency must be exactly 3.82.1, found ${pkg.dependencies?.['@payloadcms/db-d1-sqlite'] ?? 'missing'}`)
}
if (!users.includes('auth: true')) fail('W01 Users collection does not enable native auth')
if (!config.includes('sqliteD1Adapter')) fail('W01 Payload D1 adapter is not configured')
if (!config.includes('push: false')) fail('W01 Payload migration safety requires push: false')
if (!config.includes('migrationDir')) fail('W01 Payload migrationDir is not configured')

if (!existsSync(migrationsDir)) {
  if (!gate1Only) {
    fail('W01 src/migrations is absent; runtime/migration evidence cannot be captured yet')
  } else {
    console.log('Gate-1 mode: W01 src/migrations is absent; this is allowed because Gate-1 is capture-only.')
  }
} else {
  const migrationFiles = []
  const collect = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) collect(path)
      else if (/\.(ts|js|mjs|cjs)$/.test(name)) migrationFiles.push(path)
    }
  }
  collect(migrationsDir)
  if (migrationFiles.length === 0) {
    if (!gate1Only) fail('W01 src/migrations exists but contains no migration artifact; runtime/migration evidence cannot be captured yet')
    else console.log('Gate-1 mode: W01 has no local migration artifact; remote migration state will be captured independently.')
  } else {
    console.log(`W01 migration artifacts discovered: ${migrationFiles.length}`)
  }
}

if (blocked) {
  console.error('AUTH-002 remains BLOCKED_NOT_GREEN; no schema fact has been inferred.')
  process.exit(1)
}

console.log(`AUTH-002 schema evidence preconditions: PASS (${gate1Only ? 'GATE1_CAPTURE_ONLY' : 'FULL'})`)
console.log(`W01 Payload: ${pkg.dependencies.payload}`)
console.log(`W01 D1 adapter: ${pkg.dependencies['@payloadcms/db-d1-sqlite']}`)
console.log('NOTE: preconditions passing does not itself prove D1 schema or promote AUTH-002.')
