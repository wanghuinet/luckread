import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReadOnlyMigrationPlan } from './plan-d1-01-schema-migrations.mjs'

const manifest = {
  domainId: 'D1-01',
  databaseName: 'luckread',
  postgresMajor: 18,
  businessDataImport: false,
  productionCutoverAuthorized: false,
  remoteApplyReady: false,
  execution: { runnerStatus: 'NOT_IMPLEMENTED', remoteApplyReady: false },
  entries: [
    {
      order: 100,
      ownerWorker: 'W01',
      migrationId: 'W01-BASELINE',
      kind: 'PAYLOAD_NATIVE',
      artifactState: 'COMMITTED',
      artifactPaths: ['workers/W01-payload/migration.ts', 'workers/W01-payload/migration.json'],
      dependsOn: [],
    },
    {
      order: 200,
      ownerWorker: 'W02',
      migrationId: 'W02-CORE',
      kind: 'GENERATED_POSTGRESQL_SQL',
      artifactState: 'GENERATED_AT_EXECUTION',
      artifactPaths: ['workers/W02-identity/artifacts/core.sql'],
      dependsOn: ['W01-BASELINE'],
    },
    {
      order: 300,
      ownerWorker: 'W07',
      migrationId: 'W07-SUBSCRIPTIONS',
      kind: 'POSTGRESQL_SQL',
      artifactState: 'COMMITTED',
      artifactPaths: ['workers/W07/migration.sql'],
      dependsOn: ['W02-CORE'],
    },
  ],
}
const ledgerContract = {
  remoteApplyReady: false,
  execution: { runnerStatus: 'NOT_IMPLEMENTED' },
  table: { name: 'neon_schema_migration_ledger', appendOnly: true },
}
const checksums = [
  { migrationId: 'W01-BASELINE', artifactSha256: 'a'.repeat(64), manifestEntrySha256: '1'.repeat(64) },
  { migrationId: 'W02-CORE', artifactSha256: 'GENERATED_AT_EXECUTION', manifestEntrySha256: '2'.repeat(64) },
  { migrationId: 'W07-SUBSCRIPTIONS', artifactSha256: 'b'.repeat(64), manifestEntrySha256: '3'.repeat(64) },
]

test('builds a stable ordered plan without enabling database execution', () => {
  const plan = buildReadOnlyMigrationPlan({ manifest, ledgerContract, checksums })
  assert.deepEqual(plan.entries.map((entry) => entry.order), [100, 200, 300])
  assert.equal(plan.summary.migrationCount, 3)
  assert.equal(plan.readiness.executable, false)
  assert.equal(plan.safety.remoteConnectionAttempted, false)
  assert.equal(plan.safety.ddlExecuted, false)
  assert.equal(plan.safety.businessDataImported, false)
  assert.equal(plan.readiness.ledgerState, 'NOT_INSPECTED')
})

test('marks execution-time generated artifacts as blocked until generated and checksummed', () => {
  const plan = buildReadOnlyMigrationPlan({ manifest, ledgerContract, checksums })
  assert.equal(plan.entries[1].executionStatus, 'BLOCKED_GENERATION_REQUIRED')
  assert.equal(plan.entries[1].artifactSha256, null)
  assert.equal(plan.readiness.generatedArtifactCount, 1)
})

test('preserves native Payload reconciliation as a distinct planned action', () => {
  const plan = buildReadOnlyMigrationPlan({ manifest, ledgerContract, checksums })
  assert.equal(
    plan.entries[0].plannedAction,
    'PAYLOAD_NATIVE_APPLY_WITH_POST_COMMIT_LEDGER_RECONCILIATION'
  )
})

test('rejects a manifest whose migration order is not increasing', () => {
  const bad = structuredClone(manifest)
  bad.entries[1].order = 90
  assert.throws(
    () => buildReadOnlyMigrationPlan({ manifest: bad, ledgerContract, checksums }),
    /strictly increasing/
  )
})

test('rejects unresolved forward dependencies', () => {
  const bad = structuredClone(manifest)
  bad.entries[0].dependsOn = ['W02-CORE']
  assert.throws(
    () => buildReadOnlyMigrationPlan({ manifest: bad, ledgerContract, checksums }),
    /dependency must appear earlier/
  )
})

test('rejects missing or malformed checksums rather than planning an unverified artifact', () => {
  assert.throws(
    () => buildReadOnlyMigrationPlan({ manifest, ledgerContract, checksums: checksums.slice(1) }),
    /one result per manifest entry/
  )
  const badChecksums = structuredClone(checksums)
  badChecksums[0].artifactSha256 = 'NOT-A-SHA'
  assert.throws(
    () => buildReadOnlyMigrationPlan({ manifest, ledgerContract, checksums: badChecksums }),
    /artifact SHA-256 is missing or malformed/
  )
})

test('rejects any manifest or ledger contract that prematurely enables remote execution', () => {
  const enabledManifest = structuredClone(manifest)
  enabledManifest.remoteApplyReady = true
  assert.throws(
    () => buildReadOnlyMigrationPlan({ manifest: enabledManifest, ledgerContract, checksums }),
    /remote execution must remain disabled/
  )
  const enabledLedger = structuredClone(ledgerContract)
  enabledLedger.remoteApplyReady = true
  assert.throws(
    () => buildReadOnlyMigrationPlan({ manifest, ledgerContract: enabledLedger, checksums }),
    /remote execution must remain disabled/
  )
})
