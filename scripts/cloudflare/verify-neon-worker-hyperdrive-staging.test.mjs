import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  ANALYTICS_RUNTIME_GUARD,
  STAGED_WORKERS,
  inspectNeonWorkerHyperdriveStaging,
  verifyWorkerConfig,
} from './verify-neon-worker-hyperdrive-staging.mjs'

test('all six admitted Worker configs target Neon Hyperdrive and have the expected zero-D1 production bindings', async () => {
  const result = await inspectNeonWorkerHyperdriveStaging()
  assert.equal(result.status, 'SOURCE_CONFIG_STAGED_ONLY')
  assert.equal(result.stagedWorkerCount, 6)
  assert.equal(result.expectedD1BindingSetsVerified, true)
  assert.deepEqual(result.workers.find((worker) => worker.worker === 'W03')?.d1FallbackBindings, [])
  assert.equal(result.workers.find((worker) => worker.worker === 'W03')?.configuredDriver, 'neon')
  assert.deepEqual(result.workers.find((worker) => worker.worker === 'W05')?.d1FallbackBindings, [])
  assert.deepEqual(result.workers.find((worker) => worker.worker === 'W08')?.d1FallbackBindings, [])
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

test('rejects reintroducing W07 production D1 while W05 remains D1-free', () => {
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

test('requires W01/W02/W08 Neon mode with D1-free production deployment configs', () => {
  const w01 = STAGED_WORKERS.find((worker) => worker.worker === 'W01')
  const w01Config = {
    name: w01.script,
    d1_databases: [],
    hyperdrive: [{ binding: w01.binding, id: w01.hyperdriveId }],
    vars: { PAYLOAD_DATABASE_DRIVER: 'neon' },
  }
  assert.doesNotThrow(() => verifyWorkerConfig(w01Config, w01))
  assert.deepEqual(verifyWorkerConfig(w01Config, w01).d1FallbackBindings, [])

  const w02 = STAGED_WORKERS.find((worker) => worker.worker === 'W02')
  const w02Config = {
    name: w02.script,
    d1_databases: [],
    hyperdrive: [{ binding: w02.binding, id: w02.hyperdriveId }],
    vars: { W02_DATABASE_DRIVER: 'neon' },
  }
  assert.doesNotThrow(() => verifyWorkerConfig(w02Config, w02))
  assert.deepEqual(verifyWorkerConfig(w02Config, w02).d1FallbackBindings, [])
  assert.throws(
    () => verifyWorkerConfig({ ...w02Config, d1_databases: [{ binding: 'D1_01' }] }, w02),
    /production D1 binding set does not match the expected cutover state/,
  )
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

test('keeps W11 analytics on Neon with ingestion disabled and no D1 fallback', async () => {
  const result = await inspectNeonWorkerHyperdriveStaging()
  assert.deepEqual(result.analyticsRuntime, {
    worker: ANALYTICS_RUNTIME_GUARD.worker,
    hyperdriveBinding: ANALYTICS_RUNTIME_GUARD.requiredHyperdriveBinding,
    hyperdriveId: ANALYTICS_RUNTIME_GUARD.requiredHyperdriveId,
    d1FallbackBindings: [],
    hyperdriveStaged: true,
    runtimeIngestionEnabled: false,
  })
})

test('fails closed when a required Worker Wrangler file is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'luckread-neon-hyperdrive-'))
  try {
    await mkdir(path.join(root, 'workers', 'W01-payload'), { recursive: true })
    await writeFile(path.join(root, 'workers', 'W01-payload', 'wrangler.neon.jsonc'), JSON.stringify({
      name: 'luckread-w01-payload',
      vars: { PAYLOAD_DATABASE_DRIVER: 'neon' },
      d1_databases: [],
      hyperdrive: [{ binding: 'HYPERDRIVE', id: '0c53a1bb9bc0484bac146e8ae2d3158b' }],
    }))
    await assert.rejects(inspectNeonWorkerHyperdriveStaging(root), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


test('keeps the legacy media runtime E2E fail-closed until its Neon fixtures and isolated environment exist', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/media-runtime-e2e.yml', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /^on:\n  workflow_dispatch:/m, 'media E2E must remain manual-only')
  assert.doesNotMatch(workflow, /^  workflow_run:/m, 'media E2E must not auto-run after a production deployment')
  assert.match(workflow, /^    if: \$\{\{ false \}\}$/m, 'legacy D1 fixture job must remain disabled')
  assert.match(workflow, /'d1','execute'/, 'the legacy D1 fixture path must be visible for future replacement')
  assert.match(workflow, /dedicated non-production W01 \+ isolated Neon DB/, 'the re-enable requirement must remain explicit')
})


test('keeps the obsolete D1 media owner migration workflow disabled after W01 Neon cutover', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/w01-media-owner-migration-execution.yml', import.meta.url),
    'utf8',
  )
  assert.match(workflow, /if: \\?\$\{\{ false \\?\}\}/, 'legacy migration workflow must be hard-disabled')
  assert.match(workflow, /Safety hold: this legacy workflow targets D1/, 'migration target rationale must remain documented')
  assert.match(workflow, /d1 execute/, 'legacy D1 commands must remain detectable')
})
