import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const STAGED_WORKERS = Object.freeze([
  {
    worker: 'W01',
    script: 'luckread-w01-payload',
    configPath: 'workers/W01-payload/wrangler.jsonc',
    binding: 'HYPERDRIVE',
    hyperdriveId: '0c53a1bb9bc0484bac146e8ae2d3158b',
    d1Bindings: ['D1'],
    driver: 'PAYLOAD_DATABASE_DRIVER',
    driverValue: 'neon',
  },
  {
    worker: 'W02',
    script: 'luckread-w02',
    configPath: 'workers/W02-identity/wrangler.jsonc',
    binding: 'HYPERDRIVE',
    hyperdriveId: '0c53a1bb9bc0484bac146e8ae2d3158b',
    d1Bindings: ['D1_01'],
    driver: 'W02_DATABASE_DRIVER',
    driverValue: 'neon',
  },
  {
    worker: 'W03',
    script: 'luckread-w03',
    configPath: 'workers/W03-content/wrangler.jsonc',
    binding: 'HYPERDRIVE_D1_02',
    hyperdriveId: 'c55183e1cc3446409c9c1075832c6615',
    d1Bindings: ['D1_02'],
  },
  {
    worker: 'W05',
    script: 'luckread-w05',
    configPath: 'workers/W05-social/wrangler.jsonc',
    binding: 'HYPERDRIVE_D1_02',
    hyperdriveId: 'c55183e1cc3446409c9c1075832c6615',
    d1Bindings: ['DB', 'D1_03'],
  },
  {
    worker: 'W07',
    script: 'luckread-w07',
    configPath: 'workers/W07-subscription-commerce/wrangler.jsonc',
    binding: 'HYPERDRIVE_D1_04',
    hyperdriveId: '3ae15e6dfb5e4b44979eee30e1d5ede4',
    d1Bindings: ['D1_01', 'D1_04'],
  },
  {
    worker: 'W08',
    script: 'luckread-w08-creator',
    configPath: 'workers/W08-creator/wrangler.jsonc',
    binding: 'HYPERDRIVE',
    hyperdriveId: '0c53a1bb9bc0484bac146e8ae2d3158b',
    d1Bindings: ['D1_01'],
    driver: 'W08_DATABASE_DRIVER',
    driverValue: 'neon',
  },
])

export const ANALYTICS_RUNTIME_GUARD = Object.freeze({
  worker: 'W11',
  configPath: 'workers/W11-growth-campaign-analytics-operations/wrangler.jsonc',
  requiredD1Binding: 'D1_05',
})

function parseConfig(raw, label) {
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Expected JSON-compatible Wrangler config for ${label}: ${error.message}`)
  }
}

export function verifyWorkerConfig(config, expected) {
  assert.equal(config.name, expected.script, `${expected.worker} Worker script name drifted`)

  const actualD1Bindings = (config.d1_databases ?? []).map((entry) => entry.binding).sort()
  assert.deepEqual(
    actualD1Bindings,
    [...expected.d1Bindings].sort(),
    `${expected.worker} D1 fallback bindings must remain unchanged`,
  )

  const matching = (config.hyperdrive ?? []).filter((entry) => entry.binding === expected.binding)
  assert.equal(matching.length, 1, `${expected.worker} must declare exactly one ${expected.binding} binding`)
  assert.equal(matching[0].id, expected.hyperdriveId, `${expected.worker} Hyperdrive resource target drifted`)

  const vars = config.vars ?? {}
  const configuredDriver = expected.driver ? (vars[expected.driver] ?? 'd1') : undefined
  if (expected.driver) {
    assert.equal(
      configuredDriver,
      expected.driverValue ?? 'd1',
      `${expected.worker} production database driver must be ${expected.driverValue ?? 'd1'}`,
    )
  }

  return {
    worker: expected.worker,
    script: config.name,
    binding: expected.binding,
    hyperdriveId: expected.hyperdriveId,
    ...(expected.driver ? { configuredDriver } : {}),
    d1FallbackBindings: actualD1Bindings,
  }
}

export async function inspectNeonWorkerHyperdriveStaging(rootDir = REPO_ROOT) {
  const workers = []
  for (const expected of STAGED_WORKERS) {
    const raw = await readFile(path.join(rootDir, expected.configPath), 'utf8')
    workers.push(verifyWorkerConfig(parseConfig(raw, expected.configPath), expected))
  }

  const analyticsRaw = await readFile(path.join(rootDir, ANALYTICS_RUNTIME_GUARD.configPath), 'utf8')
  const analyticsConfig = parseConfig(analyticsRaw, ANALYTICS_RUNTIME_GUARD.configPath)
  const analyticsD1Bindings = (analyticsConfig.d1_databases ?? []).map((entry) => entry.binding)
  assert.ok(
    analyticsD1Bindings.includes(ANALYTICS_RUNTIME_GUARD.requiredD1Binding),
    'W11 must retain its D1-05 binding',
  )
  assert.equal(
    (analyticsConfig.hyperdrive ?? []).length,
    0,
    'W11 D1-05 Hyperdrive runtime must remain unstaged until analytics admission is complete',
  )

  return {
    schemaVersion: 1,
    status: 'SOURCE_CONFIG_STAGED_ONLY',
    stagedWorkerCount: workers.length,
    workers,
    analyticsRuntime: {
      worker: ANALYTICS_RUNTIME_GUARD.worker,
      d1FallbackBinding: ANALYTICS_RUNTIME_GUARD.requiredD1Binding,
      hyperdriveStaged: false,
      runtimeIngestionEnabled: false,
    },
    d1FallbacksPreserved: true,
    runtimeDriversEnabled: false,
    productionDeployPerformed: false,
    productionCutoverPerformed: false,
    businessDataImported: false,
  }
}

async function main() {
  const result = await inspectNeonWorkerHyperdriveStaging()
  console.log(JSON.stringify(result, null, 2))
  console.log('NEON_WORKER_HYPERDRIVE_STAGING=PASS')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
