#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const worker = join(root, 'workers', 'W01-payload')
const pkgPath = join(worker, 'package.json')
const lockPath = join(worker, 'pnpm-lock.yaml')

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function run(command, args) {
  try {
    return execFileSync(command, args, { cwd: worker, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

if (!existsSync(pkgPath)) fail('workers/W01-payload/package.json is missing')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const rootLockPath = join(root, 'package-lock.json')
const rootLockText = existsSync(rootLockPath) ? readFileSync(rootLockPath, 'utf8') : ''
if (rootPackage.dependencies?.['@payloadcms/db-d1-sqlite'] || rootLockText.includes('@payloadcms/db-d1-sqlite')) {
  fail('Root package manifest/lockfile must not declare or resolve the Cloudflare D1 Payload adapter')
}
if (pkg.dependencies?.['@payloadcms/db-d1-sqlite']) fail('Cloudflare D1 Payload adapter must not be declared')
const lockText = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : ''
if (lockText.includes('@payloadcms/db-d1-sqlite')) fail('Cloudflare D1 Payload adapter must not remain in the W01 lockfile')
// Current W01 lock per workers/W01-payload/package.json (authoritative).
// W01 runtime and lockfile are Neon/PostgreSQL-only. The old Cloudflare template
// is retained solely as historical provenance, not as a dependency baseline.
const required = {
  payload: '3.94.1',
  '@payloadcms/next': '3.94.1',
  '@payloadcms/richtext-lexical': '3.94.1',
  '@payloadcms/plugin-redirects': '3.94.1',
  '@payloadcms/storage-r2': '3.94.1',
  '@payloadcms/ui': '3.94.1',
  next: '16.4.6',
  react: '19.3.1',
  'react-dom': '19.3.1',
  pg: '8.20.0',
  '@opennextjs/cloudflare': '1.20.18',
}

const postgresAdapterVersion = pkg.dependencies?.['@payloadcms/db-postgres']
if (postgresAdapterVersion !== '3.94.1' || pkg.devDependencies?.['@payloadcms/db-postgres']) {
  fail('W01 official PostgreSQL adapter must be a 3.94.1 runtime dependency')
}
if (pkg.devDependencies?.typescript !== '6.0.3') fail('W01 TypeScript must be exactly 6.0.3')
if (pkg.devDependencies?.wrangler !== '~4.167.0') fail('W01 Wrangler must be ~4.167.0')
if (pkg.devDependencies?.['eslint-config-next'] !== '16.4.6') fail('W01 eslint-config-next must be 16.4.6')
if (pkg.devDependencies?.['@types/react'] !== '19.3.0') fail('W01 @types/react must be 19.3.0')
if (pkg.devDependencies?.['@types/react-dom'] !== '19.3.0') fail('W01 @types/react-dom must be 19.3.0')
if (pkg.engines?.node !== '^22.23.5 || ^24.22.3 || >=26.13.1') fail('W01 Node engine range must match the Payload 3.94.x supported runtime')
for (const [name, expected] of Object.entries(required)) {
  const actual = pkg.dependencies?.[name]
  if (actual !== expected) fail(`${name} must be ${expected}; found ${actual ?? '<missing>'}`)
}

const rootRequired = {
  '@payloadcms/next': '3.94.1',
  '@payloadcms/richtext-lexical': '3.94.1',
  next: '16.4.6',
  payload: '3.94.1',
  react: '19.3.1',
  'react-dom': '19.3.1',
}
for (const [name, expected] of Object.entries(rootRequired)) {
  const actual = rootPackage.dependencies?.[name]
  if (actual !== expected) fail(`root ${name} must be ${expected}; found ${actual ?? '<missing>'}`)
}
if (rootPackage.devDependencies?.typescript !== '6.0.3') fail('root TypeScript must be exactly 6.0.3')
if (rootPackage.devDependencies?.['@types/react'] !== '19.3.0' ||
    rootPackage.devDependencies?.['@types/react-dom'] !== '19.3.0') {
  fail('root React type packages must be exactly 19.3.0')
}
if (rootPackage.devDependencies?.['@cloudflare/workers-types'] !== '5.20261124.1') {
  fail('root @cloudflare/workers-types must be exactly 5.20261124.1')
}
if (rootPackage.engines?.node !== '^22.23.5 || ^24.22.3 || >=26.13.1') {
  fail('root Node engine range must match the Payload 3.94.x supported runtime')
}

const [nodeMajor, nodeMinor, nodePatch] = process.versions.node.split('.').map(Number)
const nodeSupported =
  (nodeMajor === 22 && (nodeMinor > 23 || (nodeMinor === 23 && nodePatch >= 5))) ||
  (nodeMajor === 24 && (nodeMinor > 22 || (nodeMinor === 22 && nodePatch >= 3))) ||
  (nodeMajor >= 26 && (nodeMajor > 26 || nodeMinor > 13 || (nodeMinor === 13 && nodePatch >= 1)))
if (!nodeSupported) fail(`Node ^22.23.5, ^24.22.3, or >=26.13.1 is required for W01; current Node is ${process.versions.node}`)

// Windows exposes Corepack-managed pnpm through pnpm.ps1/pnpm.cmd.
// execFileSync cannot directly execute .cmd files on Windows, so invoke
// the command through the Windows command shell. On POSIX, execute pnpm directly.
const pnpmVersion = process.platform === 'win32'
  ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm --version'])
  : run('pnpm', ['--version'])

if (!pnpmVersion) fail('pnpm is not available; install a supported pnpm 9/10/11 toolchain before generating the lockfile')

const pnpmMajor = Number(pnpmVersion.split('.')[0])
if (![9, 10, 11].includes(pnpmMajor)) fail(`pnpm 9/10/11 is required; current pnpm is ${pnpmVersion}`)

if (existsSync(lockPath)) {
  console.log('PASS: W01 pnpm-lock.yaml exists')
  console.log(`LOCKFILE=${lockPath}`)
  console.log(`PNPM=${pnpmVersion}`)
  console.log('Next: run the W01 exact-resolution evidence probe and install verification.')
  process.exit(0)
}

console.log('BLOCKED: W01 pnpm-lock.yaml is missing.')
console.log('Generate it only from workers/W01-payload with the controlled Node/pnpm toolchain:')
console.log('  cd workers/W01-payload')
console.log('  pnpm install --lockfile-only --ignore-workspace')
console.log('Then commit workers/W01-payload/pnpm-lock.yaml and rerun the W01 schema evidence probe.')
process.exit(2)
