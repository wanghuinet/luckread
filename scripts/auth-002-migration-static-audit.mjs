import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = 'workers/W01-payload/src/migrations'
const fail = (message) => {
  console.error(`AUTH-002_W01_MIGRATION_STATIC_AUDIT_REJECTED: ${message}`)
  process.exit(1)
}

if (!existsSync(migrationsDir)) {
  console.error('AUTH-002_W01_MIGRATION_STATIC_AUDIT_BLOCKED: W01 migration directory is absent.')
  process.exit(2)
}

const files = readdirSync(migrationsDir, { recursive: true })
  .filter((name) => /\.(ts|js|mjs|cjs)$/.test(name))
  .map((name) => join(migrationsDir, name))

if (files.length === 0) {
  console.error('AUTH-002_W01_MIGRATION_STATIC_AUDIT_BLOCKED: W01 migration directory contains no executable artifact.')
  process.exit(2)
}

const sources = files.map((file) => ({ file, source: readFileSync(file, 'utf8') }))
const source = sources.map(({ source }) => source).join('\n')

if (!/export\s+(?:async\s+)?function\s+up\b/.test(source)) fail('migration artifact set has no exported up function')
if (!/export\s+(?:async\s+)?function\s+down\b/.test(source)) fail('migration artifact set has no exported down function')

if (!/CREATE TABLE[\s\S]{0,800}users_sessions/i.test(source)) {
  fail('W01 Payload native users_sessions persistence is not present in migration source')
}
if (!/CREATE TABLE[\s\S]{0,1200}users/i.test(source)) {
  fail('W01 Payload users persistence is not present in migration source')
}

const forbiddenParallelSessionTables = [
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?sessions["'`]?\b/i,
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?session["'`]?\b/i,
]
for (const pattern of forbiddenParallelSessionTables) {
  if (pattern.test(source)) fail(`parallel custom Session table detected: ${pattern}`)
}

for (const forbidden of ['raw_access_token', 'raw_refresh_token']) {
  if (source.toLowerCase().includes(forbidden)) {
    fail(`forbidden raw credential identifier appears in W01 migration source: ${forbidden}`)
  }
}

console.log('AUTH-002_W01_MIGRATION_STATIC_AUDIT_PASS')
console.log(`Audited ${files.length} W01 migration artifact(s) for native Payload session persistence, Users persistence, parallel-session prohibition, and raw-credential prohibition.`)
console.log('This static audit proves source shape only; it does not prove migration execution, remote D1 state, AUTH-002 extension equivalence, runtime behavior, or Mapping-0 GREEN.')
