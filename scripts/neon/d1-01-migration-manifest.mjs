import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifestPath = resolve(repositoryRoot, 'contracts/database/neon-d1-01-migration-manifest.v1.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const fail = (message) => {
  throw new Error('D1-01 migration manifest invalid: ' + message)
}
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}
const hashManifestEntry = (entry) =>
  createHash('sha256').update(JSON.stringify(canonicalize(entry)), 'utf8').digest('hex')

export function hashArtifactBundle(artifactPaths) {
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    fail('artifactPaths must be a non-empty array')
  }
  const hash = createHash('sha256')
  for (const relativePath of [...artifactPaths].sort()) {
    if (typeof relativePath !== 'string' || isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
      fail('artifact path must be a safe repository-relative path')
    }
    const absolutePath = resolve(repositoryRoot, relativePath)
    const file = readFileSync(absolutePath)
    const pathBytes = Buffer.from(relativePath.replaceAll('\\\\', '/'), 'utf8')
    const pathLength = Buffer.alloc(4)
    pathLength.writeUInt32BE(pathBytes.length)
    const fileLength = Buffer.alloc(8)
    fileLength.writeBigUInt64BE(BigInt(file.length))
    hash.update(pathLength).update(pathBytes).update(fileLength).update(file)
  }
  return hash.digest('hex')
}
const validHex = (value, length) => typeof value === 'string' && new RegExp('^[0-9a-f]{' + length + '}$').test(value)

if (manifest.domainId !== 'D1-01' || manifest.databaseName !== 'luckread' ||
    manifest.postgresMajor !== 18 || manifest.businessDataImport !== false ||
    manifest.productionCutoverAuthorized !== false || manifest.remoteApplyReady !== false) {
  fail('manifest target or schema-only authorization drift')
}
const expectedOwners = ['W01', 'W02', 'W07', 'W08']
if (JSON.stringify([...new Set(manifest.entries.map((entry) => entry.ownerWorker))].sort()) !==
    JSON.stringify(expectedOwners)) {
  fail('manifest owner set must remain W01/W02/W07/W08')
}
const seenIds = new Set()
const seenOrders = new Set()
let previousOrder = 0
for (const entry of manifest.entries) {
  if (!Number.isSafeInteger(entry.order) || entry.order <= previousOrder) {
    fail('migration order must be strictly increasing and deterministic: ' + entry.migrationId)
  }
  previousOrder = entry.order
  if (seenIds.has(entry.migrationId)) fail('duplicate migration id: ' + entry.migrationId)
  if (seenOrders.has(entry.order)) fail('duplicate order: ' + entry.order)
  seenIds.add(entry.migrationId)
  seenOrders.add(entry.order)
  if (!expectedOwners.includes(entry.ownerWorker) ||
      !['PAYLOAD_NATIVE', 'GENERATED_POSTGRESQL_SQL', 'POSTGRESQL_SQL'].includes(entry.kind) ||
      !Array.isArray(entry.artifactPaths) || entry.artifactPaths.length === 0 ||
      !Array.isArray(entry.sourcePaths) || entry.sourcePaths.length === 0) {
    fail('incomplete owner/kind/artifact/source declaration: ' + entry.migrationId)
  }
  if (entry.artifactState === 'COMMITTED') {
    for (const path of entry.artifactPaths) {
      if (!path.startsWith('workers/') || !statSync(resolve(repositoryRoot, path)).isFile()) {
        fail('committed artifact missing: ' + path)
      }
    }
  } else if (entry.artifactState === 'GENERATED_AT_EXECUTION') {
    if (!entry.execution?.generatorCommand) fail('generated artifact requires a pinned generator command')
  } else {
    fail('unsupported artifact state for ' + entry.migrationId)
  }
  for (const path of entry.sourcePaths) {
    if (!path.startsWith('workers/') || path.endsWith('/') || !statSync(resolve(repositoryRoot, path)).isFile()) {
      if (!(entry.ownerWorker === 'W02' && path === 'workers/W02-identity/scripts/neon/')) {
        fail('source input missing or not a file: ' + path)
      }
    }
  }
  for (const dependency of entry.dependsOn) {
    if (!seenIds.has(dependency)) fail('dependency must appear earlier in manifest: ' + dependency)
  }
  if (!entry.execution?.executor) fail('execution adapter missing for ' + entry.migrationId)
  if (entry.artifactState === 'GENERATED_AT_EXECUTION' &&
      entry.kind !== 'GENERATED_POSTGRESQL_SQL') {
    fail('only generated PostgreSQL artifacts can be generated at execution')
  }
  const entryDigest = hashManifestEntry(entry)
  if (!validHex(entryDigest, 64)) fail('unable to compute manifest entry SHA-256')
}

if (process.argv.includes('--print-order')) {
  console.log(JSON.stringify(manifest.entries.map(({ order, ownerWorker, migrationId, kind }) =>
    ({ order, ownerWorker, migrationId, kind })), null, 2))
} else {
  console.log('D1_01_MIGRATION_MANIFEST_VALID entries=' + manifest.entries.length)
}
