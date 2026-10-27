import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ADMITTED_D1_04_UUID = '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'

function fail(message) {
  throw new Error('W07_D1_04_LIVE_NAME_PREFLIGHT_FAILED: ' + message)
}

function collectObjects(value, output = [], seen = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output, seen)
  } else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value)
    output.push(value)
    for (const item of Object.values(value)) collectObjects(item, output, seen)
  }
  return output
}

/**
 * Identify the live display name for the registered D1-04 UUID from a current
 * read-only Cloudflare inventory. A configured-name mismatch is reported,
 * not hidden: this tool intentionally does not mutate Wrangler configuration,
 * execute SQL, apply migrations, or deploy a Worker.
 */
export function inspectW07D1_04LiveName({ databaseList, wranglerConfig, boundaryContract }) {
  const registryId = boundaryContract?.physicalD1Registry?.['D1-04']
  if (registryId !== ADMITTED_D1_04_UUID) {
    fail('canonical D1-04 registry UUID does not match the admitted physical identity')
  }

  const bindings = Array.isArray(wranglerConfig?.d1_databases) ? wranglerConfig.d1_databases : []
  const binding = bindings.find((entry) => entry?.binding === 'D1_04')
  if (!binding || binding.database_id !== registryId) {
    fail('W07 D1_04 binding is missing or does not match the canonical registry UUID')
  }

  const matches = collectObjects(databaseList).filter((entry) =>
    entry.uuid === registryId || entry.database_id === registryId)
  if (matches.length !== 1) {
    fail('current Cloudflare D1 inventory must contain exactly one resource with the admitted D1-04 UUID')
  }

  const liveName = matches[0].name ?? matches[0].database_name
  if (
    typeof liveName !== 'string' ||
    liveName.length < 1 ||
    liveName.length > 256 ||
    liveName.trim() !== liveName ||
    /[\u0000-\u001f\u007f]/.test(liveName)
  ) {
    fail('current Cloudflare inventory omitted a valid D1-04 display name')
  }

  const configuredName = typeof binding.database_name === 'string' ? binding.database_name : null
  return {
    result: 'LIVE_NAME_IDENTIFIED',
    binding: 'D1_04',
    databaseUuid: registryId,
    configuredDatabaseName: configuredName,
    liveDatabaseName: liveName,
    displayNameMatches: configuredName === liveName,
    source: 'current read-only Cloudflare D1 inventory',
    readOnly: true,
    migrationApplied: false,
    deploymentPerformed: false,
    nextAction: configuredName === liveName
      ? 'Name matches; migration and deployment still require their separate reviewed gates.'
      : 'Review the live name and update the binding in a reviewed PR; do not migrate or deploy from this report alone.',
  }
}

function main() {
  const inventoryPath = process.argv[2]
  const reportPath = process.argv[3]
  if (!inventoryPath || !reportPath) {
    throw new Error('Usage: node scripts/report-d1-04-live-name.mjs <cloudflare-d1-list.json> <report.json>')
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(scriptDir, '../../..')
  const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const report = inspectW07D1_04LiveName({
    databaseList: readJson(path.resolve(inventoryPath)),
    wranglerConfig: readJson(path.join(repoRoot, 'workers/W07-subscription-commerce/wrangler.jsonc')),
    boundaryContract: readJson(path.join(repoRoot, 'contracts/transport/worker-d1-access-boundary.v1.json')),
  })

  fs.writeFileSync(path.resolve(reportPath), JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
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
