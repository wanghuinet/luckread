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
  'auth-session-state-schema.json',
  'auth-session-state-indexes.json',
  'auth-session-state-foreign-keys.json',
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
const extensionSchema = readJson('auth-session-state-schema.json')
const extensionIndexes = readJson('auth-session-state-indexes.json')
const extensionForeignKeys = readJson('auth-session-state-foreign-keys.json')
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
const serializedEvidence = JSON.stringify({ d1Info, migration, catalog, users, indexes, foreignKeys, extensionSchema, extensionIndexes, extensionForeignKeys, provenance })
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
if (!catalogRows.some((row) => row?.type === 'table' && row?.name === 'auth_session_state')) fail('catalog does not prove a physical auth_session_state table')

const usersRows = unwrapRows(users)
const indexRows = unwrapRows(indexes)
const foreignKeyRows = unwrapRows(foreignKeys)
const extensionSchemaRows = unwrapRows(extensionSchema)
const extensionIndexRows = unwrapRows(extensionIndexes)
const extensionForeignKeyRows = unwrapRows(extensionForeignKeys)

if (!Array.isArray(usersRows)) fail('users-schema evidence is not row-shaped')
if (!Array.isArray(indexRows)) fail('users-indexes evidence is not row-shaped')
if (!Array.isArray(foreignKeyRows)) fail('users-foreign-keys evidence is not row-shaped')
if (!Array.isArray(extensionSchemaRows)) fail('auth-session-state-schema evidence is not row-shaped')
if (!Array.isArray(extensionIndexRows)) fail('auth-session-state-indexes evidence is not row-shaped')
if (!Array.isArray(extensionForeignKeyRows)) fail('auth-session-state-foreign-keys evidence is not row-shaped')

const expectedColumns = [
  { name: 'session_id', type: 'TEXT', notnull: 1, pk: 1 },
  { name: 'user_id', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'device_id', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'token_version', type: 'INTEGER', notnull: 1, pk: 0 },
  { name: 'refresh_credential_hash', type: 'TEXT', notnull: 1, pk: 0 },
  { name: 'revoked_at', type: 'TEXT', notnull: 0, pk: 0 },
  { name: 'last_seen_at', type: 'TEXT', notnull: 0, pk: 0 },
]

if (extensionSchemaRows.length !== expectedColumns.length) fail(`auth_session_state column count mismatch: expected ${expectedColumns.length}, found ${extensionSchemaRows.length}`)
for (const expected of expectedColumns) {
  const actual = extensionSchemaRows.find((row) => String(row?.name ?? '') === expected.name)
  if (!actual) fail(`missing auth_session_state column: ${expected.name}`)
  if (String(actual.type ?? '').toUpperCase() !== expected.type) fail(`auth_session_state.${expected.name} type mismatch`)
  if (Number(actual.notnull) !== expected.notnull) fail(`auth_session_state.${expected.name} nullability mismatch`)
  if (Number(actual.pk) !== expected.pk) fail(`auth_session_state.${expected.name} primary-key role mismatch`)
}

const extensionIndexNames = new Set(extensionIndexRows.map((row) => String(row?.name ?? '')))
for (const requiredIndex of [
  'auth_session_state_user_id_idx',
  'auth_session_state_device_id_idx',
  'auth_session_state_token_version_idx',
  'auth_session_state_revoked_at_idx',
]) {
  if (!extensionIndexNames.has(requiredIndex)) fail(`missing required auth_session_state index: ${requiredIndex}`)
}

const extensionPkCount = extensionSchemaRows.filter((row) => Number(row?.pk) > 0).length
if (extensionPkCount !== 1) fail(`auth_session_state primary-key column count must be 1, found ${extensionPkCount}`)
const extensionPk = extensionSchemaRows.find((row) => Number(row?.pk) === 1)
if (String(extensionPk?.name ?? '') !== 'session_id') fail('auth_session_state primary key must be session_id')

const forbiddenColumns = new Set(['raw_access_token', 'raw_refresh_token', 'password'])
for (const row of extensionSchemaRows) {
  if (forbiddenColumns.has(String(row?.name ?? '').toLowerCase())) fail(`forbidden auth_session_state column detected: ${row.name}`)
}
for (const row of catalogRows) {
  if (forbiddenColumns.has(String(row?.name ?? '').toLowerCase())) fail(`forbidden catalog object detected: ${row.name}`)
  const sql = String(row?.sql ?? '').toLowerCase()
  for (const forbiddenColumn of forbiddenColumns) {
    if (sql.includes(forbiddenColumn)) fail(`forbidden secret identifier detected in catalog SQL: ${forbiddenColumn}`)
  }
}

const sessionForeignKeys = extensionForeignKeyRows.filter((row) => String(row?.table ?? row?.table_name ?? '').toLowerCase().includes('session') || String(row?.from ?? '').toLowerCase() === 'session_id')
if (sessionForeignKeys.length > 0) fail('auth_session_state.session_id must not use a physical FK to embedded users.sessions[]')

const expectedEvidenceFiles = required.filter((file) => file !== 'manifest.json')
const manifestEvidence = manifest.evidenceFiles ?? {}
for (const file of expectedEvidenceFiles) {
  if (!manifestEvidence[file]) fail(`manifest missing hash entry for ${file}`)
  const actualHash = createHash('sha256').update(readFileSync(`${dir}/${file}`)).digest('hex')
  if (manifestEvidence[file] !== actualHash) fail(`evidence hash mismatch for ${file}`)
}

console.log('AUTH-002_SCHEMA_EVIDENCE_VALIDATION_PASS')
console.log('Validated artifact completeness, controlled-environment binding, dependency identity, database identity, Actions provenance, command success, users and auth_session_state physical schemas, required extension indexes, primary-key uniqueness, forbidden secret exclusion, embedded-session FK prohibition, and evidence hashes.')
console.log('This validator does not promote AUTH-002 or infer native session semantics; runtime correlation remains a separate evidence gate.')
