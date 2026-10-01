import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const base = String(process.env.MODERATION_BASE_URL || 'https://luckread.cn').replace(/\/$/, '')
const authBase = String(process.env.AUTH_BASE_URL || 'https://api.luckread.cn').replace(/\/$/, '')
const database = process.env.DATABASE_NAME_W01 || 'luckread'
const config = 'workers/W01-payload/wrangler.jsonc'
const runId = String(process.env.GITHUB_RUN_ID || Date.now())
const wrangler = process.env.WRANGLER_VERSION || '4.116.0'
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
if (!accountId || !apiToken) throw new Error('Cloudflare credentials required')

const email = 'moderation-l6-ready-' + runId + '-' + randomBytes(4).toString('hex') + '@example.com'
const username = 'mod_l6_ready_' + runId
const password = 'Evd-MOD-READY-' + randomBytes(24).toString('base64url') + '-Z9!'
const roleId = 'MODERATION-L6-READY-' + runId + '-' + randomBytes(4).toString('hex')
const registerKey = 'MODERATION-L6-READY-' + runId
let userId = ''

const sql = (v) => "'" + String(v).replaceAll("'", "''") + "'"
const d1 = (command) => JSON.parse(execFileSync('npx', ['--yes','wrangler@' + wrangler,'d1','execute',database,'--remote','--yes','--json','--config',config,'--command',command], {encoding:'utf8',env:process.env}))
const rows = (v) => Array.isArray(v) ? v.flatMap((x) => Array.isArray(x?.results) ? x.results : []) : (Array.isArray(v?.results) ? v.results : [])

async function post(path, body) {
  const r = await fetch(authBase + path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}
  return { status:r.status, data }
}

const cleanup = []
try {
  const registered = await post('/auth/register', {
    identityType:'email',
    identity:email,
    credential:password,
    username,
    consent:{purpose:'ACCOUNT_REGISTRATION',policyVersion:'PROD-2026-09-28.1'},
  })
  if (registered.status !== 201) throw new Error('register failed: HTTP ' + registered.status)
  userId = String(registered.data?.userId || '')
  if (!userId) throw new Error('register userId missing')

  const now = new Date().toISOString()
  d1("UPDATE users SET account_state='ACTIVE', account_state_version=COALESCE(account_state_version,0)+1 WHERE CAST(id AS TEXT)=" + sql(userId))
  d1("INSERT INTO role_assignments (id,subject_id,role_id,scope_type,scope_id,status,valid_from,valid_until,created_at,updated_at) VALUES (" +
    [roleId,userId,'moderator','global',null,'ACTIVE',now,null,now,now].map(sql).join(',') + ")")

  const login = await post('/auth/login', { identity:email, credential:password, deviceId:'moderation-l6-ready-' + runId })
  if (login.status !== 200) throw new Error('login failed: HTTP ' + login.status)
  if (login.data?.layer !== 'L6') throw new Error('expected L6, got ' + String(login.data?.layer))
  const token = String(login.data?.accessToken || '')
  if (!token) throw new Error('access token missing')
  console.log('::add-mask::' + token)
  console.log('::add-mask::' + password)

  const queue = await fetch(base + '/api/v1/admin/moderation/queue', {
    headers:{accept:'application/json',authorization:'Bearer ' + token},
  })
  const queueText = await queue.text()
  let queueBody = null
  try { queueBody = queueText ? JSON.parse(queueText) : null } catch {}
  if (queue.status !== 200) throw new Error('moderation queue authorization failed: HTTP ' + queue.status)

  console.log(JSON.stringify({
    status:'PASS',
    authentication:'Payload-native-register-login',
    reviewerLayer:'L6',
    moderationQueueAuthorization:'PASS',
    queueItemCount:Array.isArray(queueBody?.items) ? queueBody.items.length : null,
    synthetic:true,
    secretMaterialIncluded:false,
  }))

  d1("DELETE FROM role_assignments WHERE id=" + sql(roleId))
  cleanup.push('role')
  d1("DELETE FROM auth_session_state WHERE user_id=" + sql(userId))
  cleanup.push('auth_session_state')
  d1("DELETE FROM users_sessions WHERE CAST(_parent_id AS TEXT)=" + sql(userId))
  cleanup.push('users_sessions')
  d1("DELETE FROM consents WHERE CAST(actor_subject_id AS TEXT)=" + sql(userId) + " OR CAST(owner_subject_id AS TEXT)=" + sql(userId))
  cleanup.push('consents')
  d1("DELETE FROM auth_registration_envelopes WHERE idempotency_key=" + sql(registerKey))
  cleanup.push('registration_envelope')
  d1("DELETE FROM users WHERE CAST(id AS TEXT)=" + sql(userId))
  cleanup.push('user')
  console.log('MODERATION_NATIVE_L6_READINESS=PASS')
} catch (error) {
  try {
    if (roleId) d1("DELETE FROM role_assignments WHERE id=" + sql(roleId))
    if (userId) d1("DELETE FROM auth_session_state WHERE user_id=" + sql(userId))
    if (userId) d1("DELETE FROM users_sessions WHERE CAST(_parent_id AS TEXT)=" + sql(userId))
    if (userId) d1("DELETE FROM consents WHERE CAST(actor_subject_id AS TEXT)=" + sql(userId) + " OR CAST(owner_subject_id AS TEXT)=" + sql(userId))
    d1("DELETE FROM auth_registration_envelopes WHERE idempotency_key=" + sql(registerKey))
    if (userId) d1("DELETE FROM users WHERE CAST(id AS TEXT)=" + sql(userId))
  } catch (cleanupError) {
    console.error('cleanup failure: ' + String(cleanupError?.message || cleanupError))
    process.exitCode = 1
  }
  throw error
}
