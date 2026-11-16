#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const contractPath = resolve(root, 'contracts/transport/public-worker-terminal-routing.v1.json')
const w01Path = resolve(root, 'workers/W01-payload/wrangler.jsonc')
const w03Path = resolve(root, 'workers/W03-content/wrangler.jsonc')
const w06Path = resolve(root, 'workers/W06-governance/wrangler.jsonc')
const w05Path = resolve(root, 'workers/W05-social/wrangler.jsonc')
const w08Path = resolve(root, 'workers/W08-creator/wrangler.jsonc')
const w02Path = resolve(root, 'workers/W02-identity/wrangler.neon.jsonc')

const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
const w01 = JSON.parse(readFileSync(w01Path, 'utf8'))
const w03 = JSON.parse(readFileSync(w03Path, 'utf8'))
const w06 = JSON.parse(readFileSync(w06Path, 'utf8'))
const w05 = JSON.parse(readFileSync(w05Path, 'utf8'))
const w08 = JSON.parse(readFileSync(w08Path, 'utf8'))
const w02 = JSON.parse(readFileSync(w02Path, 'utf8'))

const route = (family) => contract.routes.find((x) => x.operationIdFamily === family)
const content = route('content')
const moderation = route('moderation')
const auth = route('auth')
const creator = route('creator')
const membership = route('membership')

if (contract.topology.workerCount !== 12 || contract.topology.d1Count !== 5 || contract.topology.taskCount !== 25) {
  throw new Error('Terminal routing contract topology drift')
}
if (!content || content.ingressWorker !== 'W01' || content.terminalWorker !== 'W03') {
  throw new Error('Content terminal routing mismatch')
}
if (!moderation || moderation.ingressWorker !== 'W01' || moderation.terminalWorker !== 'W06') {
  throw new Error('Moderation terminal routing mismatch')
}
if (!auth || auth.ingressWorker !== 'W01') throw new Error('Auth ingress routing missing')
if (!creator || creator.ingressWorker !== 'W01' || creator.terminalWorker !== 'W08') {
  throw new Error('Creator terminal routing mismatch')
}
if (!membership || membership.ingressWorker !== 'W01' || membership.terminalWorker !== 'W07') {
  throw new Error('Membership commerce terminal routing mismatch')
}
if (membership.auditWorker !== 'W06' || membership.auditTransportBinding !== 'W01-W06-moderation-http-binding.v1') {
  throw new Error('Membership plan durable audit routing mismatch')
}

const service = (config, binding) => (config.services ?? []).find((x) => x.binding === binding)
if (service(w01, 'W03_CONTENT')?.service !== 'luckread-w03') {
  throw new Error('W01 W03_CONTENT binding mismatch')
}
if (service(w05, 'W03_CONTENT')?.service !== 'luckread-w03') {
  throw new Error('W05 W03_CONTENT context binding mismatch')
}
if (service(w01, 'W06_MODERATION')?.service !== 'luckread-w06') {
  throw new Error('W01 W06_MODERATION binding mismatch')
}
if (service(w01, 'W08_CREATOR')?.service !== 'luckread-w08-creator') {
  throw new Error('W01 W08_CREATOR binding mismatch')
}
if (service(w01, 'W07_SUBSCRIPTION')?.service !== 'luckread-w07') {
  throw new Error('W01 W07_SUBSCRIPTION binding mismatch')
}
if (service(w08, 'W02_AUTH')?.service !== 'luckread-w02') {
  throw new Error('W08 W02_AUTH binding mismatch')
}
if ((w02.d1_databases ?? []).length !== 0 || w02.vars?.W02_DATABASE_DRIVER !== 'neon' ||
    !(w02.hyperdrive ?? []).some((x) => x.binding === 'HYPERDRIVE' && x.id === '0c53a1bb9bc0484bac146e8ae2d3158b')) {
  throw new Error('W02 must use the existing Neon D1-01 database with no production D1 binding')
}
if (service(w08, 'W01')) {
  throw new Error('Creator business Worker must not bind back to W01')
}
if ((w08.d1_databases ?? []).length !== 0 || w08.vars?.W08_DATABASE_DRIVER !== 'neon' ||
    !(w08.hyperdrive ?? []).some((x) => x.binding === 'HYPERDRIVE' && x.id === '0c53a1bb9bc0484bac146e8ae2d3158b')) {
  throw new Error('W08 must use the existing Neon D1-01 database with no production D1 binding')
}
if (service(w03, 'W01') || service(w06, 'W01')) {
  throw new Error('Business Worker must not bind back to W01 by default')
}
if ((w03.d1_databases ?? []).length !== 0 || w03.vars?.W03_CONTENT_READ_DRIVER !== 'neon' ||
    !(w03.hyperdrive ?? []).some((x) => x.binding === 'HYPERDRIVE_CONTENT_PG' && x.id === 'c55183e1cc3446409c9c1075832c6615')) {
  throw new Error('W03 content authority must use the existing Neon D1-02 Hyperdrive with no D1 binding')
}

console.log('WORKER_TERMINAL_ROUTING=PASS')
console.log(JSON.stringify({
  content: { ingress: content.ingressWorker, terminal: content.terminalWorker },
  moderation: { ingress: moderation.ingressWorker, terminal: moderation.terminalWorker },
  creator: { ingress: creator.ingressWorker, terminal: creator.terminalWorker },
  membership: { ingress: membership.ingressWorker, terminal: membership.terminalWorker },
  bindings: {
    W03_CONTENT: service(w01, 'W03_CONTENT')?.service,
    W05_W03_CONTENT: service(w05, 'W03_CONTENT')?.service,
    W06_MODERATION: service(w01, 'W06_MODERATION')?.service,
    W08_CREATOR: service(w01, 'W08_CREATOR')?.service,
    W07_SUBSCRIPTION: service(w01, 'W07_SUBSCRIPTION')?.service,
    W08_W02_AUTH: service(w08, 'W02_AUTH')?.service,
    W02_DATABASE_DRIVER: w02.vars?.W02_DATABASE_DRIVER,
    W02_PRODUCTION_D1_BINDINGS: (w02.d1_databases ?? []).length,
    W03_DATABASE_DRIVER: w03.vars?.W03_CONTENT_READ_DRIVER,
    W03_PRODUCTION_D1_BINDINGS: (w03.d1_databases ?? []).length,
  },
}, null, 2))
