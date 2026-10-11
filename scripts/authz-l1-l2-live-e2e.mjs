import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const baseUrl = (process.env.LUCKREAD_API_BASE_URL || 'https://luckread.com').replace(/\/$/, '')
const email = process.env.LUCKREAD_APP_AUTH_SMOKE_EMAIL || ''
const password = process.env.LUCKREAD_APP_AUTH_SMOKE_PASSWORD || ''
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ''
const apiToken = process.env.CLOUDFLARE_API_TOKEN || ''
const runId = process.env.GITHUB_RUN_ID || 'local'
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1'
const sourceSha = process.env.GITHUB_SHA || process.env.LUCKREAD_SOURCE_SHA || 'unknown'
const evidenceDir = resolve('artifacts/authz-l1-l2-live-e2e')
const evidencePath = resolve(evidenceDir, 'authz-l1-l2-live-e2e-' + runId + '-' + runAttempt + '.json')
const result = {
  evidenceType: 'LUCKREAD_AUTHZ_VERIFIED_USER_L2_LIVE_E2E',
  timestamp: new Date().toISOString(),
  baseUrl,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceSha,
  identityLogged: false,
  responseBodiesStored: false,
  credentialsLogged: false,
  cookiesStored: false,
  databaseRowsStored: false,
  checks: [],
  status: 'PENDING',
}

const check = (name, pass, facts = {}) => {
  result.checks.push({ name, pass, ...facts })
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (facts.httpStatus === undefined ? '' : ' HTTP ' + facts.httpStatus))
  return pass
}

const parseJson = async (response) => {
  try { return await response.json() } catch { return null }
}

const codeOf = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (typeof value.error?.code === 'string') return value.error.code
  if (typeof value.code === 'string') return value.code
  return null
}

const getSetCookies = (headers) => {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const value = headers.get('set-cookie')
  return value ? [value] : []
}

const cookieHeaderFrom = (headers) => getSetCookies(headers)
  .map((value) => value.split(';', 1)[0].trim())
  .filter((value) => value.includes('=') && value.slice(value.indexOf('=') + 1).length > 0)
  .join('; ')

const sqlQuote = (value) => "'" + String(value).replaceAll("'", "''") + "'"

const extractRows = (value) => {
  if (Array.isArray(value)) return value.flatMap(extractRows)
  if (!value || typeof value !== 'object') return []
  for (const key of ['results', 'result']) {
    if (!Array.isArray(value[key])) continue
    const items = value[key]
    if (items.length && items.every((item) =>
      item && typeof item === 'object' && !Array.isArray(item) &&
      !Object.prototype.hasOwnProperty.call(item, 'results') &&
      !Object.prototype.hasOwnProperty.call(item, 'result'))) {
      return items
    }
    return items.flatMap(extractRows)
  }
  return []
}

const readAuthorizationState = (userId) => {
  const now = new Date().toISOString()
  const sql = [
    'SELECT u.id AS userId, u.account_state AS accountState, u.email_verified AS emailVerified,',
    "EXISTS (SELECT 1 FROM role_assignments r WHERE r.subject_id = u.id AND r.role_id = 'user'",
    "  AND r.scope_type = 'global' AND r.scope_id IS NULL AND r.status = 'ACTIVE'",
    '  AND r.valid_from <= ' + sqlQuote(now) + ' AND (r.valid_until IS NULL OR ' + sqlQuote(now) + ' < r.valid_until)) AS hasBaseRole,',
    "EXISTS (SELECT 1 FROM role_assignments r WHERE r.subject_id = u.id AND r.role_id = 'verified_user'",
    "  AND r.scope_type = 'global' AND r.scope_id IS NULL AND r.status = 'ACTIVE'",
    '  AND r.valid_from <= ' + sqlQuote(now) + ' AND (r.valid_until IS NULL OR ' + sqlQuote(now) + ' < r.valid_until)) AS hasL2Role,',
    'COALESCE((SELECT v.role_version FROM role_authorization_versions v WHERE v.subject_id = u.id LIMIT 1), 0) AS roleVersion',
    'FROM "user" u WHERE u.id = ' + sqlQuote(userId) + ' LIMIT 1',
  ].join(' ')
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken }
  let stdout = ''
  try {
    stdout = execFileSync('npx', [
      '--yes', 'wrangler@4.116.0', 'd1', 'execute', 'luckread',
      '--remote', '--json', '--config', 'workers/W02-identity/wrangler.jsonc',
      '--command', sql,
    ], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 90000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error('D1_READ_FAILED')
  }

  let payload
  try {
    payload = JSON.parse(stdout)
  } catch {
    const firstArray = stdout.indexOf('[')
    if (firstArray < 0) throw new Error('D1_RESPONSE_INVALID')
    try { payload = JSON.parse(stdout.slice(firstArray)) } catch { throw new Error('D1_RESPONSE_INVALID') }
  }
  const rows = extractRows(payload)
  if (!rows.length) throw new Error('D1_SUBJECT_NOT_FOUND')
  const row = rows[0]
  if (String(row.userId) !== String(userId)) throw new Error('D1_SUBJECT_MISMATCH')
  return {
    accountActive: row.accountState === 'ACTIVE',
    emailVerified: row.emailVerified === true || Number(row.emailVerified) === 1,
    baseRoleActive: row.hasBaseRole === true || Number(row.hasBaseRole) === 1,
    verifiedUserRoleActive: row.hasL2Role === true || Number(row.hasL2Role) === 1,
    roleVersion: Number(row.roleVersion || 0),
  }
}

const finish = async () => {
  const failed = result.checks.filter((entry) => !entry.pass)
  result.summary = {
    total: result.checks.length,
    passed: result.checks.length - failed.length,
    failed: failed.length,
  }
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(evidencePath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  console.log('Sanitized evidence written: ' + evidencePath)
  console.log('Summary: ' + result.summary.passed + '/' + result.summary.total + ' checks passed; status=' + result.status)
  if (result.status !== 'PASS') process.exitCode = 1
}

if (!email || !password || !accountId || !apiToken) {
  result.status = 'BLOCKED_MISSING_GITHUB_ACTIONS_SECRETS'
  check('required_secrets_configured', false, {
    missing: [
      !email ? 'LUCKREAD_APP_AUTH_SMOKE_EMAIL' : null,
      !password ? 'LUCKREAD_APP_AUTH_SMOKE_PASSWORD' : null,
      !accountId ? 'CLOUDFLARE_ACCOUNT_ID' : null,
      !apiToken ? 'CLOUDFLARE_API_TOKEN' : null,
    ].filter(Boolean),
  })
  await finish()
} else {
  try {
    const loginResponse = await fetch(baseUrl + '/api/v1/auth/login', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        origin: new URL(baseUrl).origin,
      },
      body: JSON.stringify({ identity: email, credential: password }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
    const login = await parseJson(loginResponse)
    const user = login?.data?.user
    const userId = user && typeof user.id === 'string' ? user.id : ''
    const cookieHeader = cookieHeaderFrom(loginResponse.headers)
    const loginPass = loginResponse.status === 200 &&
      userId.length > 0 &&
      user.emailVerified === true &&
      cookieHeader.length > 0
    check('verified_qa_account_login', loginPass, {
      httpStatus: loginResponse.status,
      emailVerified: user?.emailVerified === true,
      browserCookiePresent: cookieHeader.length > 0,
      errorCode: codeOf(login),
      cfRayPresent: Boolean(loginResponse.headers.get('cf-ray')),
    })
    if (!loginPass) {
      result.status = 'FAIL'
      await finish()
    } else {
      let dbState = null
      let dbReadError = null
      try { dbState = readAuthorizationState(userId) } catch (error) {
        dbReadError = error instanceof Error ? error.message : 'D1_READ_FAILED'
      }
      const dbPass = !!dbState &&
        dbState.accountActive &&
        dbState.emailVerified &&
        dbState.baseRoleActive &&
        dbState.verifiedUserRoleActive &&
        Number.isSafeInteger(dbState.roleVersion) &&
        dbState.roleVersion >= 1
      check('d1_authoritative_l1_l2_assignments_and_version', dbPass, {
        accountActive: dbState?.accountActive === true,
        emailVerified: dbState?.emailVerified === true,
        baseRoleActive: dbState?.baseRoleActive === true,
        verifiedUserRoleActive: dbState?.verifiedUserRoleActive === true,
        roleVersionPresent: Number.isSafeInteger(dbState?.roleVersion) && dbState.roleVersion >= 1,
        roleVersion: Number.isSafeInteger(dbState?.roleVersion) ? dbState.roleVersion : null,
        readOutcome: dbState ? 'READ_OK' : dbReadError || 'READ_FAILED',
      })

      const targetId = 'authz-l12-probe-' + runId + '-' + randomUUID()
      const probeResponse = await fetch(baseUrl + '/api/v1/interactions/likes', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          origin: new URL(baseUrl).origin,
          cookie: cookieHeader,
          'Idempotency-Key': 'authz-l12-live-' + runId + '-' + randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId }),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })
      const probe = await parseJson(probeResponse)
      const probeCode = codeOf(probe)
      const gatePass = probeResponse.status === 404 && probeCode === 'NOT_FOUND'
      check('verified_user_passes_l2_gate_without_writing_business_data', gatePass, {
        httpStatus: probeResponse.status,
        errorCode: probeCode,
        cfRayPresent: Boolean(probeResponse.headers.get('cf-ray')),
        probeUsesGuaranteedMissingTarget: true,
      })

      result.status = result.checks.every((entry) => entry.pass) ? 'PASS' : 'FAIL'
      result.liveVerifiedUserRoleAndGateConfirmed = dbPass && gatePass
      await finish()
    }
  } catch (error) {
    result.status = 'FAIL'
    result.failureClass = error instanceof Error ? error.message : 'UNEXPECTED_FAILURE'
    await finish()
  }
}
