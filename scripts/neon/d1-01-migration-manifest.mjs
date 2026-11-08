import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateRemoteRunnerReview } from './remote-runner-review.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifestPath = resolve(repositoryRoot, 'contracts/database/neon-d1-01-migration-manifest.v1.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const ledgerContractPath = resolve(repositoryRoot, 'contracts/database/neon-schema-migration-ledger.v1.json')
const ledgerContract = JSON.parse(readFileSync(ledgerContractPath, 'utf8'))

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
export const hashManifestEntry = (entry) =>
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
    const pathBytes = Buffer.from(relativePath.replaceAll(String.fromCharCode(92), '/'), 'utf8')
    const pathLength = Buffer.alloc(4)
    pathLength.writeUInt32BE(pathBytes.length)
    const fileLength = Buffer.alloc(8)
    fileLength.writeBigUInt64BE(BigInt(file.length))
    hash.update(pathLength).update(pathBytes).update(fileLength).update(file)
  }
  return hash.digest('hex')
}
const validHex = (value, length) => typeof value === 'string' && new RegExp('^[0-9a-f]{' + length + '}$').test(value)
const isSafeRepositoryPath = (path) => typeof path === 'string' &&
  path.startsWith('workers/') && !isAbsolute(path) && !path.split(/[\\/]/).includes('..')

const releaseBlocked =
  manifest.remoteApplyReady === false &&
  manifest.execution?.remoteApplyReady === false &&
  manifest.execution?.runnerStatus === 'NOT_IMPLEMENTED' &&
  ledgerContract.remoteApplyReady === false &&
  ledgerContract.execution?.remoteApplyReady === false &&
  ledgerContract.execution?.runnerStatus === 'NOT_IMPLEMENTED'
const domainReadiness = ledgerContract.execution?.domainReadiness ?? {}
const expectedDomains = ['D1-01', 'D1-02', 'D1-03', 'D1-04', 'D1-05']
const d1Readiness = domainReadiness['D1-01']
const otherDomainsBlocked = expectedDomains
  .filter((domain) => domain !== 'D1-01')
  .every((domain) => domainReadiness[domain]?.runnerStatus === 'NOT_IMPLEMENTED' &&
    domainReadiness[domain]?.remoteApplyReady === false)
const releaseReady =
  manifest.remoteApplyReady === true &&
  manifest.execution?.remoteApplyReady === true &&
  manifest.execution?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
  ledgerContract.remoteApplyReady === false &&
  ledgerContract.execution?.remoteApplyReady === false &&
  ledgerContract.execution?.runnerStatus === 'IMPLEMENTED_FOR_D1_01_ONLY' &&
  JSON.stringify(Object.keys(domainReadiness).sort()) === JSON.stringify(expectedDomains) &&
  d1Readiness?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
  d1Readiness?.remoteApplyReady === true &&
  otherDomainsBlocked
if (manifest.domainId !== 'D1-01' || manifest.databaseName !== 'luckread' ||
    manifest.postgresMajor !== 18 || manifest.businessDataImport !== false ||
    manifest.productionCutoverAuthorized !== false || (!releaseBlocked && !releaseReady)) {
  fail('manifest target, schema-only authorization or shared release-gate consistency drift')
}
if (releaseReady) {
  const reviewRef = 'contracts/database/neon-d1-01-remote-runner-review.v1.json'
  if (manifest.execution?.reviewEvidenceRef !== reviewRef ||
      d1Readiness?.reviewEvidenceRef !== reviewRef) {
    fail('D1-01 manifest and D1-01 domain readiness must reference the same reviewed evidence')
  }
  const review = validateRemoteRunnerReview({ root: repositoryRoot })
  if (!review.valid) fail('remote runner review evidence is invalid: ' + review.errors.join('; '))
}
const inventory = JSON.parse(readFileSync(
  resolve(repositoryRoot, 'contracts/database/neon-d1-01-schema-sources.v1.json'), 'utf8'
))
const bootstrap = JSON.parse(readFileSync(
  resolve(repositoryRoot, 'contracts/database/neon-five-domain-schema-bootstrap.v1.json'), 'utf8'
))
const w01Package = JSON.parse(readFileSync(resolve(repositoryRoot, 'workers/W01-payload/package.json'), 'utf8'))
const w02Package = JSON.parse(readFileSync(resolve(repositoryRoot, 'workers/W02-identity/package.json'), 'utf8'))
const ledgerContract = JSON.parse(readFileSync(resolve(repositoryRoot, 'contracts/database/neon-schema-migration-ledger.v1.json'), 'utf8'))
const d1Domain = bootstrap.domains?.find((domain) => domain.domainId === 'D1-01')
const inventoryOwners = inventory.owners?.map((owner) => owner.worker).filter((worker) =>
  ['W01', 'W02', 'W07', 'W08'].includes(worker)
).sort()
if (inventory.target?.domainId !== 'D1-01' ||
    inventory.target?.databaseName !== 'luckread' ||
    inventory.target?.postgresMajor !== 18 ||
    inventory.target?.businessDataImport !== false ||
    JSON.stringify(inventoryOwners) !== JSON.stringify(['W01', 'W02', 'W07', 'W08'])) {
  fail('canonical D1-01 source inventory target or four owner set drift')
}
if (!d1Domain ||
    d1Domain.databaseName !== 'luckread' ||
    JSON.stringify([...d1Domain.owners].sort()) !== JSON.stringify(['W01', 'W02', 'W07', 'W08']) ||
    bootstrap.authorization?.businessDataImportAuthorized !== false ||
    bootstrap.authorization?.productionCutoverAuthorized !== false ||
    bootstrap.authorization?.schemaOnlyInitializationAuthorized !== true) {
  fail('five-domain bootstrap contract no longer authorizes this exact schema-only D1-01 scope')
}
if (w01Package.dependencies?.payload !== '3.90.2' ||
    w01Package.devDependencies?.['@payloadcms/db-postgres'] !== '3.90.2') {
  fail('W01 Payload and official PostgreSQL adapter must remain pinned to 3.90.2')
}
if (w02Package.dependencies?.['better-auth'] !== '1.7.8' ||
    w02Package.devDependencies?.auth !== '1.7.8' ||
    w02Package.devDependencies?.pg !== '8.20.0') {
  fail('W02 Better Auth CLI/runtime and PostgreSQL driver pins drifted')
}
if (manifest.entries.length !== 14) {
  fail('D1-01 must retain exactly 14 ordered migration entries (W01 + W02 core + W02 custom x10 + W07 + W08)')
}
const requiredEntries = [
  [100, 'W01', 'D1-01-W01-PAYLOAD-BASELINE-20261107', 'PAYLOAD_NATIVE'],
  [200, 'W02', 'D1-01-W02-BETTER-AUTH-CORE-1.7.8', 'GENERATED_POSTGRESQL_SQL'],
  [500, 'W07', 'D1-01-W07-MEMBERSHIP-SCHEMA-0001', 'POSTGRESQL_SQL'],
  [600, 'W08', 'D1-01-W08-CREATOR-AUTHORIZATION-0001', 'POSTGRESQL_SQL'],
]
for (const [order, owner, migrationId, kind] of requiredEntries) {
  if (!manifest.entries.some((entry) =>
    entry.order === order && entry.ownerWorker === owner &&
    entry.migrationId === migrationId && entry.kind === kind
  )) {
    fail('required owner baseline missing or reordered: ' + migrationId)
  }
}
const expectedOwners = ['W01', 'W02', 'W07', 'W08']
if (JSON.stringify([...new Set(manifest.entries.map((entry) => entry.ownerWorker))].sort()) !==
    JSON.stringify(expectedOwners)) {
  fail('manifest owner set must remain W01/W02/W07/W08')
}
const expectedW02Files = [
  '0001_role_assignments.sql',
  '0002_role_authorization_versions.sql',
  '0003_auth_003_credentials.sql',
  '0004_auth_013_publication_journal.sql',
  '0005_auth_015_lifecycle_windows.sql',
  '0006_auth_010_session_revocation_journal.sql',
  '0007_auth_007_mfa_lifecycle.sql',
  '0008_auth_username_change_state.sql',
  '0009_auth_007_mfa_publication_journal.sql',
  '0010_auth_007_mfa_operation_receipts.sql',
]
const actualW02Files = manifest.entries
  .filter((entry) => entry.ownerWorker === 'W02' && entry.migrationId !== 'D1-01-W02-BETTER-AUTH-CORE-1.7.8')
  .map((entry) => entry.artifactPaths[0]?.split('/').pop())
if (JSON.stringify(actualW02Files) !== JSON.stringify(expectedW02Files)) {
  fail('W02 custom PostgreSQL migrations must remain in the verified 0001..0010 order')
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
      if (!isSafeRepositoryPath(path) || !statSync(resolve(repositoryRoot, path)).isFile()) {
        fail('committed artifact missing: ' + path)
      }
    }
  } else if (entry.artifactState === 'GENERATED_AT_EXECUTION') {
    if (!entry.execution?.generatorCommand) fail('generated artifact requires a pinned generator command')
  } else {
    fail('unsupported artifact state for ' + entry.migrationId)
  }
  for (const path of entry.sourcePaths) {
    if (!isSafeRepositoryPath(path) || !statSync(resolve(repositoryRoot, path)).isFile()) {
      fail('source input missing or not a file: ' + path)
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
  if (entry.artifactState === 'COMMITTED') {
    const digestForward = hashArtifactBundle(entry.artifactPaths)
    const digestReverse = hashArtifactBundle([...entry.artifactPaths].reverse())
    if (!validHex(digestForward, 64) || digestForward !== digestReverse) {
      fail('artifact bundle SHA-256 framing is not deterministic: ' + entry.migrationId)
    }
  }
}

if (process.argv.includes('--print-checksums')) {
  console.log(JSON.stringify(manifest.entries.map((entry) => ({
    migrationId: entry.migrationId,
    artifactSha256: entry.artifactState === 'COMMITTED' ? hashArtifactBundle(entry.artifactPaths) : 'GENERATED_AT_EXECUTION',
    manifestEntrySha256: hashManifestEntry(entry),
  })), null, 2))
} else if (process.argv.includes('--print-order')) {
  console.log(JSON.stringify(manifest.entries.map(({ order, ownerWorker, migrationId, kind }) =>
    ({ order, ownerWorker, migrationId, kind })), null, 2))
} else {
  console.log('D1_01_MIGRATION_MANIFEST_VALID entries=' + manifest.entries.length)
}
