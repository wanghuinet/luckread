import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const remote = process.argv.includes('--remote')
const config = resolve(process.cwd(), 'workers/W02-identity/wrangler.jsonc')
const migration = resolve(process.cwd(), 'workers/W02-identity/migrations/0002_better_auth_core.sql')
const base = ['--yes', 'wrangler@4.116.0', 'd1', 'execute', 'luckread', '--config', config, remote ? '--remote' : '--local']
const run = (args) => execFileSync('npx', [...base, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const raw = run(['--json', '--command', 'PRAGMA table_info(users);'])
const parsed = JSON.parse(raw)
const rows = []
const walk = (value) => {
  if (Array.isArray(value)) return value.forEach(walk)
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value.results)) rows.push(...value.results)
  Object.values(value).forEach(walk)
}
walk(parsed)

if (!rows.some((row) => String(row.name) === 'email_verified')) {
  run(['--command', 'ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;'])
}
run(['--file', migration])
console.log(JSON.stringify({ result: 'APPLIED', target: remote ? 'REMOTE' : 'LOCAL', owner: 'W02', d1: 'D1-01', migration: '0002_better_auth_core.sql' }, null, 2))
