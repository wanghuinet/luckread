#!/usr/bin/env node
/**
 * Repository-wide upstream dependency integrity gate.
 * This is a static provenance guard, not a proof of byte-for-byte upstream equivalence.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const errors = []
const warnings = []
const fail = (message) => errors.push(message)
const warn = (message) => warnings.push(message)

const policyPath = 'contracts/dependencies/upstream-dependency-policy.v1.json'
const protectedPatterns = []
const globToRegExp = (glob) => new RegExp('^' + glob
  .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  .replace(/\*/g, '.*') + '$')

let policy
try {
  policy = JSON.parse(await readFile(policyPath, 'utf8'))
} catch (error) {
  fail(policyPath + ': unreadable/invalid JSON (' + error.message + ')')
}

if (!policy || policy.version !== '1.0.0' || policy.status !== 'ACTIVE') {
  fail(policyPath + ': policy must be ACTIVE version 1.0.0')
} else {
  for (const pattern of policy.protectedPackages ?? []) {
    protectedPatterns.push({ pattern, regex: globToRegExp(pattern) })
  }
}

const isProtected = (name) => protectedPatterns.some(({ regex }) => regex.test(name))
const sourceOverride = (value) => typeof value === 'string' &&
  /^(?:file:|link:|workspace:|git(?:\+|:)|https?:|github:)/i.test(value)

let tracked = []
try {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { maxBuffer: 8 * 1024 * 1024 })
  tracked = stdout.split('\0').filter(Boolean)
} catch (error) {
  fail('git ls-files failed: ' + error.message)
}

const manifests = tracked.filter((path) => path.endsWith('package.json'))
const lockfiles = tracked.filter((path) =>
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|npm-shrinkwrap\.json)$/.test(path))

if (manifests.length === 0) fail('No tracked package.json manifests found')

let dependencyCount = 0
const manifestReports = []

for (const path of manifests) {
  let doc
  try {
    doc = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    fail(path + ': invalid JSON (' + error.message + ')')
    continue
  }

  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
  const found = []
  for (const sectionName of sections) {
    const section = doc[sectionName] ?? {}
    for (const [name, spec] of Object.entries(section)) {
      dependencyCount++
      if (!isProtected(name)) continue
      found.push({ name, spec, section: sectionName })
      if (sourceOverride(spec)) {
        fail(path + ': protected dependency ' + name + ' uses non-registry source ' + spec)
      }
    }
  }

  for (const sectionName of ['overrides', 'resolutions']) {
    const section = doc[sectionName] ?? {}
    for (const [name, value] of Object.entries(section)) {
      if (isProtected(name) || Object.keys(value && typeof value === 'object' ? value : {}).some(isProtected)) {
        warn(path + ': review ' + sectionName + ' entry affecting protected dependency ' + name)
      }
    }
  }

  const scriptText = JSON.stringify(doc.scripts ?? {})
  if (/patch-package|pnpm\s+patch|yarn\s+patch/i.test(scriptText)) {
    fail(path + ': package scripts invoke dependency patching')
  }
  if (doc.pnpm?.patchedDependencies && Object.keys(doc.pnpm.patchedDependencies).length) {
    fail(path + ': pnpm.patchedDependencies is not allowed without an approved exception')
  }

  manifestReports.push({ path, protected: found })
}

const patchArtifacts = tracked.filter((path) =>
  /(?:^|\/)(?:patches?|patch-package)(?:\/|$)/i.test(path) ||
  /\.(?:patch|diff)$/i.test(path))
for (const path of patchArtifacts) {
  fail('tracked patch artifact/directory requires explicit review: ' + path)
}

const vendoredPaths = tracked.filter((path) =>
  /(?:^|\/)(?:vendor|vendored|third_party|third-party|forks?)(?:\/|$)/i.test(path))
for (const path of vendoredPaths) {
  warn('possible vendored/forked source requires provenance review: ' + path)
}

for (const path of lockfiles) {
  const content = await readFile(path, 'utf8')
  if (/patchedDependencies\s*:/m.test(content)) {
    fail(path + ': lockfile contains pnpm patchedDependencies')
  }
  if (/patch_hash:/m.test(content)) {
    fail(path + ': lockfile contains patch_hash entries')
  }
}

console.log('Upstream dependency inventory:')
console.log('  manifests: ' + manifests.length)
console.log('  lockfiles: ' + lockfiles.length)
console.log('  declared dependencies: ' + dependencyCount)
console.log('  protected package declarations: ' + manifestReports.reduce((n, item) => n + item.protected.length, 0))
for (const item of manifestReports) {
  if (item.protected.length) {
    console.log('  ' + item.path + ': ' + item.protected.map((x) => x.name + '@' + x.spec).join(', '))
  }
}
for (const warning of warnings) console.warn('REVIEW: ' + warning)

if (errors.length) {
  console.error('Upstream dependency integrity CI RED:')
  for (const error of errors) console.error('  - ' + error)
  process.exit(1)
}

console.log('Upstream dependency integrity CI GREEN — no prohibited patch/fork/local replacement was detected')
console.log('Coverage note: static path/manifest checks cannot prove copied source is byte-identical to upstream; see review warnings and upstream reconciliation records.')
