const need = (name) => {
  const value = process.env[name]
  if (!value) throw new Error('missing ' + name)
  return value
}

const base = need('W01_BASE_URL').replace(/\/$/, '')
const basicId = need('AUTH013_BASIC_USER_ID')
const operatorId = need('AUTH013_OPERATOR_USER_ID')
const basicRefresh = need('AUTH013_BASIC_REFRESH_TOKEN')
const operatorRefresh = need('AUTH013_OPERATOR_REFRESH_TOKEN')
const basicDevice = need('AUTH013_BASIC_DEVICE_ID')
const operatorDevice = need('AUTH013_OPERATOR_DEVICE_ID')
const fs = await import('node:fs')
const artifactDir = process.env.AUTH013_ARTIFACT_DIR ?? 'artifacts/mapping-0/auth-013-public-http-e2e'
fs.mkdirSync(artifactDir, { recursive: true })

async function post(path, body, token, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...extraHeaders,
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    throw new Error(path + ' returned non-JSON')
  }
  return { status: response.status, json }
}

function assertError(result, status, code, name) {
  if (result.status !== status) throw new Error(name + ': expected HTTP ' + status + ', got ' + result.status)
  if (result.json?.error?.code !== code) throw new Error(name + ': expected ' + code)
}

async function refresh(refreshToken, deviceId, label) {
  const result = await post('/auth/refresh', { refreshToken, deviceId })
  if (result.status !== 200 || typeof result.json?.accessToken !== 'string') {
    throw new Error(label + ' refresh failed')
  }
  console.log('::add-mask::' + result.json.accessToken)
  if (process.env.GITHUB_ENV) {
    const name = 'AUTH013_' + label.toUpperCase() + '_ACCESS_TOKEN'
    fs.appendFileSync(process.env.GITHUB_ENV, name + '=' + result.json.accessToken + '\n')
  }
  return result.json.accessToken
}

const checks = []
const basicToken = await refresh(basicRefresh, basicDevice, 'basic')
const operatorToken = await refresh(operatorRefresh, operatorDevice, 'operator')

assertError(
  await post('/v1/users/' + operatorId + '/account-state', {
    to: 'RESTRICTED',
    reason: 'AUTH-013 unauthenticated denial',
    actor: { id: 'client', type: 'admin' },
    permission: 'user.ban',
    approvalLevel: 'L8',
  }, undefined, { 'If-Match': '1' }),
  401,
  'UNAUTHENTICATED',
  'unauthenticated',
)
checks.push('unauthenticated_denial')

assertError(
  await post('/v1/users/' + operatorId + '/account-state', {
    to: 'RESTRICTED',
    reason: 'AUTH-013 missing If-Match',
  }, operatorToken),
  428,
  'PRECONDITION_REQUIRED',
  'missing If-Match',
)
checks.push('mandatory_if_match')

assertError(
  await post('/v1/users/' + basicId + '/account-state', {
    to: 'RESTRICTED',
    reason: 'AUTH-013 client authority injection',
    actor: { id: 'client', type: 'admin' },
    permission: 'user.ban',
    approvalLevel: 'L8',
  }, basicToken, { 'If-Match': '1' }),
  403,
  'PERMISSION_DENIED',
  'client authority injection',
)
checks.push('client_authority_injection_denial')

const success = await post('/v1/users/' + operatorId + '/account-state', {
  to: 'RESTRICTED',
  reason: 'AUTH-013 public operator transition',
  actor: { id: 'client', type: 'admin' },
  permission: 'user.ban',
  approvalLevel: 'L8',
}, operatorToken)

if (
  success.status !== 200 ||
  success.json?.from !== 'ACTIVE' ||
  success.json?.to !== 'RESTRICTED' ||
  typeof success.json?.auditEventId !== 'string' ||
  Object.keys(success.json).length !== 3
) throw new Error('successful transition response mismatch')
checks.push('public_operator_transition')

assertError(
  await post('/v1/users/' + operatorId + '/account-state', {
    to: 'ACTIVE',
    reason: 'AUTH-013 stale If-Match',
  }, operatorToken),
  412,
  'PRECONDITION_FAILED',
  'stale If-Match',
)
checks.push('stale_if_match_denial')

const result = {
  status: 'PASS',
  deploymentPublicPath: '/v1/users/{userId}/account-state',
  operationId: 'transitionAccountState',
  checks,
  syntheticFixture: true,
  secretsPersistedInArtifact: false,
}
fs.writeFileSync(artifactDir + '/public-http-result.json', JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
