#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const repoRoot = path.resolve(root, '../..')
const baselineSha = process.env.BASELINE_SHA || '62aecc7a9343b9b4b6e374bacbd68381c46baa1c'
const outDir = path.join(repoRoot, 'artifacts/evidence/auth-002/user-profile-generation')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const run = (cmd, args, cwd, env = {}) => execFileSync(cmd, args, {
  cwd,
  env: { ...process.env, ...env },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})

const show = (sha, rel) => run('git', ['show', sha + ':' + rel], repoRoot)

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'luckread-user-profile-generation-'))
const stage1 = path.join(fixture, 'stage1')
const stage2 = path.join(fixture, 'stage2')
const stage3 = path.join(fixture, 'stage3')
for (const dir of [stage1, stage2, stage3]) {
  for (const sub of ['collections', 'db', 'migrations']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', strict: true, esModuleInterop: true, skipLibCheck: true },
  }))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module', private: true }))
}

const historicalUsers = show(baselineSha, 'workers/W01-payload/src/collections/Users.ts')
const historicalConfig = show(baselineSha, 'workers/W01-payload/src/payload.config.ts')
const currentUsers = fs.readFileSync(path.join(root, 'src/collections/Users.ts'), 'utf8')
const currentConfig = fs.readFileSync(path.join(root, 'src/payload.config.ts'), 'utf8')
const currentAuthSchema = fs.readFileSync(path.join(root, 'src/db/auth-session-state-schema.ts'), 'utf8')
const media = fs.readFileSync(path.join(root, 'src/collections/Media.ts'), 'utf8')

const setMigrationDir = (config, dir) => config.replace(
  "    migrationDir: path.resolve(dirname, 'migrations'),",
  '    migrationDir: ' + JSON.stringify(dir) + ',',
)
const setSchemaOut = (config, outputFile) => config.replace(
  "    migrationDir: path.resolve(dirname, 'migrations'),",
  "    migrationDir: path.resolve(dirname, 'migrations'),\n    generateSchemaOutputFile: " + JSON.stringify(outputFile) + ",",
)
const writeFixture = (dir, config, users, includeAuthSchema) => {
  fs.writeFileSync(path.join(dir, 'payload.config.ts'), config)
  fs.writeFileSync(path.join(dir, 'collections/Users.ts'), users)
  fs.writeFileSync(path.join(dir, 'collections/Media.ts'), media)
  if (includeAuthSchema) fs.writeFileSync(path.join(dir, 'db/auth-session-state-schema.ts'), currentAuthSchema)
}

writeFixture(stage1, setMigrationDir(historicalConfig, path.join(stage1, 'migrations')), historicalUsers, false)
writeFixture(stage2, setMigrationDir(historicalConfig, path.join(stage2, 'migrations')), historicalUsers, false)
writeFixture(stage3, setSchemaOut(setMigrationDir(currentConfig, path.join(stage3, 'migrations')), path.join(stage3, 'payload-generated-schema.ts')), currentUsers, true)

run('pnpm', ['exec', 'payload', 'migrate:create', 'E1_BASELINE_FIXTURE', '--skip-empty'], root, {
  PAYLOAD_CONFIG_PATH: path.join(stage1, 'payload.config.ts'),
  PAYLOAD_SECRET: 'generation-only-not-production',
})
const baselineJson = fs.readdirSync(path.join(stage1, 'migrations')).filter((f) => f.endsWith('.json')).sort()
if (baselineJson.length !== 1) throw new Error('Expected one baseline JSON snapshot; found ' + baselineJson.length)

const baselineSnapshot = path.join(stage1, 'migrations', baselineJson[0])
fs.copyFileSync(baselineSnapshot, path.join(stage2, 'migrations', 'baseline.json'))

writeFixture(stage2, setMigrationDir(currentConfig, path.join(stage2, 'migrations')), historicalUsers, true)
run('pnpm', ['exec', 'payload', 'migrate:create', 'E2_AUTH_SESSION_FIXTURE', '--skip-empty'], root, {
  PAYLOAD_CONFIG_PATH: path.join(stage2, 'payload.config.ts'),
  PAYLOAD_SECRET: 'generation-only-not-production',
})
const authTs = fs.readdirSync(path.join(stage2, 'migrations')).filter((f) => f.endsWith('.ts') && !f.endsWith('index.ts'))
if (authTs.length !== 1) throw new Error('Expected one generated AUTH fixture migration; found ' + authTs.length)
const authSnapshotFiles = fs.readdirSync(path.join(stage2, 'migrations')).filter((f) => f.endsWith('.json') && f !== 'baseline.json').sort()
if (authSnapshotFiles.length !== 1) throw new Error('Expected one AUTH post-schema snapshot; found ' + authSnapshotFiles.length)
fs.copyFileSync(path.join(stage2, 'migrations', authSnapshotFiles[0]), path.join(stage3, 'migrations', 'baseline.json'))

run('pnpm', ['exec', 'payload', 'generate:db-schema'], root, {
  PAYLOAD_CONFIG_PATH: path.join(stage3, 'payload.config.ts'),
  PAYLOAD_SECRET: 'generation-only-not-production',
})
if (!fs.existsSync(path.join(stage3, 'payload-generated-schema.ts'))) throw new Error('Expected generated schema probe')

run('pnpm', ['exec', 'payload', 'migrate:create', 'MIG-ENT-USER-PROFILE-V1', '--skip-empty'], root, {
  PAYLOAD_CONFIG_PATH: path.join(stage3, 'payload.config.ts'),
  PAYLOAD_SECRET: 'generation-only-not-production',
})
const stage3Ts = fs.readdirSync(path.join(stage3, 'migrations')).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
const generated = stage3Ts.find((f) => f.includes('MIG_ENT_USER_PROFILE_V1'.replace(/\W/g, '_')))
if (!generated) throw new Error('Expected exactly one generated User profile migration')
const stage3Json = fs.readdirSync(path.join(stage3, 'migrations')).filter((f) => f.endsWith('.json') && f !== 'baseline.json').sort()
if (stage3Json.length !== 1) throw new Error('Expected one User profile post-schema snapshot; found ' + stage3Json.length)

const migrationText = fs.readFileSync(path.join(stage3, 'migrations', generated), 'utf8')
const required = ['username', 'display_name', 'bio', 'avatar', 'locale', 'timezone', 'users_username_idx']
const forbidden = [
  'CREATE TABLE \`users_sessions\`',
  'CREATE TABLE \`users\`',
  'CREATE TABLE \`media\`',
  'CREATE TABLE \`payload_migrations\`',
  'CREATE TABLE \`payload_preferences\`',
  'CREATE TABLE \`payload_locked_documents',
  'auth_session_state',
  'raw_access_token',
  'raw_refresh_token',
]
for (const value of required) if (!migrationText.includes(value)) throw new Error('Required User-profile migration content missing: ' + value)
for (const value of forbidden) if (migrationText.includes(value)) throw new Error('Forbidden unrelated/auth extension content detected: ' + value)

fs.copyFileSync(path.join(stage3, 'migrations', generated), path.join(outDir, generated))
fs.copyFileSync(path.join(stage3, 'migrations', stage3Json[0]), path.join(outDir, stage3Json[0]))
fs.copyFileSync(path.join(stage2, 'migrations', authSnapshotFiles[0]), path.join(outDir, 'auth-session-post-schema-snapshot.json'))
fs.copyFileSync(baselineSnapshot, path.join(outDir, 'baseline-pre-auth-schema-snapshot.json'))
fs.writeFileSync(path.join(outDir, 'generation-manifest.json'), JSON.stringify({
  repository: 'wanghuinet/luckread',
  baselineSha,
  testedCommitSha: run('git', ['rev-parse', 'HEAD'], repoRoot).trim(),
  payloadVersion: '3.87.1',
  d1AdapterVersion: '3.87.1',
  generationCommand: 'pnpm exec payload migrate:create MIG-ENT-USER-PROFILE-V1 --skip-empty',
  strategy: 'baseline snapshot -> AUTH-002 post-schema snapshot -> current Users profile delta',
  generatedMigration: generated,
  generatedSnapshot: stage3Json[0],
  forbiddenUnrelatedTableRecreation: true,
  result: 'PASS',
}, null, 2) + '\n')
console.log('AUTH-002_USER_PROFILE_MIGRATION_GENERATION=PASS')
console.log(JSON.stringify({ generatedMigration: generated, generatedSnapshot: stage3Json[0] }, null, 2))
