import { readFileSync, existsSync } from 'node:fs'

const dir = 'artifacts/evidence/auth-002'

const required = [
  'd1-info.json',
  'migration-status.json',
  'catalog.json',
  'users-schema.json',
  'users-indexes.json',
  'users-foreign-keys.json',
  'manifest.json',
]

const forbiddenValuePatterns = [
  /bearer\s+[a-z0-9._-]{20,}/i,
  /refresh[_-]?token\s*[:=]/i,
  /access[_-]?token\s*[:=]/i,
  /cookie\s*[:=]/i,
  /authorization\s*[:=]/i,
  /password\s*[:=]\s*['\"][^'\"]+/i,
  /refresh[_-]?credential[_-]?hash\s*[:=]\s*['\"][^'\"]+/i,
]

const fail = (message) => {
  console.error(`AUTH-002_SCHEMA_EVIDENCE_REJECTED: ${message}`)
  process.exit(1)
}

for (const file of required) {
  if (!existsSync(`${dir}/${file}`)) fail(`missing artifact: ${file}`)
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))
  } catch (error) {
    fail(`invalid JSON artifact: ${file}`)
  }
}

const manifest = readJson('manifest.json')
const migration = readJson('migration-status.json')
const catalog = readJson('catalog.json')
const users = readJson('users-schema.json')
const indexes = readJson('users-indexes.json')
const foreignKeys = readJson('users-foreign-keys.json')
const d1Info = readJson('d1-info.json')

if (manifest.environmentClass !== 'CONTROLLED_REMOTE_D1') {
  fail('manifest environmentClass is not CONTROLLED_REMOTE_D1')
}
if (!manifest.databaseName || !manifest.testedCommitSha || !manifest.executedAt) {
  fail('manifest missing required execution identity')
}
if (manifest.payloadVersion !== '3.87.1' || manifest.payloadLockedVersion !== '3.87.1') {
  fail('manifest Payload version mismatch')
}
if (manifest.d1AdapterVersion !== '3.87.1' || manifest.d1AdapterLockedVersion !== '3.87.1') {
  fail('manifest D1 adapter version mismatch')
}
if (typeof migration.exitCode !== 'number' || migration.exitCode !== 0) {
  fail('remote migration evidence command did not succeed')
}

const serialized = JSON.stringify({ d1Info, migration, catalog, users, indexes, foreignKeys, manifest })
for (const pattern of forbiddenValuePatterns) {
  if (pattern.test(serialized)) fail(`sensitive value pattern detected: ${pattern}`)
}

const unwrapRows = (value) => {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.results)) return value.results
  if (value && Array.isArray(value.result)) return value.result
  return []
}

const catalogRows = unwrapRows(catalog)
const userRows = unwrapRows(users)
const indexRows = unwrapRows(indexes)
const foreignKeyRows = unwrapRows(foreignKeys)

if (!catalogRows.some((row) => row?.type === 'table' && row?.name === 'users')) {
  fail('catalog does not prove a physical users table')
}
if (!Array.isArray(userRows)) fail('users-schema evidence is not row-shaped')
if (!Array.isArray(indexRows)) fail('users-indexes evidence is not row-shaped')
if (!Array.isArray(foreignKeyRows)) fail('users-foreign-keys evidence is not row-shaped')

console.log('AUTH-002_SCHEMA_EVIDENCE_VALIDATION_PASS')
console.log('Validated artifact completeness, controlled-environment binding, dependency lock identity, command success, users catalog presence, and sensitive-value exclusion patterns.')
console.log('This validator does not promote AUTH-002 or infer native session semantics; runtime correlation remains a separate evidence gate.')
