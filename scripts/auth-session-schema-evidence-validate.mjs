import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

const dir = 'artifacts/evidence/auth-002'
const required = [
  'd1-info.json',
  'migration-status.json',
  'catalog.json',
  'users-schema.json',
  'users-indexes.json',
  'users-foreign-keys.json',
  'provenance.json',
  'manifest.json',
]
const fail = (message) => {
  console.error(`AUTH-002_SCHEMA_EVIDENCE_REJECTED: ${message}`)
  process.exit(1)
}
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))
  } catch {
    fail(`invalid JSON artifact: ${file}`)
  }
}
for (const file of required) {
  if (!existsSync(`${dir}/${file}`)) fail(`missing artifact: ${file}`)
}

const manifest = readJson('manifest.json')
const provenance = readJson('provenance.json')
const migration = readJson('migration-status.json')
const catalog = readJson('catalog.json')
const users = readJson('users-schema.json')
const indexes = readJson('users-indexes.json')
const foreignKeys = readJson('users-foreign-keys.json')
const d1Info = readJson('d1-info.json')

if (manifest.environmentClass !== 'CONTROLLED_REMOTE_D1') fail('manifest environmentClass is not CONTROLLED_REMOTE_D1')
if (!manifest.databaseName || !manifest.testedCommitSha || !manifest.executedAt) fail('manifest missing required execution identity')
if (manifest.payloadVersion !== '3.87.1' || manifest.payloadLockedVersion !== '3.87.1') fail('manifest Payload version mismatch')
if (manifest.d1AdapterVersion !== '3.87.1' || manifest.d1AdapterLockedVersion !== '3.87.1') fail('manifest D1 adapter version mismatch')
if (typeof migration.exitCode !== 'number' || migration.exitCode !== 0) fail('remote migration evidence command did not succeed')
if (migration.databaseName !== manifest.databaseName) fail('migration evidence databaseName mismatch')

if (provenance.repository !== 'wanghuinet/luckread') fail('provenance repository mismatch')
if (provenance.workflow !== 'AUTH-002 Session Schema Evidence') fail('provenance workflow mismatch')
if (provenance.workflowSha !== manifest.testedCommitSha) fail('provenance workflow SHA mismatch')
if (provenance.databaseName !== manifest.databaseName) fail('provenance databaseName mismatch')
if (provenance.environmentClass !== manifest.environmentClass) fail('provenance environment mismatch')
if (!Number.isInteger(provenance.runId) || provenance.runId <= 0) fail('provenance runId missing or invalid')
if (!Number.isInteger(provenance.runAttempt) || provenance.runAttempt <= 0) fail('provenance runAttempt missing or invalid')

const forbiddenKeyPatterns = [
  /^(authorization|cookie|password|access[_-]?token|refresh[_-]?token|refresh[_-]?credential[_-]?hash)$/i,
]
const forbiddenValuePatterns = [
  /bearer\s+[a-z0-9._-]{20,}/i,
  /refresh[_-]?token\s*[:=]/i,
  /access[_-]?token\s*[:=]/i,
  /cookie\s*[:=]/i,
  /authorization\s*[:=]/i,
  /password\s*[:=]\s*["'][^"']+/i,
  /refresh[_-]?credential[_-]?hash\s*[:=]\s*["'][^"']+/i,
]
const walk = (value, path = '$') => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeyPatterns.some((pattern) => pattern.test(key))) fail(`forbidden sensitive field key detected at ${path}.${key}`)
    walk(child, `${path}.${key}`)
  }
}
walk({ d1Info, migration, catalog, users, indexes, foreignKeys })
const serializedEvidence = JSON.stringify({ d1Info, migration, catalog, users, indexes, foreignKeys, provenance })
for (const pattern of forbiddenValuePatterns) {
  if (pattern.test(serializedEvidence)) fail(`sensitive value pattern detected: ${pattern}`)
}

const unwrapRows = (value) => {
  if (Array.isArray(value)) return value
  if (value && Array.isArray(value.results)) return value.results
  if (value && Array.isArray(value.result)) return value.result
  return []
}
const catalogRows = unwrapRows(catalog)
if (!catalogRows.some((row) => row?.type === 'table' && row?.name === 'users')) fail('catalog does not prove a physical users table')
if (!Array.isArray(unwrapRows(users))) fail('users-schema evidence is not row-shaped')
if (!Array.isArray(unwrapRows(indexes))) fail('users-indexes evidence is not row-shaped')
if (!Array.isArray(unwrapRows(foreignKeys))) fail('users-foreign-keys evidence is not row-shaped')

const expectedEvidenceFiles = required.filter((file) => file !== 'manifest.json')
const manifestEvidence = manifest.evidenceFiles ?? {}
for (const file of expectedEvidenceFiles) {
  if (!manifestEvidence[file]) fail(`manifest missing hash entry for ${file}`)
  const actualHash = createHash('sha256').update(readFileSync(`${dir}/${file}`)).digest('hex')
  if (manifestEvidence[file] !== actualHash) fail(`evidence hash mismatch for ${file}`)
}

console.log('AUTH-002_SCHEMA_EVIDENCE_VALIDATION_PASS')
console.log('Validated artifact completeness, controlled-environment binding, dependency identity, database identity, Actions provenance, command success, users catalog presence, evidence hashes, and sensitive-field/value exclusion patterns.')
console.log('This validator does not promote AUTH-002 or infer native session semantics; runtime correlation remains a separate evidence gate.')
