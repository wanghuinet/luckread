#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const worker = join(root, 'workers', 'luck02-content')
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

if (!existsSync(pkgPath)) fail('workers/luck02-content/package.json is missing')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
// Current Content Worker lock per workers/luck02-content/package.json (authoritative).
// The upstream Cloudflare-template observation (3.82.1 family) is recorded
// separately in workers/luck02-content/PAYLOAD-CLOUDFLARE-D1-UPSTREAM-MANIFEST.md.
const required = {
  payload: '3.90.2',
  '@payloadcms/db-d1-sqlite': '3.90.2',
  '@payloadcms/next': '3.90.2',
  '@payloadcms/richtext-lexical': '3.90.2',
  '@payloadcms/storage-r2': '3.90.2',
  '@payloadcms/ui': '3.90.2',
  next: '16.2.6',
  react: '19.2.6',
  'react-dom': '19.2.6',
  '@opennextjs/cloudflare': '1.20.1',
}

for (const [name, expected] of Object.entries(required)) {
  const actual = pkg.dependencies?.[name]
  if (actual !== expected) fail(`${name} must be ${expected}; found ${actual ?? '<missing>'}`)
}

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 24) fail(`Node 24+ is required for the Content Worker; current Node is ${process.versions.node}`)

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
  console.log('PASS: Content Worker pnpm-lock.yaml exists')
  console.log(`LOCKFILE=${lockPath}`)
  console.log(`PNPM=${pnpmVersion}`)
  console.log('Next: run the W01 exact-resolution evidence probe and install verification.')
  process.exit(0)
}

console.log('BLOCKED: Content Worker pnpm-lock.yaml is missing.')
console.log('Generate it only from workers/luck02-content with the controlled Node/pnpm toolchain:')
console.log('  cd workers/luck02-content')
console.log('  pnpm install --lockfile-only --ignore-workspace')
console.log('Then commit workers/luck02-content/pnpm-lock.yaml and rerun the Content Worker schema evidence probe.')
process.exit(2)
