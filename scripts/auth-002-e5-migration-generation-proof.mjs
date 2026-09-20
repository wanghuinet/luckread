#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const repoRoot = path.resolve(root, '../..')
const baselineSha = process.env.E5_BASELINE_SHA
if (!baselineSha) throw new Error('E5_BASELINE_SHA is required')

const outDir = path.join(repoRoot, 'artifacts/evidence/auth-002/e5-generation')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const run = (cmd, args, cwd, env = {}) => execFileSync(cmd, args, {
  cwd,
  env: { ...process.env, ...env },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

run('git', ['fetch', '--no-tags', 'origin', baselineSha, '--depth=1'], repoRoot)

const show = (sha, rel) => run('git', ['show', sha + ':' + rel], repoRoot)

const fixture = fs.mkdtempSync(path.join(root, '.e5-generation-'))
const stage1 = path.join(fixture, 'stage1')
const stage2 = path.join(fixture, 'stage2')

for (const dir of [stage1, stage2]) {
  for (const sub of ['collections', 'db', 'migrations']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, esModuleInterop: true, skipLibCheck: true } }))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module', private: true }))
}

const historicalUsers = show(baselineSha, 'workers/W01-payload/src/collections/Users.ts')
const historicalConfig = show(baselineSha, 'workers/W01-payload/src/payload.config.ts')
const currentConfig = fs.readFileSync(path.join(root, 'src/payload.config.ts'), 'utf8')
const currentAuthSchema = fs.readFileSync(path.join(root, 'src/db/auth-session-state-schema.ts'), 'utf8')
const media = fs.readFileSync(path.join(root, 'src/collections/Media.ts'), 'utf8')

const setMigrationDir = (config, dir) => config.replace(
  "    migrationDir: path.resolve(dirname, 'migrations'),",
  '    migrationDir: ' + JSON.stringify(dir) + ',',
)

const writeFixture = (dir, config, users, includeAuthSchema) => {
  fs.writeFileSync(path.join(dir, 'payload.config.ts'), config)
  fs.writeFileSync(path.join(dir, 'collections/Users.ts'), users)
  fs.writeFileSync(path.join(dir, 'collections/Media.ts'), media)
  if (includeAuthSchema) fs.writeFileSync(path.join(dir, 'db/auth-session-state-schema.ts'), currentAuthSchema)
}

writeFixture(stage1, setMigrationDir(historicalConfig, path.join(stage1, 'migrations')), historicalUsers, false)
writeFixture(stage2, setMigrationDir(currentConfig, path.join(stage2, 'migrations')), historicalUsers, true)

const runCreate = (dir, name) => run(
  'pnpm',
  ['exec', 'payload', 'migrate:create', name, '--skip-empty'],
  root,
  { PAYLOAD_CONFIG_PATH: path.join(dir, 'payload.config.ts') },
)

runCreate(stage1, 'E5_BASELINE_FIXTURE')
const stage1Json = fs.readdirSync(path.join(stage1, 'migrations')).filter((f) => f.endsWith('.json')).sort()
if (stage1Json.length !== 1) throw new Error('Expected exactly one generated baseline snapshot; found ' + stage1Json.length)
fs.copyFileSync(path.join(stage1, 'migrations', stage1Json[0]), path.join(stage2, 'migrations', 'baseline.json'))

runCreate(stage2, 'MIG-AUTH-002-SESSION-V1')
const stage2Dir = path.join(stage2, 'migrations')
const generated = fs.readdirSync(stage2Dir).filter((f) => f.endsWith('.ts') && f.includes('MIG-AUTH-002-SESSION-V1'))
if (generated.length !== 1) throw new Error('Expected exactly one generated AUTH-002 migration; found ' + generated.length)
const migrationFile = path.join(stage2Dir, generated[0])
const migrationText = fs.readFileSync(migrationFile, 'utf8')

const required = ['auth_session_state','session_id','user_id','device_id','token_version','refresh_credential_hash','revoked_at','last_seen_at','auth_session_state_user_id_idx','auth_session_state_device_id_idx','auth_session_state_token_version_idx','auth_session_state_revoked_at_idx']
const forbidden = ['CREATE TABLE `users`','CREATE TABLE `users_sessions`','CREATE TABLE `media`','CREATE TABLE `payload_migrations`','CREATE TABLE `payload_preferences`','CREATE TABLE `payload_locked_documents','raw_access_token','raw_refresh_token','`password`','created_at`','expires_at`']
for (const value of required) if (!migrationText.includes(value)) throw new Error('Required migration content missing: ' + value)
for (const value of forbidden) if (migrationText.includes(value)) throw new Error('Forbidden migration content detected: ' + value)

const postJson = fs.readdirSync(stage2Dir).filter((f) => f.endsWith('.json') && f !== 'baseline.json').sort()
if (postJson.length !== 1) throw new Error('Expected exactly one generated post-schema snapshot; found ' + postJson.length)

fs.copyFileSync(migrationFile, path.join(outDir, generated[0]))
fs.copyFileSync(path.join(stage2Dir, postJson[0]), path.join(outDir, postJson[0]))

const testedCommit = run('git', ['rev-parse', 'HEAD'], repoRoot).trim()
fs.writeFileSync(path.join(outDir, 'generation-manifest.json'), JSON.stringify({
  repository: 'wanghuinet/luckread',
  testedCommitSha: testedCommit,
  historicalBaselineSha: baselineSha,
  payloadVersion: '3.87.1',
  d1AdapterVersion: '3.87.1',
  generationCommand: 'pnpm exec payload migrate:create MIG-AUTH-002-SESSION-V1 --skip-empty',
  baselineGenerationCommand: 'pnpm exec payload migrate:create E5_BASELINE_FIXTURE --skip-empty',
  baselineConfigProvenance: baselineSha,
  extensionConfigProvenance: testedCommit,
  extensionSchemaSource: 'workers/W01-payload/src/db/auth-session-state-schema.ts',
  historicalUsersConfig: 'fields=[]',
  generatedMigration: generated[0],
  generatedSnapshot: postJson[0],
  result: 'PASS',
}, null, 2) + '\n')

console.log('AUTH-002_E5_MIGRATION_GENERATION_PROOF=PASS')
console.log(JSON.stringify({ generatedMigration: generated[0], generatedSnapshot: postJson[0], testedCommit }, null, 2))
