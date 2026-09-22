#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const configPath = path.join(root, 'src', 'payload.config.ts')
const migrationsDir = path.join(root, 'src', 'migrations')

const failures = []

if (!fs.existsSync(configPath)) {
  failures.push('missing src/payload.config.ts')
} else {
  const config = fs.readFileSync(configPath, 'utf8')
  if (!/migrationDir:\s*path\.resolve\(dirname, ['"]\.\/migrations['"]\)/.test(config)) {
    failures.push('Payload migrationDir must resolve to ./migrations')
  }
  if (!/push:\s*false/.test(config)) {
    failures.push('Payload production admission requires push:false')
  }
}

if (!fs.existsSync(migrationsDir)) {
  failures.push('missing src/migrations directory')
} else {
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.ts') || name.endsWith('.js'))
  if (files.length === 0) failures.push('src/migrations contains no migration artifacts')
}

const report = {
  gate: 'MIGRATION-ADMISSION',
  status: failures.length ? 'BLOCKED' : 'READY',
  migrationDir: 'src/migrations',
  failures,
}

console.log(JSON.stringify(report, null, 2))
if (failures.length) process.exitCode = 1
