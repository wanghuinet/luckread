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

test('all seven admitted Worker configs target the matching existing Neon Hyperdrive and retain D1 fallbacks', async () => {
  const result = await inspectNeonWorkerHyperdriveStaging()
  assert.equal(result.status, 'SOURCE_CONFIG_STAGED_ONLY')
  assert.equal(result.stagedWorkerCount, 7)
  assert.equal(result.d1FallbacksPreserved, true)
  assert.equal(result.runtimeDriversEnabled, false)
  assert.equal(result.productionDeployPerformed, false)
  assert.equal(result.productionCutoverPerformed, false)
  assert.equal(result.businessDataImported, false)
  assert.deepEqual(result.workers.map((worker) => worker.worker), ['W01', 'W02', 'W03', 'W05', 'W06', 'W07', 'W08'])
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

test('rejects removal or renaming of an existing D1 rollback binding', () => {
  const expected = STAGED_WORKERS.find((worker) => worker.worker === 'W07')
  assert.throws(
    () => verifyWorkerConfig({
      name: expected.script,
      d1_databases: [{ binding: 'D1_04' }],
      hyperdrive: [{ binding: expected.binding, id: expected.hyperdriveId }],
    }, expected),
    /D1 fallback bindings must remain unchanged/,
  )
})

test('rejects enabling W02 or W08 Neon mode in Wrangler vars', () => {
  const expected = STAGED_WORKERS.find((worker) => worker.worker === 'W02')
  assert.throws(
    () => verifyWorkerConfig({
      name: expected.script,
      d1_databases: expected.d1Bindings.map((binding) => ({ binding })),
      hyperdrive: [{ binding: expected.binding, id: expected.hyperdriveId }],
      vars: { W02_DATABASE_DRIVER: 'neon' },
    }, expected),
    /production database driver must remain D1 by default/,
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
      d1_databases: [{ binding: 'D1' }],
      hyperdrive: [{ binding: 'HYPERDRIVE', id: '0c53a1bb9bc0484bac146e8ae2d3158b' }],
    }))
    await assert.rejects(inspectNeonWorkerHyperdriveStaging(root), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
