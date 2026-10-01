#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'

const root = process.cwd()
const contract = JSON.parse(
  readFileSync(resolve(root, 'contracts/transport/worker-d1-access-boundary.v1.json'), 'utf8'),
)

const jsonc = (path) => {
  let text = readFileSync(path, 'utf8')
  text = text.replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, '$1')
  text = text.replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(text)
}

const workersRoot = resolve(root, 'workers')
const dirs = readdirSync(workersRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^W\d\d-/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const domainById = Object.fromEntries(
  Object.entries(contract.physicalD1Registry)
    .filter(([, id]) => typeof id === 'string' && id.length > 0)
    .map(([domain, id]) => [id, domain]),
)

const suspiciousBinding = /\b(D1(?:_0[1-4])?|DB)\b/g
const codeExts = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'])

let checkedConfigs = 0
let checkedCodeFiles = 0

for (const dir of dirs) {
  const workerId = dir.slice(0, 3)
  const workerPolicy = contract.workers[workerId]
  if (!workerPolicy) throw new Error(`Missing D1 policy for ${workerId}`)

  const workerDir = join(workersRoot, dir)
  const wranglerPath = join(workerDir, 'wrangler.jsonc')
  const configExists = statSync(workerDir).isDirectory() && (() => {
    try { return statSync(wranglerPath).isFile() } catch { return false }
  })()

  if (configExists) {
    checkedConfigs += 1
    const config = jsonc(wranglerPath)
    for (const entry of config.d1_databases ?? []) {
      const domain = domainById[entry.database_id]
      if (!domain) {
        throw new Error(`${workerId}: unregistered D1 id ${String(entry.database_id)}`)
      }
      if (!workerPolicy.allowedDomains.includes(domain)) {
        throw new Error(`${workerId}: D1 ${domain} is outside its allowed domain set`)
      }
    }
  }

  const files = []
  const walk = (dirPath) => {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const path = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') walk(path)
      } else if (codeExts.has(extname(entry.name))) {
        files.push(path)
      }
    }
  }
  walk(workerDir)

  for (const path of files) {
    checkedCodeFiles += 1
    const source = readFileSync(path, 'utf8')
    const bindings = new Set()
    for (const match of source.matchAll(suspiciousBinding)) bindings.add(match[1])
    for (const binding of bindings) {
      const declaredBindings = new Set(
        (configExists ? (jsonc(wranglerPath).d1_databases ?? []) : []).map((x) => x.binding),
      )
      if (!declaredBindings.has(binding)) {
        const relative = path.slice(root.length + 1)
        throw new Error(`${workerId}: raw D1 binding ${binding} used by ${relative} but not declared in wrangler.jsonc`)
      }
    }
  }
}

console.log('WORKER_D1_ACCESS_BOUNDARY=PASS')
console.log(JSON.stringify({
  workerDirectories: dirs.length,
  checkedConfigs,
  checkedCodeFiles,
  physicalD1Registry: domainById,
}, null, 2))
