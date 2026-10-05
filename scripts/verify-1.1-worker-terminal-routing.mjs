#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const load = (relative) => JSON.parse(readFileSync(resolve(root, relative), 'utf8'))
const workers = {
  identity: load('workers/luck01-identity/wrangler.jsonc'),
  content: load('workers/luck02-content/wrangler.jsonc'),
  social: load('workers/luck03-social/wrangler.jsonc'),
  commerce: load('workers/luck04-commerce/wrangler.jsonc'),
  creator: load('workers/luck05-creator/wrangler.jsonc'),
  async: load('workers/luck06-async/wrangler.jsonc'),
}

const names = Object.entries(workers).map(([role, config]) => [role, config.name])
const expected = new Map([
  ['identity', 'luck01-identity'],
  ['content', 'luck02-content'],
  ['social', 'luck03-social'],
  ['commerce', 'luck04-commerce'],
  ['creator', 'luck05-creator'],
  ['async', 'luck06-async'],
])
for (const [role, name] of names) {
  if (expected.get(role) !== name) throw new Error(`Worker name mismatch: ${role}=${name}`)
}

const service = (config, binding) => (config.services ?? []).find((x) => x.binding === binding)
if (service(workers.content, 'W02_AUTH')?.service !== 'luck01-identity') throw new Error('Content → Identity binding mismatch')
if (service(workers.content, 'W05_SOCIAL')?.service !== 'luck03-social') throw new Error('Content → Social binding mismatch')
if (service(workers.content, 'W06_MODERATION')?.service !== 'luck04-commerce') throw new Error('Content → Commerce/Governance binding mismatch')
if (service(workers.content, 'W07_SUBSCRIPTION')?.service !== 'luck04-commerce') throw new Error('Content → Commerce binding mismatch')
if (service(workers.commerce, 'W03_CONTENT_MODERATION')?.service !== 'luck02-content') throw new Error('Commerce/Governance → Content binding mismatch')

if (!workers.content.d1_databases?.some((x) => x.binding === 'D1_02')) throw new Error('Content D1-02 binding missing')
if (!workers.identity.d1_databases?.some((x) => x.binding === 'D1_01')) throw new Error('Identity D1-01 binding missing')
if (!workers.social.d1_databases?.some((x) => x.binding === 'DB')) throw new Error('Social D1 binding missing')
if (!workers.commerce.d1_databases?.some((x) => x.binding === 'D1_01')) throw new Error('Commerce compatibility D1 binding missing')
if (!workers.commerce.d1_databases?.some((x) => x.binding === 'D1_03')) throw new Error('Governance compatibility D1 binding missing')

console.log('LUCKREAD_1_1_WORKER_TERMINAL_ROUTING=PASS')
console.log(JSON.stringify({ workers: Object.fromEntries(names) }, null, 2))
