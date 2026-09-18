import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = 'workers/W01-payload/src/migrations'
const fail = (message) => {
  console.error(`AUTH-002_MIGRATION_STATIC_AUDIT_REJECTED: ${message}`)
  process.exit(1)
}

if (!existsSync(migrationsDir)) {
  console.error('AUTH-002_MIGRATION_STATIC_AUDIT_BLOCKED: src/migrations is absent; no migration artifact is available for audit.')
  process.exit(2)
}

const files = readdirSync(migrationsDir, { recursive: true })
  .filter((name) => /\.(ts|js|mjs|cjs)$/.test(name))
  .map((name) => join(migrationsDir, name))

if (files.length === 0) {
  console.error('AUTH-002_MIGRATION_STATIC_AUDIT_BLOCKED: src/migrations contains no executable migration artifact.')
  process.exit(2)
}

const sourceByFile = files.map((file) => ({
  file,
  source: readFileSync(file, 'utf8'),
}))
const source = sourceByFile.map(({ source }) => source).join('\n')
const normalized = source.toLowerCase()

if (!/export\s+(?:async\s+)?function\s+up\b/.test(source)) fail('migration artifact set has no exported up function')
if (!/export\s+(?:async\s+)?function\s+down\b/.test(source)) fail('migration artifact set has no exported down function')

const forbiddenParallelSessionTables = [
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?sessions["'`]?\b/i,
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?session["'`]?\b/i,
]
for (const pattern of forbiddenParallelSessionTables) {
  if (pattern.test(source)) fail(`parallel Session table detected: ${pattern}`)
}

const extensionMentions = []
let offset = 0
while (true) {
  const position = normalized.indexOf('auth_session_state', offset)
  if (position === -1) break
  extensionMentions.push(position)
  offset = position + 'auth_session_state'.length
}

if (extensionMentions.length === 0) {
  fail('migration artifact does not contain auth_session_state; cannot satisfy AUTH-002 extension migration scope')
}

const extensionWindows = extensionMentions.map((position) => normalized.slice(Math.max(0, position - 1800), Math.min(normalized.length, position + 3600)))
const extensionSource = extensionWindows.join('\n')

for (const forbidden of ['raw_access_token', 'raw_refresh_token', 'password', 'created_at', 'expires_at', 'createdat', 'expiresat']) {
  if (extensionSource.includes(forbidden)) {
    fail(`forbidden identifier appears in auth_session_state migration context: ${forbidden}`)
  }
}

const requiredColumns = [
  'session_id',
  'user_id',
  'device_id',
  'token_version',
  'refresh_credential_hash',
  'revoked_at',
  'last_seen_at',
]
for (const column of requiredColumns) {
  if (!new RegExp(`\\b${column}\\b`, 'i').test(extensionSource)) {
    fail(`required extension column missing from auth_session_state migration context: ${column}`)
  }
}

const requiredIndexes = [
  'auth_session_state_user_id_idx',
  'auth_session_state_device_id_idx',
  'auth_session_state_token_version_idx',
  'auth_session_state_revoked_at_idx',
]
for (const index of requiredIndexes) {
  if (!extensionSource.includes(index)) fail(`required extension index missing from migration context: ${index}`)
}

if (!/session_id[\s\S]{0,500}(primary\s+key|primarykey)/i.test(extensionSource)) {
  fail('session_id primary-key intent is not statically provable from auth_session_state migration context')
}

if (/foreign\s+key[\s\S]{0,500}(session_id|users\.sessions|sessions\.)/i.test(extensionSource)) {
  fail('physical foreign-key relationship for embedded native session identity detected')
}

console.log('AUTH-002_MIGRATION_STATIC_AUDIT_PASS')
console.log(`Audited ${files.length} migration artifact(s) for AUTH-002 extension scope, required fields/indexes, native-field duplication, parallel Session tables, forbidden secret persistence, and embedded-session FK prohibition.`)
console.log('Static audit does not prove migration execution, D1 schema state, runtime behavior, or AUTH-002 GREEN.')
