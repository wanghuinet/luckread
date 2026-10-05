#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const load = (relative) => JSON.parse(readFileSync(resolve(root, relative), 'utf8'))
const policy = {
  'luck01-identity': new Set(['D1-01']),
  'luck02-content': new Set(['D1-01', 'D1-02']), // D1-01 remains only for Payload/auth compatibility during migration.
  'luck03-social': new Set(['D1-02', 'D1-03']),
  'luck04-commerce': new Set(['D1-01', 'D1-03', 'D1-04']), // Transitional until Commerce/Governance data consolidation.
  'luck05-creator': new Set(),
  'luck06-async': new Set(),
}
const physicalDomainById = new Map([
  ['2f80471e-3756-49f9-8db1-7707a433ad64', 'D1-01'],
  ['6c342634-97f6-4248-9f4a-85772af4f22c', 'D1-02'],
  ['bda1d247-a371-4244-91ae-aef96034db7f', 'D1-03'],
  ['9bfb89a5-fbb5-45b1-a2ee-eab674b0d736', 'D1-04'],
])

const jsonc = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, '$1').replace(/,\s*([}\]])/g, '$1'))
let checked = 0

for (const [worker, allowed] of Object.entries(policy)) {
  const config = jsonc(resolve(root, 'workers', worker, 'wrangler.jsonc'))
  for (const entry of config.d1_databases ?? []) {
    const domain = physicalDomainById.get(entry.database_id)
    if (!domain) throw new Error(`${worker}: unregistered D1 id ${String(entry.database_id)}`)
    if (!allowed.has(domain)) throw new Error(`${worker}: D1 ${domain} outside allowed domain set`)
  }
  checked += 1
}

console.log('LUCKREAD_1_1_WORKER_D1_ACCESS_BOUNDARY=PASS')
console.log(JSON.stringify({ workerDirectories: checked, policy: Object.fromEntries(Object.entries(policy).map(([k,v]) => [k, [...v]])) }, null, 2))
