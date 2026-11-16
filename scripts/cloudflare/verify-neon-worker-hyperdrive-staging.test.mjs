import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ANALYTICS_RUNTIME_GUARD,
  STAGED_WORKERS,
  inspectNeonWorkerHyperdriveStaging,
  verifyWorkerConfig,
} from './verify-neon-worker-hyperdrive-staging.mjs'

test('all six admitted Worker configs target the matching Neon Hyperdrive and match each expected D1 binding state', async () => {
  const result = await inspectNeonWorkerHyperdriveStaging()
  assert.equal(result.status, 'SOURCE_CONFIG_STAGED_ONLY')
  assert.equal(result.stagedWorkerCount, 6)
  assert.equal(result.expectedD1BindingSetsVerified, true)
  assert.deepEqual(result.workers.find((worker) => worker.worker === 'W05')?.d1FallbackBindings, [])
  assert.equal(result.runtimeDriversEnabled, false)
  assert.equal(result.productionDeployPerformed, false)
  assert.equal(result.productionCutoverPerformed, false)
  assert.equal(result.businessDataImported, false)
  assert.deepEqual(result.workers.map((worker) => worker.worker), ['W01', 'W02', 'W03', 'W05', 'W07', 'W08'])
})

test('rejects a Hyperdrive resource id that does not match the authoritative domain', () => {
  const expected = STAGED_WORKERS.find((worker) => worker.worker === 'W03')
  assert.throws(
    () => verifyWorkerConfig({
      name: expected.script,
      d1_databases: expected.d1Bindings.map((binding) => ({ binding })),
      hyperdrive: [{ binding: expected.binding, id: 'wrong-resource-id' }],
    }, expected),
    /Hyperdrive resource target drifted/,
  )
})

test('continues to require W07 rollback bindings while W05 is production D1-free', () => {
  const expected = STAGED_WORKERS.find((worker) => worker.worker === 'W07')
  assert.throws(
    () => verifyWorkerConfig({
      name: expected.script,
      d1_databases: [{ binding: 'D1_04' }],
      hyperdrive: [{ binding: expected.binding, id: expected.hyperdriveId }],
    }, expected),
    /production D1 binding set does not match the expected cutover state/,
  )
})

test('requires W01/W02 Neon mode with existing rollback bindings and W08 Neon-only production config', () => {
  const w02 = STAGED_WORKERS.find((worker) => worker.worker === 'W02')
  const w02Config = {
    name: w02.script,
    d1_databases: w02.d1Bindings.map((binding) => ({ binding })),
    hyperdrive: [{ binding: w02.binding, id: w02.hyperdriveId }],
    vars: { W02_DATABASE_DRIVER: 'neon' },
  }
  assert.doesNotThrow(() => verifyWorkerConfig(w02Config, w02))
  assert.throws(
    () => verifyWorkerConfig({ ...w02Config, vars: { W02_DATABASE_DRIVER: 'd1' } }, w02),
    /production database driver must be neon/,
  )

  const w08 = STAGED_WORKERS.find((worker) => worker.worker === 'W08')
  const w08Config = {
    name: w08.script,
    d1_databases: [],
    hyperdrive: [{ binding: w08.binding, id: w08.hyperdriveId }],
    vars: { W08_DATABASE_DRIVER: 'neon' },
  }
  assert.doesNotThrow(() => verifyWorkerConfig(w08Config, w08))
  assert.deepEqual(verifyWorkerConfig(w08Config, w08).d1FallbackBindings, [])
  assert.throws(
    () => verifyWorkerConfig({ ...w08Config, vars: { W08_DATABASE_DRIVER: 'd1' } }, w08),
    /production database driver must be neon/,
  )
})

test('keeps W11 analytics on D1-05 with Hyperdrive runtime unstaged', async () => {
  const result = await inspectNeonWorkerHyperdriveStaging()
  assert.deepEqual(result.analyticsRuntime, {
    worker: ANALYTICS_RUNTIME_GUARD.worker,
    d1FallbackBinding: ANALYTICS_RUNTIME_GUARD.requiredD1Binding,
    hyperdriveStaged: false,
    runtimeIngestionEnabled: false,
  })
})

test('fails closed when a required Worker Wrangler file is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'luckread-neon-hyperdrive-'))
  try {
    await mkdir(path.join(root, 'workers', 'W01-payload'), { recursive: true })
    await writeFile(path.join(root, 'workers', 'W01-payload', 'wrangler.jsonc'), JSON.stringify({
      name: 'luckread-w01-payload',
      vars: { PAYLOAD_DATABASE_DRIVER: 'neon' },
      d1_databases: [{ binding: 'D1' }],
      hyperdrive: [{ binding: 'HYPERDRIVE', id: '0c53a1bb9bc0484bac146e8ae2d3158b' }],
    }))
    await assert.rejects(inspectNeonWorkerHyperdriveStaging(root), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
