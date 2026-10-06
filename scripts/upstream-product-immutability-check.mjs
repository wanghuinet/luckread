#!/usr/bin/env node
/** LuckRead Upstream Product Immutability Gate. */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const errors = []
const fail = (message) => errors.push(message)
const contractPath = 'contracts/payload/upstream-product-immutability.v1.json'

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { fail(path + ': unreadable/invalid JSON (' + error.message + ')'); return null }
}

function deps(doc) {
  return { ...(doc?.dependencies ?? {}), ...(doc?.devDependencies ?? {}), ...(doc?.peerDependencies ?? {}), ...(doc?.optionalDependencies ?? {}) }
}
function forbiddenSpec(spec) {
  return typeof spec === 'string' && /^(?:file:|link:|workspace:|git(?:\\+|:)|https?:)/i.test(spec)
}

const contract = await readJson(contractPath)
if (contract) {
  if (contract.version !== '1.0.0' || contract.status !== 'ACTIVE') fail(contractPath + ': must be ACTIVE version 1.0.0')
  const names = (contract.products ?? []).map((p) => p?.package)
  if (JSON.stringify(names) !== JSON.stringify(['payload', 'better-auth'])) fail(contractPath + ': product order/set must be payload, better-auth')
  if (contract.rules?.upstreamSourceImmutable !== true) fail(contractPath + ': upstreamSourceImmutable must be true')
  const forbidden = new Set(contract.rules?.forbiddenMechanisms ?? [])
  for (const required of ['source-modification', 'fork', 'vendoring', 'patch-package', 'monkey-patch', 'local-file-dependency']) {
    if (!forbidden.has(required)) fail(contractPath + ': missing forbidden mechanism ' + required)
  }
}

for (const pkg of [
  { name: 'payload', path: 'package.json' },
  { name: 'better-auth', path: 'workers/W02-identity/package.json' },
]) {
  const doc = await readJson(pkg.path)
  if (!doc) continue
  const spec = deps(doc)[pkg.name]
  if (typeof spec !== 'string' || !spec) fail(pkg.path + ': missing dependency ' + pkg.name)
  else if (!/^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(spec)) fail(pkg.path + ': ' + pkg.name + ' must use an exact upstream version; found ' + spec)
  else if (forbiddenSpec(spec)) fail(pkg.path + ': ' + pkg.name + ' must not resolve from a local/git/URL source: ' + spec)
  if (/patch-package/i.test(JSON.stringify(doc))) fail(pkg.path + ': patch-package configuration is forbidden')
  for (const key of ['overrides', 'resolutions']) {
    const section = doc?.[key] ?? {}
    for (const product of ['payload', 'better-auth']) {
      if (Object.prototype.hasOwnProperty.call(section, product) && forbiddenSpec(section[product])) fail(pkg.path + ': ' + key + '.' + product + ' is a forbidden replacement')
    }
  }
}

let tracked = ''
try { tracked = (await execFileAsync('git', ['ls-files'], { maxBuffer: 4 * 1024 * 1024 })).stdout }
catch (error) { fail('git ls-files failed: ' + error.message) }
const files = tracked.split(/\\r?\\n/).filter(Boolean)
const forbiddenPath = /(?:^|\\/)(?:patch|patches|vendor|vendored|fork|forks|third[-_ ]party|upstream)(?:\\/|$).*\\b(?:payload|better-auth)\\b|\\b(?:payload|better-auth)\\.(?:patch|diff)$/i
for (const file of files) {
  if (forbiddenPath.test(file)) fail('tracked upstream-copy/patch path is forbidden: ' + file)
  if (/node_modules[\\/]\\b(?:payload|better-auth)\\b/i.test(file)) fail('committed node_modules copy of upstream product is forbidden: ' + file)
  if (/^patch-package(?:\\.|\\/|$)/i.test(file)) fail('patch-package artifacts are forbidden: ' + file)
}

if (errors.length) {
  console.error('Upstream Product Immutability CI RED:')
  for (const error of errors) console.error('  - ' + error)
  process.exit(1)
}
console.log('Upstream Product Immutability CI GREEN — Payload and Better Auth remain immutable upstream dependencies')
