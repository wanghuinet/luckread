import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DOMAIN_MANIFESTS,
  assertLedgerPrefixRows,
  buildDomainPlan,
  canonicalJson,
  parseCommandLine,
  stripOuterTransaction,
  validateLocalTarget,
  validateManifestShape,
} from './shared-domain-schema-runner.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readSource = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
const readBytes = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath))

function loadManifest(domainId) {
  return JSON.parse(readSource(DOMAIN_MANIFESTS[domainId]))
}

test('D1-03 manifest combines only admitted W06, W09 and W10 owner schemas', () => {
  const manifest = loadManifest('D1-03')
  const shape = validateManifestShape(manifest)
  assert.equal(shape.valid, true, shape.errors.join('; '))
  const plan = buildDomainPlan(manifest, { readSource, readBytes })
  assert.equal(plan.tables.length, 15)
  assert.equal(plan.indexes.length, 22)
  assert.equal(plan.triggers.length, 2)
  assert.equal(plan.functions.length, 1)
  assert.equal(plan.references.length, 2)
  const w10 = manifest.entries.find((entry) => entry.logicalOwnerWorker === 'W10')
  assert.equal(w10.ownerWorker, 'W09')
  assert.equal(w10.migrationConfigOwner, 'W09')
  assert.equal(w10.schemaContract, 'contracts/database/neon-d1-03-w10-execution-schema.v1.json')
  assert.equal(plan.tables.includes('moderation_appeals'), false)
  assert.equal(plan.tables.includes('campaigns'), false)
  assert.equal(plan.tables.includes('growth_operations'), false)
})

test('D1-04 combines all seven admitted source migrations in six ordered PostgreSQL artifacts', () => {
  const manifest = loadManifest('D1-04')
  const shape = validateManifestShape(manifest)
  assert.equal(shape.valid, true, shape.errors.join('; '))
  const plan = buildDomainPlan(manifest, { readSource, readBytes })
  assert.equal(shape.sourceMigrationCount, 7)
  assert.equal(plan.entries.length, 6)
  assert.equal(plan.tables.length, 15)
  assert.equal(plan.indexes.length, 31)
  assert.equal(plan.triggers.length, 72)
  assert.equal(plan.functions.length, 6)
  assert.equal(plan.references.length, 0)
  assert.ok(plan.entries[5].effects.triggerOperations.some((item) =>
    item.operation === 'DROP' && item.name === 'payment_provider_events_terminal_immutable'))
})

test('D1-05 remains local-rehearsal eligible but remote-admission blocked', () => {
  const manifest = loadManifest('D1-05')
  const shape = validateManifestShape(manifest)
  assert.equal(shape.valid, true, shape.errors.join('; '))
  const plan = buildDomainPlan(manifest, { readSource, readBytes })
  assert.equal(plan.tables.length, 6)
  assert.equal(plan.indexes.length, 8)
  assert.equal(plan.triggers.length, 0)
  assert.equal(plan.functions.length, 0)
  assert.equal(manifest.remoteApplyReady, false)
  assert.ok(manifest.remoteApplyBlockers.some((item) => /retention/i.test(item)))
  assert.ok(manifest.remoteApplyBlockers.some((item) => /deletion/i.test(item)))
  assert.ok(manifest.remoteApplyBlockers.some((item) => /consent/i.test(item)))
})

test('shared runner accepts only an explicit local-only D1-03/D1-04/D1-05 command', () => {
  assert.deepEqual(parseCommandLine(['--domain', 'D1-03', '--local-only']), {
    valid: true,
    domainId: 'D1-03',
  })
  assert.equal(parseCommandLine(['--domain', 'D1-04', '--remote-neon']).valid, false)
  assert.equal(parseCommandLine(['--domain', 'D1-01', '--local-only']).valid, false)
  assert.equal(parseCommandLine(['--local-only']).valid, false)
})

test('local connection URLs are pinned to loopback, port 5432 and the matching domain database', () => {
  const d103 = loadManifest('D1-03')
  assert.equal(validateLocalTarget(
    'postgresql://postgres:local_only@127.0.0.1:5432/luckread_d1_03_shared',
    d103,
  ).valid, true)
  assert.equal(validateLocalTarget(
    'postgresql://postgres:local_only@db.example.com:5432/luckread_d1_03_shared',
    d103,
  ).valid, false)
  assert.equal(validateLocalTarget(
    'postgresql://postgres:local_only@127.0.0.1:5432/luckread_finance',
    d103,
  ).valid, false)
  assert.equal(validateLocalTarget(
    'postgresql://postgres:local_only@127.0.0.1:6543/luckread_d1_03_shared',
    d103,
  ).valid, false)
})

test('transaction stripping accepts plain SQL or exact outer BEGIN/COMMIT and rejects partial wrappers', () => {
  assert.equal(stripOuterTransaction('-- only a comment\nSELECT 1;', 'plain'), '-- only a comment\nSELECT 1;')
  assert.equal(stripOuterTransaction('-- header\nBEGIN;\nCREATE TABLE x(id int);\nCOMMIT;\n', 'wrapped'),
    '-- header\n\nCREATE TABLE x(id int);')
  assert.throws(() => stripOuterTransaction('BEGIN;\nCREATE TABLE x(id int);', 'partial'),
    /incomplete outer transaction wrapper/)
})

test('manifest rejects unapproved ledger owner, path traversal, and remote enablement', () => {
  const baseline = loadManifest('D1-03')
  const wrongOwner = structuredClone(baseline)
  wrongOwner.entries[2].ownerWorker = 'W10'
  wrongOwner.entries[2].migrationConfigOwner = 'W10'
  assert.equal(validateManifestShape(wrongOwner).valid, false)

  const unsafePath = structuredClone(baseline)
  unsafePath.entries[0].artifactPaths = ['workers/../../secrets.sql']
  assert.equal(validateManifestShape(unsafePath).valid, false)

  const remoteEnabled = structuredClone(baseline)
  remoteEnabled.remoteApplyReady = true
  assert.equal(validateManifestShape(remoteEnabled).valid, false)
})

test('shared ledger accepts only an exact ordered prefix and fails closed on checksum drift', () => {
  const manifest = loadManifest('D1-04')
  const plan = buildDomainPlan(manifest, { readSource, readBytes })
  const item = plan.entries[0]
  const row = {
    domain_id: manifest.domainId,
    database_name: manifest.databaseName,
    owner_worker: item.entry.ownerWorker,
    migration_id: item.entry.migrationId,
    migration_order: item.entry.order,
    migration_kind: item.entry.kind,
    artifact_sha256: item.artifactSha256,
    manifest_entry_sha256: item.manifestEntrySha256,
    source_commit_sha: 'a'.repeat(40),
    runner_version: 'prior-version',
    execution_id: 'local-test-1',
  }
  assert.equal(assertLedgerPrefixRows(manifest, plan, [row]).length, 1)
  assert.throws(() => assertLedgerPrefixRows(manifest, plan, [{...row,artifact_sha256:'b'.repeat(64)}]),
    /does not exactly match/)
  assert.throws(() => assertLedgerPrefixRows(manifest, plan, [{...row,owner_worker:'W10'}]),
    /does not exactly match/)
})

test('canonical manifest-entry hashes are independent of object key order', () => {
  assert.equal(canonicalJson({b:2,a:{y:1,x:0}}), canonicalJson({a:{x:0,y:1},b:2}))
})
