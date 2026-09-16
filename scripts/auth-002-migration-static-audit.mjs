import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = 'src/migrations'
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

const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')

const forbiddenPatterns = [
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?sessions\b/i,
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?session\b/i,
  /\b(createdAt|created_at)\b[\s\S]*\b(auth_session_state|sessions?)\b/i,
  /\b(expiresAt|expires_at)\b[\s\S]*\b(auth_session_state|sessions?)\b/i,
  /raw_access_token/i,
  /raw_refresh_token/i,
]

for (const pattern of forbiddenPatterns) {
  if (pattern.test(source)) fail(`forbidden or contradictory migration pattern detected: ${pattern}`)
}

if (!/auth_session_state/i.test(source)) {
  fail('migration artifact does not contain auth_session_state; cannot satisfy AUTH-002 extension migration scope')
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
  if (!new RegExp(`\\b${column}\\b`, 'i').test(source)) fail(`required extension column missing from migration artifact: ${column}`)
}

const requiredIndexes = [
  'auth_session_state_user_id_idx',
  'auth_session_state_device_id_idx',
  'auth_session_state_token_version_idx',
  'auth_session_state_revoked_at_idx',
]
for (const index of requiredIndexes) {
  if (!source.includes(index)) fail(`required extension index missing from migration artifact: ${index}`)
}

if (!/session_id[\s\S]{0,300}(PRIMARY\s+KEY|primaryKey)/i.test(source)) {
  fail('session_id primary-key intent is not statically provable from migration artifact')
}

console.log('AUTH-002_MIGRATION_STATIC_AUDIT_PASS')
console.log(`Audited ${files.length} migration artifact(s) for extension-table scope, required fields/indexes, native-field duplication, parallel Session tables, and raw secret persistence.`)
console.log('Static audit does not prove execution, D1 schema state, runtime behavior, or AUTH-002 GREEN.')
