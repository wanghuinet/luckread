import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'

const base = String(process.env.AUTH_BASE_URL || 'https://api.luckread.cn').replace(/\/$/, '')
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
const runId = String(process.env.GITHUB_RUN_ID || Date.now())
const wrangler = process.env.WRANGLER_VERSION || '4.116.0'
const database = process.env.DATABASE_NAME_W01 || 'luckread'
const config = 'workers/W01-payload/wrangler.jsonc'

if (!accountId || !apiToken) throw new Error('Cloudflare credentials are required for the controlled native-auth fixture')

const suffix = 'MODL6-' + runId + '-' + randomBytes(5).toString('hex')
const email = 'moderation-e2e-' + suffix + '@example.com'
const username = 'mod_e2e_' + suffix.replaceAll('-', '').slice(-24)
const password = 'Evd-MOD-' + randomBytes(24).toString('base64url') + '-Z9!'
const deviceId = 'moderation-e2e-' + runId
const roleId = 'MODERATION-E2E-ROLE-' + runId + '-' + randomBytes(5).toString('hex')
const registerKey = 'MODERATION-E2E-' + runId + '-register'

const sqlString = (value) => "'" + String(value).replaceAll("'", "''") + "'"

function d1Json(command) {
  const output = execFileSync(
    'npx',
    [
      '--yes',
      'wrangler@' + wrangler,
      'd1',
      'execute',
      database,
      '--remote',
      '--json',
      '--yes',
      '--config',
      config,
      '--command',
      command,
    ],
    { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 },
  )
  return JSON.parse(output)
}

function rows(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => Array.isArray(item?.results) ? item.results : [])
  }
  return Array.isArray(value?.results) ? value.results : []
}

async function post(path, body, headers = {}) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}
  return { status: response.status, data }
}

const register = await post('/auth/register', {
  identityType: 'email',
  identity: email,
  credential: password,
  username,
  consent: {
    purpose: 'ACCOUNT_REGISTRATION',
    policyVersion: 'PROD-2026-09-28.1',
  },
}, { 'Idempotency-Key': registerKey })

if (register.status !== 201 || typeof register.data?.userId !== 'string') {
  throw new Error('native reviewer registration failed: HTTP ' + register.status + ' body=' + JSON.stringify(register.data))
}

const userId = String(register.data.userId)
appendFileSync(process.env.GITHUB_ENV, 'MODERATION_AUTH_USER_ID=' + userId + '\n')
appendFileSync(process.env.GITHUB_ENV, 'MODERATION_AUTH_EMAIL=' + email + '\n')
appendFileSync(process.env.GITHUB_ENV, 'MODERATION_ROLE_ID=' + roleId + '\n')

const now = new Date().toISOString()
d1Json(
  'UPDATE users SET account_state=\'ACTIVE\', account_state_version=COALESCE(account_state_version,0)+1 WHERE CAST(id AS TEXT)=' + sqlString(userId),
)
d1Json(
  'INSERT INTO role_assignments (id,subject_id,role_id,scope_type,scope_id,status,valid_from,valid_until,created_at,updated_at) VALUES (' +
    sqlString(roleId) + ',' + sqlString(userId) + ',\'moderator\',\'global\',NULL,\'ACTIVE\',' +
    sqlString(now) + ',NULL,' + sqlString(now) + ',' + sqlString(now) + ')',
)

const assignment = rows(
  d1Json('SELECT id,subject_id,role_id,status FROM role_assignments WHERE id=' + sqlString(roleId) + ' LIMIT 1'),
)[0]

if (
  !assignment ||
  String(assignment.subject_id) !== userId ||
  String(assignment.role_id) !== 'moderator' ||
  String(assignment.status) !== 'ACTIVE'
) {
  throw new Error('native reviewer moderator assignment was not established')
}

const login = await post('/auth/login', {
  identity: email,
  credential: password,
  deviceId,
})

const accessToken = login.data?.accessToken
if (login.status !== 200 || typeof accessToken !== 'string') {
  throw new Error('native reviewer login failed: HTTP ' + login.status + ' body=' + JSON.stringify(login.data))
}
if (login.data?.layer !== 'L6') {
  throw new Error('native reviewer layer mismatch: expected L6, got ' + String(login.data?.layer))
}

console.log('::add-mask::' + accessToken)
console.log('::add-mask::' + password)

appendFileSync(process.env.GITHUB_ENV, 'MODERATION_TOKEN=' + accessToken + '\n')

const artifactDir = 'artifacts/mapping-0/moderation-runtime-e2e'
mkdirSync(artifactDir, { recursive: true })
writeFileSync(
  artifactDir + '/native-reviewer.json',
  JSON.stringify({
    authentication: 'Payload-native-register-login',
    reviewerLayer: 'L6',
    synthetic: true,
    secretMaterialIncluded: false,
    reviewerUserIdRecorded: true,
  }, null, 2) + '\n',
)

console.log('MODERATION_NATIVE_REVIEWER=PASS')
