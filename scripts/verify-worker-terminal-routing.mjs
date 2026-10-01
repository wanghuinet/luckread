#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const contractPath = resolve(root, 'contracts/transport/public-worker-terminal-routing.v1.json')
const w01Path = resolve(root, 'workers/W01-payload/wrangler.jsonc')
const w03Path = resolve(root, 'workers/W03-content/wrangler.jsonc')
const w06Path = resolve(root, 'workers/W06-governance/wrangler.jsonc')

const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const w01 = JSON.parse(readFileSync(w01Path, 'utf8'))
const w03 = JSON.parse(readFileSync(w03Path, 'utf8'))
const w06 = JSON.parse(readFileSync(w06Path, 'utf8'))

const route = (family) => contract.routes.find((x) => x.operationIdFamily === family)
const content = route('content')
const moderation = route('moderation')
const auth = route('auth')

if (contract.topology.workerCount !== 12 || contract.topology.d1Count !== 4 || contract.topology.taskCount !== 25) {
  throw new Error('Terminal routing contract topology drift')
}
if (!content || content.ingressWorker !== 'W01' || content.terminalWorker !== 'W03') {
  throw new Error('Content terminal routing mismatch')
}
if (!moderation || moderation.ingressWorker !== 'W01' || moderation.terminalWorker !== 'W06') {
  throw new Error('Moderation terminal routing mismatch')
}
if (!auth || auth.ingressWorker !== 'W01') throw new Error('Auth ingress routing missing')

const service = (config, binding) => (config.services ?? []).find((x) => x.binding === binding)
if (service(w01, 'W03_CONTENT')?.service !== 'luckread-w03') {
  throw new Error('W01 W03_CONTENT binding mismatch')
}
if (service(w01, 'W06_MODERATION')?.service !== 'luckread-w06') {
  throw new Error('W01 W06_MODERATION binding mismatch')
}
if (service(w03, 'W01') || service(w06, 'W01')) {
  throw new Error('Business Worker must not bind back to W01 by default')
}
if (!Array.isArray(w03.d1_databases) || !w03.d1_databases.some((x) => x.binding === 'D1_02')) {
  throw new Error('W03 D1-02 binding missing')
}

console.log('WORKER_TERMINAL_ROUTING=PASS')
console.log(JSON.stringify({
  content: { ingress: content.ingressWorker, terminal: content.terminalWorker },
  moderation: { ingress: moderation.ingressWorker, terminal: moderation.terminalWorker },
  bindings: {
    W03_CONTENT: service(w01, 'W03_CONTENT')?.service,
    W06_MODERATION: service(w01, 'W06_MODERATION')?.service,
  },
}, null, 2))
