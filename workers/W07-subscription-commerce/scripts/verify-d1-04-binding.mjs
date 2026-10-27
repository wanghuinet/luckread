import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ADMITTED_D1_04_UUID = '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'

function collectObjects(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output)
  } else if (value && typeof value === 'object') {
    output.push(value)
    for (const item of Object.values(value)) collectObjects(item, output)
  }
  return output
}

function fail(message) {
  throw new Error('W07_D1_04_PREFLIGHT_FAILED: ' + message)
}

/**
 * Confirm that the admitted D1-04 UUID is consistently present in the
 * canonical registry, W07's binding, and the current read-only Cloudflare
 * database inventory. This function never writes to D1 or changes bindings.
 */
export function verifyW07D1_04Binding({ databaseList, wranglerConfig, boundaryContract }) {
  const registryId = boundaryContract?.physicalD1Registry?.['D1-04']
  if (registryId !== ADMITTED_D1_04_UUID) {
    fail('canonical D1-04 registry UUID does not match the admitted physical identity')
  }

  const bindings = Array.isArray(wranglerConfig?.d1_databases) ? wranglerConfig.d1_databases : []
  const binding = bindings.find((entry) => entry?.binding === 'D1_04')
  if (!binding || binding.database_id !== registryId) {
    fail('W07 D1_04 binding is missing or does not match the canonical registry')
  }
  if (typeof binding.database_name !== 'string' || binding.database_name.trim() !== binding.database_name || !binding.database_name) {
    fail('W07 D1_04 database_name is missing or malformed')
  }

  const matches = collectObjects(databaseList).filter((entry) =>
    entry.uuid === registryId || entry.database_id === registryId)
  if (matches.length !== 1) {
    fail('current Cloudflare D1 inventory must contain exactly one resource with the admitted D1-04 UUID')
  }

  const remoteName = matches[0].name ?? matches[0].database_name
  if (typeof remoteName !== 'string' || remoteName.length === 0) {
    fail('current Cloudflare inventory omitted the D1-04 display name required by Wrangler')
  }
  if (remoteName !== binding.database_name) {
    fail('W07 D1_04 database_name does not match the current resource name for the admitted UUID')
  }

  return {
    result: 'PASS',
    binding: 'D1_04',
    databaseUuid: registryId,
    databaseName: remoteName,
    source: 'current read-only Cloudflare D1 inventory',
  }
}

function main() {
  const inventoryPath = process.argv[2]
  if (!inventoryPath) {
    throw new Error('Usage: node scripts/verify-d1-04-binding.mjs <cloudflare-d1-list.json>')
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '../../..')
  const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const report = verifyW07D1_04Binding({
    databaseList: readJson(path.resolve(inventoryPath)),
    wranglerConfig: readJson(path.join(repoRoot, 'workers/W07-subscription-commerce/wrangler.jsonc')),
    boundaryContract: readJson(path.join(repoRoot, 'contracts/transport/worker-d1-access-boundary.v1.json')),
  })
  console.log('W07_D1_04_BINDING_PREFLIGHT=PASS')
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
