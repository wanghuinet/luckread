import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const dir = 'artifacts/evidence/auth-002/runtime'
const required = [
  'runtime-dependency.json',
  'runtime-session-creation.json',
  'runtime-validation.json',
  'runtime-logout.json',
  'extension-correlation.json',
  'runtime-negative-security.json',
  'runtime-concurrency.json',
  'runtime-manifest.json',
]
const fail = (message) => {
  console.error(`AUTH-002_RUNTIME_EVIDENCE_REJECTED: ${message}`)
  process.exit(1)
}
const readJson = (file) => {
  try { return JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) }
  catch { fail(`invalid JSON artifact: ${file}`) }
}
for (const file of required) {
  if (!existsSync(`${dir}/${file}`)) fail(`missing artifact: ${file}`)
}
const artifacts = Object.fromEntries(required.map((file) => [file, readJson(file)]))
const manifest = artifacts['runtime-manifest.json']
const dependency = artifacts['runtime-dependency.json']
const creation = artifacts['runtime-session-creation.json']
const validation = artifacts['runtime-validation.json']
const logout = artifacts['runtime-logout.json']
const extension = artifacts['extension-correlation.json']
const security = artifacts['runtime-negative-security.json']
const concurrency = artifacts['runtime-concurrency.json']

if (manifest.environmentClass !== 'CONTROLLED_REMOTE_D1') fail('environmentClass must be CONTROLLED_REMOTE_D1')
if (!manifest.databaseName || !manifest.workflow || !manifest.executedAt) fail('manifest missing execution identity')
if (!Number.isInteger(manifest.runId) || manifest.runId <= 0) fail('manifest runId invalid')
if (!Number.isInteger(manifest.runAttempt) || manifest.runAttempt <= 0) fail('manifest runAttempt invalid')
if (manifest.deploymentHeadSha !== manifest.testedCommitSha) fail('deployment head and tested commit differ')
const expectedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (manifest.testedCommitSha !== expectedCommit) fail('manifest testedCommitSha does not match checked-out commit')

if (dependency.repository !== 'wanghuinet/luckread') fail('repository mismatch')
if (dependency.testedCommitSha !== manifest.testedCommitSha) fail('dependency commit mismatch')
if (dependency.workerPath !== 'workers/W01-payload') fail('worker path mismatch')
if (dependency.payloadVersion !== '3.87.1') fail('Payload version mismatch')
if (dependency.d1AdapterVersion !== '3.87.1') fail('D1 adapter version mismatch')
if (!String(dependency.nodeVersion ?? '').startsWith('v24.')) fail('Node 24 required')
if (!dependency.lockfileReference) fail('lockfile reference missing')

for (const [name, artifact] of Object.entries({creation, validation, logout, extension, security, concurrency})) {
  if (artifact.testedCommitSha !== manifest.testedCommitSha) fail(`${name} commit mismatch`)
}
if (creation.nativeSidObserved !== true) fail('native sid not observed')
if (creation.userBindingObserved !== true) fail('user binding not observed')
if (creation.createdAtObserved !== true) fail('createdAt not observed')
if (creation.expiresAtObserved !== true) fail('expiresAt not observed')
if (creation.credentialRedacted !== true) fail('credential redaction missing')
if (validation.nativeSidValidation !== 'PASS') fail('native sid validation failed')
if (validation.userBindingValidation !== 'PASS') fail('native user binding validation failed')
if (validation.expiryDecision !== 'DENY_EXPIRED') fail('expired native session was not denied')
if (validation.authorizationDecision !== 'ALLOW_VALID') fail('valid native session was not authorized')
if (logout.logoutInvocation !== 'PASS') fail('logout did not pass')
if (!['REMOVED_OR_REVOKED', 'REVOKED', 'REMOVED'].includes(logout.nativeSessionRemovalOrRevocation)) fail('native session removal/revocation missing')
if (logout.postLogoutValidation !== 'DENY') fail('post logout was not denied')
if (logout.idempotentSecondLogout !== true) fail('second logout not idempotent')
if (extension.singleSessionIdentity !== true) fail('single session identity not proven')
if (extension.nativeSid !== extension.extensionLookupKey) fail('extension key mismatch')
if (extension.unsupportedDimensionsObserved !== true) fail('extension dimensions not observed')
if (extension.failClosedOnMismatch !== true) fail('mismatch was not fail-closed')
if (security.passed !== true) fail('negative security suite failed')
if (concurrency.singleWinnerInvariant !== true) fail('refresh single-winner invariant failed')
if (concurrency.actualResult !== 'PASS') fail('concurrency suite failed')
if (manifest.gate1?.accepted !== true) fail('Gate-1 not accepted in same execution')
if (manifest.cleanup?.completed !== true) fail('cleanup not complete')

const forbiddenKeyPatterns = /^(authorization|cookie|password|access[_-]?token|raw[_-]?access[_-]?token|refresh[_-]?token|raw[_-]?refresh[_-]?token|refresh[_-]?credential[_-]?hash|api[_-]?secret|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)$/i
const forbiddenValuePatterns = [
  /bearer\s+[A-Za-z0-9._-]{20,}/i,
  /(?:access|refresh)[_-]?token\s*[:=]\s*[A-Za-z0-9._-]{12,}/i,
  /(?:cookie|authorization)\s*[:=]\s*[^\s}]+/i,
  /password\s*[:=]\s*["'][^"']+["']/i,
]
const walk = (value, path = '$') => {
  if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeyPatterns.test(key)) fail(`forbidden sensitive key at ${path}.${key}`)
    walk(child, `${path}.${key}`)
  }
}
walk(artifacts)
const serialized = JSON.stringify(artifacts)
for (const pattern of forbiddenValuePatterns) {
  if (pattern.test(serialized)) fail(`forbidden sensitive value pattern detected: ${pattern}`)
}
if (!manifest.artifactHashes || typeof manifest.artifactHashes !== 'object') fail('artifact hashes missing')
for (const file of required.filter((name) => name !== 'runtime-manifest.json')) {
  const expectedHash = manifest.artifactHashes[file]
  if (!expectedHash) fail(`manifest hash missing for ${file}`)
  const actualHash = createHash('sha256').update(readFileSync(`${dir}/${file}`)).digest('hex')
  if (actualHash !== expectedHash) fail(`artifact hash mismatch for ${file}`)
}
console.log('AUTH-002_RUNTIME_EVIDENCE_VALIDATION_PASS')
