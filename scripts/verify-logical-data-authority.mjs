#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

const root = process.cwd()
const contractPath = resolve(root, 'contracts/transport/logical-data-authority.v1.json')
const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
if (!Array.isArray(contract.tables) || contract.tables.length === 0) {
  throw new Error('Logical data authority contract must register at least one protected table')
}

const protectedTables = new Map()
for (const item of contract.tables) {
  const name = typeof item.name === 'string' ? item.name.toLowerCase() : ''
  if (!/^[a-z_][a-z0-9_]*$/.test(name) || !/^W\d\d$/.test(item.ownerWorker ?? '')) {
    throw new Error('Invalid logical table ownership entry: ' + JSON.stringify(item))
  }
  if (protectedTables.has(name)) throw new Error('Duplicate table owner entry: ' + name)
  protectedTables.set(name, item)
}

const stripComments = (source) => {
  let output = ''
  let state = 'code'
  let quote = ''
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    const next = source[i + 1]
    if (state === 'code') {
      if (char === '/' && next === '/') {
        output += '  '
        i += 1
        while (i + 1 < source.length && source[i + 1] !== '\n') {
          output += ' '
          i += 1
        }
        continue
      }
      if (char === '/' && next === '*') {
        output += '  '
        i += 1
        while (i + 1 < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
          output += source[i] === '\n' ? '\n' : ' '
          i += 1
        }
        if (i + 1 < source.length) {
          output += '  '
          i += 1
        }
        continue
      }
      if (char === "'" || char === '"' || char === '`') {
        state = 'quoted'
        quote = char
      }
      output += char
      continue
    }
    output += char
    if (char === '\\') {
      if (i + 1 < source.length) output += source[++i]
      continue
    }
    if (char === quote) {
      state = 'code'
      quote = ''
    }
  }
  return output
}

const identifier = '(?:"([a-zA-Z_][a-zA-Z0-9_$]*)"|\`([a-zA-Z_][a-zA-Z0-9_$]*)\`|\\[([a-zA-Z_][a-zA-Z0-9_$]*)\\]|([a-zA-Z_][a-zA-Z0-9_$]*))'
const accessPatterns = [
  { action: 'write', expression: new RegExp('\\b(?:INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|REPLACE\\s+INTO)\\s+' + identifier, 'gi') },
  { action: 'write', expression: new RegExp('\\bUPDATE(?:\\s+OR\\s+\\w+)?\\s+' + identifier, 'gi') },
  { action: 'write', expression: new RegExp('\\bDELETE\\s+FROM\\s+' + identifier, 'gi') },
  { action: 'read', expression: new RegExp('\\bFROM\\s+' + identifier, 'gi') },
  { action: 'read', expression: new RegExp('\\bJOIN\\s+' + identifier, 'gi') },
]

const extractAccesses = (source) => {
  const clean = stripComments(source)
  const accesses = []
  for (const pattern of accessPatterns) {
    for (const match of clean.matchAll(pattern.expression)) {
      const table = match.slice(1, 5).find(Boolean)
      if (!table) continue
      accesses.push({
        table: table.toLowerCase(),
        action: pattern.action,
        offset: match.index ?? 0,
        line: clean.slice(0, match.index ?? 0).split('\n').length,
      })
    }
  }
  return accesses
}

const accessViolation = (access, worker, relativePath, tablePolicy) => {
  if (access.action === 'write' && worker !== tablePolicy.ownerWorker) {
    return 'unauthorized logical write: ' + worker + ' -> ' + access.table + ' (owner ' + tablePolicy.ownerWorker + ')'
  }
  if (
    access.action === 'read' &&
    tablePolicy.readPolicy === 'OWNER_ONLY_WITH_EXCEPTIONS' &&
    worker !== tablePolicy.ownerWorker
  ) {
    const allowed = (tablePolicy.readExceptions ?? []).some((item) =>
      item.worker === worker && item.path === relativePath,
    )
    if (!allowed) {
      return 'unapproved cross-worker read: ' + worker + ' -> ' + access.table + ' (owner ' + tablePolicy.ownerWorker + ')'
    }
  }
  return null
}

// Self-tests ensure the rule checks mutations and the narrow contents read exception.
const selfChecks = [
  { access: { table: 'contents', action: 'write' }, worker: 'W03', path: 'workers/W03-content/src/index.ts', expected: false },
  { access: { table: 'contents', action: 'read' }, worker: 'W05', path: 'workers/W05-social/src/like-runtime.ts', expected: false },
  { access: { table: 'contents', action: 'read' }, worker: 'W05', path: 'workers/W05-social/src/index.ts', expected: true },
  { access: { table: 'contents', action: 'write' }, worker: 'W05', path: 'workers/W05-social/src/like-runtime.ts', expected: true },
  { access: { table: 'role_assignments', action: 'write' }, worker: 'W08', path: 'workers/W08-creator/src/worker.ts', expected: true },
  { access: { table: 'social_comments', action: 'write' }, worker: 'W05', path: 'workers/W05-social/src/comment-runtime.ts', expected: false },
]
for (const check of selfChecks) {
  const policy = protectedTables.get(check.access.table)
  const violation = accessViolation(check.access, check.worker, check.path, policy)
  if (Boolean(violation) !== check.expected) {
    throw new Error('Logical authority self-check failed for ' + JSON.stringify(check))
  }
}
const parsedSelfCheck = extractAccesses(
  '// INSERT INTO contents (must be ignored)\nconst sql = "SELECT id FROM contents";\nconst write = `INSERT INTO social_comments (id) VALUES (?)`',
)
if (
  parsedSelfCheck.filter((x) => x.table === 'contents' && x.action === 'write').length !== 0 ||
  parsedSelfCheck.filter((x) => x.table === 'contents' && x.action === 'read').length !== 1 ||
  parsedSelfCheck.filter((x) => x.table === 'social_comments' && x.action === 'write').length !== 1
) {
  throw new Error('SQL access parser self-check failed')
}

const workersRoot = resolve(root, 'workers')
const workerDirs = readdirSync(workersRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^W\d\d-/.test(entry.name))
  .map((entry) => entry.name)
  .sort()
const codeExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'])
const violations = []
let scannedFiles = 0
let guardedAccesses = 0

for (const directory of workerDirs) {
  const worker = directory.slice(0, 3)
  const sourceRoot = join(workersRoot, directory, 'src')
  try {
    if (!statSync(sourceRoot).isDirectory()) continue
  } catch {
    continue
  }
  const files = []
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const fullPath = join(path, entry.name)
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', '__tests__'].includes(entry.name)) walk(fullPath)
      } else if (
        codeExtensions.has(extname(entry.name)) &&
        !entry.name.includes('.test.') &&
        !entry.name.includes('.spec.')
      ) {
        files.push(fullPath)
      }
    }
  }
  walk(sourceRoot)

  for (const file of files) {
    scannedFiles += 1
    const source = readFileSync(file, 'utf8')
    const relativePath = file.slice(root.length + 1).split('\\').join('/')
    for (const access of extractAccesses(source)) {
      const tablePolicy = protectedTables.get(access.table)
      if (!tablePolicy) continue
      guardedAccesses += 1
      const violation = accessViolation(access, worker, relativePath, tablePolicy)
      if (violation) {
        violations.push(relativePath + ':' + access.line + ': ' + violation)
      }
    }
  }
}

if (violations.length > 0) {
  console.error('LOGICAL_DATA_AUTHORITY=FAIL')
  for (const violation of violations) console.error('- ' + violation)
  process.exitCode = 1
} else {
  console.log('LOGICAL_DATA_AUTHORITY=PASS')
}
console.log(JSON.stringify({
  workerDirectories: workerDirs.length,
  scannedRuntimeSourceFiles: scannedFiles,
  registeredTables: protectedTables.size,
  guardedSqlAccesses: guardedAccesses,
  readRestrictedTables: [...protectedTables.values()].filter((item) => item.readPolicy).map((item) => item.name),
  scope: 'partial-static-high-risk-table-registry',
}, null, 2))
