import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifestPath = resolve(repositoryRoot, 'contracts/database/neon-d1-01-migration-manifest.v1.json')
const ledgerContractPath = resolve(repositoryRoot, 'contracts/database/neon-schema-migration-ledger.v1.json')
const checksumValidatorPath = resolve(repositoryRoot, 'scripts/neon/d1-01-migration-manifest.mjs')

const fail = (message) => {
  throw new Error('D1-01 read-only migration planner: ' + message)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

function readCommittedChecksums() {
  const child = spawnSync(process.execPath, [checksumValidatorPath, '--print-checksums'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (child.error) fail('could not launch the canonical manifest/checksum validator: ' + child.error.message)
  if (child.status !== 0) {
    fail(
      'canonical manifest/checksum validation failed before a plan could be produced: ' +
      (child.stderr || child.stdout || 'unknown validation error').trim()
    )
  }
  try {
    return JSON.parse(child.stdout)
  } catch {
    fail('canonical checksum validator did not return valid JSON')
  }
}

const isSha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

export function buildReadOnlyMigrationPlan({ manifest, ledgerContract, checksums }) {
  if (manifest.domainId !== 'D1-01' || manifest.databaseName !== 'luckread' || manifest.postgresMajor !== 18) {
    fail('only D1-01 / luckread / PostgreSQL 18 is supported by this plan')
  }
  if (manifest.businessDataImport !== false || manifest.productionCutoverAuthorized !== false) {
    fail('manifest must remain schema-only with production cutover disabled')
  }
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
  const d1_02Readiness = domainReadiness['D1-02']
  const d1_02ReviewRef = 'contracts/database/neon-d1-02-remote-runner-review.v1.json'
  const d1_02Released = d1_02Readiness?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
    d1_02Readiness?.remoteApplyReady === true &&
    d1_02Readiness?.reviewEvidenceRef === d1_02ReviewRef
  const d1_02Blocked = d1_02Readiness?.runnerStatus === 'NOT_IMPLEMENTED' &&
    d1_02Readiness?.remoteApplyReady === false
  const laterDomainsBlocked = ['D1-03', 'D1-04', 'D1-05'].every((domain) =>
    domainReadiness[domain]?.runnerStatus === 'NOT_IMPLEMENTED' &&
    domainReadiness[domain]?.remoteApplyReady === false)
  const expectedSharedRunnerStatus = d1_02Released
    ? 'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY'
    : 'IMPLEMENTED_FOR_D1_01_ONLY'
  const otherDomainsBlocked = (d1_02Released || d1_02Blocked) &&
    laterDomainsBlocked &&
    ledgerContract.execution?.runnerStatus === expectedSharedRunnerStatus
  const releaseReady =
    manifest.remoteApplyReady === true &&
    manifest.execution?.remoteApplyReady === true &&
    manifest.execution?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
    ledgerContract.remoteApplyReady === false &&
    ledgerContract.execution?.remoteApplyReady === false &&
    ledgerContract.execution?.runnerStatus === expectedSharedRunnerStatus &&
    JSON.stringify(Object.keys(domainReadiness).sort()) === JSON.stringify(expectedDomains) &&
    d1Readiness?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
    d1Readiness?.remoteApplyReady === true &&
    manifest.execution?.reviewEvidenceRef === d1Readiness?.reviewEvidenceRef
  if (!releaseBlocked && !releaseReady) {
    fail('manifest and ledger must share one complete blocked or reviewed release state')
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    fail('manifest must contain at least one ordered migration entry')
  }
  if (ledgerContract.table?.name !== 'neon_schema_migration_ledger' ||
      ledgerContract.table?.appendOnly !== true) {
    fail('shared append-only schema ledger contract is missing')
  }
  if (!Array.isArray(checksums) || checksums.length !== manifest.entries.length) {
    fail('checksum validator output must contain one result per manifest entry')
  }

  const checksumsById = new Map()
  for (const item of checksums) {
    if (!item || typeof item.migrationId !== 'string' || checksumsById.has(item.migrationId)) {
      fail('checksum output contains a missing or duplicate migration id')
    }
    if (!isSha256(item.manifestEntrySha256)) {
      fail('manifest-entry SHA-256 is missing or malformed for ' + item.migrationId)
    }
    if (item.artifactSha256 !== 'GENERATED_AT_EXECUTION' && !isSha256(item.artifactSha256)) {
      fail('artifact SHA-256 is missing or malformed for ' + item.migrationId)
    }
    checksumsById.set(item.migrationId, item)
  }

  const seenIds = new Set()
  const seenOrders = new Set()
  let lastOrder = 0
  const entries = manifest.entries.map((entry) => {
    if (!Number.isSafeInteger(entry.order) || entry.order <= lastOrder || seenOrders.has(entry.order)) {
      fail('migration order is not strictly increasing: ' + entry.migrationId)
    }
    lastOrder = entry.order
    seenOrders.add(entry.order)

    if (seenIds.has(entry.migrationId)) fail('duplicate migration id: ' + entry.migrationId)
    seenIds.add(entry.migrationId)

    for (const dependency of entry.dependsOn ?? []) {
      if (!seenIds.has(dependency) || dependency === entry.migrationId) {
        fail('dependency must appear earlier in the plan: ' + dependency)
      }
    }

    const checksum = checksumsById.get(entry.migrationId)
    if (!checksum) fail('checksum output is missing migration ' + entry.migrationId)

    const generated = entry.artifactState === 'GENERATED_AT_EXECUTION'
    if (generated !== (checksum.artifactSha256 === 'GENERATED_AT_EXECUTION')) {
      fail('artifact state and checksum state disagree for ' + entry.migrationId)
    }
    if (!Array.isArray(entry.artifactPaths) || entry.artifactPaths.length === 0) {
      fail('migration has no artifact paths: ' + entry.migrationId)
    }

    const action = entry.kind === 'PAYLOAD_NATIVE'
      ? 'PAYLOAD_NATIVE_APPLY_WITH_POST_COMMIT_LEDGER_RECONCILIATION'
      : 'APPLY_SQL_AND_APPEND_LEDGER_IN_ONE_RUNNER_TRANSACTION'

    return {
      order: entry.order,
      ownerWorker: entry.ownerWorker,
      migrationId: entry.migrationId,
      kind: entry.kind,
      dependencies: [...(entry.dependsOn ?? [])],
      artifacts: entry.artifactPaths.map((path) => ({
        path,
        state: generated ? 'GENERATION_REQUIRED' : 'COMMITTED',
      })),
      artifactSha256: generated ? null : checksum.artifactSha256,
      manifestEntrySha256: checksum.manifestEntrySha256,
      plannedAction: action,
      executionStatus: generated ? 'BLOCKED_GENERATION_REQUIRED' : 'READY_FOR_REVIEW_ONLY',
    }
  })

  const generatedCount = entries.filter((entry) => entry.executionStatus === 'BLOCKED_GENERATION_REQUIRED').length
  return {
    planVersion: '1.0.0',
    planType: 'READ_ONLY_D1_01_SCHEMA_MIGRATION_PLAN',
    target: {
      domainId: 'D1-01',
      databaseName: 'luckread',
      postgresMajor: 18,
    },
    safety: {
      readOnly: true,
      remoteConnectionAttempted: false,
      databaseCatalogInspected: false,
      ledgerRowsRead: false,
      ddlExecuted: false,
      businessDataImported: false,
      productionCutoverAuthorized: false,
      remoteApplyReady: releaseReady,
    },
    readiness: {
      manifest: 'VALIDATED',
      committedArtifactChecksums: 'VALIDATED',
      generatedArtifactCount: generatedCount,
      ledgerSchema: 'DEFINED_NOT_INSTALLED',
      sharedRunner: releaseReady ? 'IMPLEMENTED_AND_REVIEWED' : 'NOT_IMPLEMENTED',
      remoteReleaseGate: releaseReady ? 'READY_FOR_MANUAL_DISPATCH' : 'BLOCKED',
      remoteDatabasePreflight: 'NOT_RUN',
      ledgerState: 'NOT_INSPECTED',
      executable: false,
      blockedReason: releaseReady
        ? 'This planner is read-only; remote DDL still requires a separate main-only workflow_dispatch with exact confirmation.'
        : 'The shared runner is not implemented/reviewed and remote apply remains disabled.',
    },
    summary: {
      migrationCount: entries.length,
      ownerWorkers: [...new Set(entries.map((entry) => entry.ownerWorker))],
      committedMigrationCount: entries.length - generatedCount,
      generatedAtExecutionCount: generatedCount,
      firstOrder: entries[0].order,
      lastOrder: entries[entries.length - 1].order,
    },
    entries,
  }
}

function run() {
  const manifest = readJson(manifestPath)
  const ledgerContract = readJson(ledgerContractPath)
  const checksums = readCommittedChecksums()
  const plan = buildReadOnlyMigrationPlan({ manifest, ledgerContract, checksums })

  if (process.argv.includes('--require-executable')) {
    if (!plan.readiness.executable) {
      fail('plan is valid for inspection but not executable; no database connection was attempted')
    }
  }
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
