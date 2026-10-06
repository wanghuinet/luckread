#!/usr/bin/env node
/**
 * LuckRead Upstream Product Immutability Gate.
 * Payload and Better Auth are immutable upstream products.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const errors = []
const fail = (message) => errors.push(message)

const packages = [
  { name: 'payload', path: 'package.json', exact: true },
  { name: 'better-auth', path: 'workers/W02-identity/package.json', exact: true },
]

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error) { fail(path + ': unreadable/invalid JSON (' + error.message + ')'); return null }
}

function dependencies(doc) {
  return { ...(doc?.dependencies ?? {}), ...(doc?.devDependencies ?? {}), ...(doc?.peerDependencies ?? {}), ...(doc?.optionalDependencies ?? {}) }
}

function forbiddenSpec(spec) {
  return typeof spec === 'string' && /^(?:file:|link:|workspace:|git(?:\\+|:)|https?:)/i.test(spec)
}

for (const pkg of packages) {
  const doc = await readJson(pkg.path)
  if (!doc) continue
  const deps = dependencies(doc)
  const spec = deps[pkg.name]
  if (typeof spec !== 'string' || !spec) fail(pkg.path + ': missing dependency ' + pkg.name)
  else if (pkg.exact && !/^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(spec)) fail(pkg.path + ': ' + pkg.name + ' must use an exact upstream version; found ' + spec)
  else if (forbiddenSpec(spec)) fail(pkg.path + ': ' + pkg.name + ' must not resolve from a local/git/URL source: ' + spec)

  const serialized = JSON.stringify(doc)
  if (/patch-package/i.test(serialized)) fail(pkg.path + ': patch-package configuration is forbidden for Payload/Better Auth')
  for (const key of ['overrides', 'resolutions']) {
    const section = doc?.[key] ?? {}
    for (const product of ['payload', 'better-auth']) {
      if (Object.prototype.hasOwnProperty.call(section, product) && forbiddenSpec(section[product])) {
        fail(pkg.path + ': ' + key + '.' + product + ' is a forbidden local/remote replacement')
      }
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

console.log('Upstream Product Immutability CI GREEN — Payload and Better Auth remain immutable upstream dependencies')
if (errors.length) {
  console.error('Upstream Product Immutability CI RED:')
  for (const error of errors) console.error('  - ' + error)
  process.exit(1)
}
