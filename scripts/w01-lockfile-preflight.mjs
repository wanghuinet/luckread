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
const required = {
  payload: '3.82.1',
  '@payloadcms/db-d1-sqlite': '3.82.1',
  '@payloadcms/next': '3.82.1',
  '@payloadcms/richtext-lexical': '3.82.1',
  '@payloadcms/storage-r2': '3.82.1',
  '@payloadcms/ui': '3.82.1',
  next: '16.3.3',
  react: '19.2.6',
  'react-dom': '19.2.6',
  '@opennextjs/cloudflare': '^1.11.0',
}

for (const [name, expected] of Object.entries(required)) {
  const actual = pkg.dependencies?.[name]
  if (actual !== expected) fail(`${name} must be ${expected}; found ${actual ?? '<missing>'}`)
}

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 24) fail(`Node 24+ is required for W01; current Node is ${process.versions.node}`)

// On Windows, pnpm is normally exposed as pnpm.cmd. PowerShell can resolve
// the command interactively, while Node's execFileSync requires the .cmd shim.
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const pnpmVersion = run(pnpmCommand, ['--version'])
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
