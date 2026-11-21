import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDomainPlan } from '../shared-domain-schema-runner.mjs'
import {
  validateRemoteNeonTarget,
  enforceVerifiedNeonConnectionString,
  validateRemoteApplyContext,
  parseCommandLine,
  verifyRemoteTlsConnection,
  assertD104LedgerRows,
  assertD104ExactIndexNames,
  assertD104IndexCatalog,
} from './schema-only-runner.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json'), 'utf8'))
const plan = buildDomainPlan(manifest)
const host = 'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech'
const url = (overrides = '') =>
  'postgresql://neondb_owner:local-test-only@' + host +
  '/luckread_finance?sslmode=require&channel_binding=require' + overrides

test('D1-04 plan is the exact six-entry W07-only shared migration manifest', () => {
  assert.equal(manifest.domainId, 'D1-04')
  assert.equal(manifest.databaseName, 'luckread_finance')
  assert.equal(manifest.cloudflareD1DatabaseUuid, '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736')
  assert.equal(plan.entries.length, 6)
  assert.ok(plan.entries.every((item) => item.entry.ownerWorker === 'W07'))
  assert.equal(plan.tables.length, 15)
  assert.equal(plan.indexes.length, 31)
  assert.equal(manifest.expected.constraintIndexes, 29)
  assert.equal(manifest.expected.constraintIndexNames.length, manifest.expected.constraintIndexes)
  assert.equal(plan.triggers.length, 72)
  assert.equal(plan.functions.length, 6)
  assert.equal(plan.references.length, 0)
  assert.equal(plan.controlSeedRows, 1)
  assert.equal(manifest.expected.businessRows, 0)
  assert.equal(manifest.remoteApplyReady, false)
  assert.equal(manifest.businessDataImport, false)
  assert.equal(manifest.productionCutoverAuthorized, false)
})

test('remote target accepts only the pinned Neon endpoint, exact D1-04 database, TLS and channel binding', () => {
  const result = validateRemoteNeonTarget(url())
  assert.equal(result.valid, true)
  assert.equal(result.parsed.hostname, host)
  assert.equal(validateRemoteNeonTarget(url('&application_name=luckread')).valid, true)
})

test('remote target rejects missing credentials, wrong host, wrong database and unsafe TLS parameters', () => {
  assert.equal(validateRemoteNeonTarget('').reason, 'NEON_DATABASE_URL_FINANCE is required')
  assert.equal(validateRemoteNeonTarget('postgres://user:pass@' + host + '/luckread_finance').valid, false)
  assert.equal(validateRemoteNeonTarget(url().replace(host, 'evil.example')).valid, false)
  assert.equal(validateRemoteNeonTarget(url().replace('/luckread_finance?', '/luckread?')).valid, false)
  assert.equal(validateRemoteNeonTarget(url().replace('sslmode=require', 'sslmode=disable')).valid, false)
  assert.equal(validateRemoteNeonTarget(url().replace('channel_binding=require', 'channel_binding=prefer')).valid, false)
  assert.equal(validateRemoteNeonTarget(url() + '&sslmode=verify-full').valid, false)
  assert.equal(validateRemoteNeonTarget(url().replace('neondb_owner:local-test-only@', '@')).valid, false)
})

test('remote connection is hardened to sslmode=verify-full and channel_binding=require', () => {
  const hardened = new URL(enforceVerifiedNeonConnectionString(url()))
  assert.equal(hardened.searchParams.get('sslmode'), 'verify-full')
  assert.equal(hardened.searchParams.get('channel_binding'), 'require')
  assert.equal(hardened.hostname, host)
  assert.equal(hardened.pathname, '/luckread_finance')
})

test('remote apply requires GitHub Actions, main and exact D1-04 confirmation', () => {
  const valid = validateRemoteApplyContext({
    githubActions: 'true',
    githubRef: 'refs/heads/main',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_04_FINANCE',
  })
  assert.deepEqual(valid, { valid: true, errors: [] })
  assert.equal(validateRemoteApplyContext({
    githubActions: 'false',
    githubRef: 'refs/heads/main',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_04_FINANCE',
  }).valid, false)
  assert.equal(validateRemoteApplyContext({
    githubActions: 'true',
    githubRef: 'refs/heads/feature',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_04_FINANCE',
  }).valid, false)
  assert.equal(validateRemoteApplyContext({
    githubActions: 'true',
    githubRef: 'refs/heads/main',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_03_GOVERNANCE',
  }).valid, false)
})

test('CLI refuses local execution and accepts only the explicit remote mode', () => {
  assert.deepEqual(parseCommandLine(['--remote-neon']), { valid: true, mode: 'REMOTE_NEON' })
  assert.equal(parseCommandLine(['--local-only']).valid, false)
  assert.equal(parseCommandLine([]).valid, false)
  assert.equal(parseCommandLine(['--remote-neon', '--local-only']).valid, false)
})

test('TLS verification fails closed when the PostgreSQL connection has no verified peer certificate', () => {
  assert.throws(() => verifyRemoteTlsConnection({ connection: { stream: {} } }), /TLS certificate chain or hostname verification failed/)
  assert.throws(() => verifyRemoteTlsConnection({}), /TLS certificate chain or hostname verification failed/)
})

function ledgerRow(index) {
  const checksum = plan.ledgerChecksums[index]
  const entry = manifest.entries[index]
  return {
    domain_id: 'D1-04',
    database_name: 'luckread_finance',
    owner_worker: entry.ownerWorker,
    migration_id: entry.migrationId,
    migration_order: entry.order,
    migration_kind: entry.kind,
    artifact_sha256: checksum.artifactSha256,
    manifest_entry_sha256: checksum.manifestEntrySha256,
    source_commit_sha: 'a'.repeat(40),
    runner_version: 'd1-04-schema-runner/1.0.0',
    execution_id: 'github-test-1-1',
  }
}

test('D1-04 ledger accepts only an exact ordered manifest prefix', () => {
  assert.equal(assertD104LedgerRows(manifest, plan, []).length, 0)
  assert.equal(assertD104LedgerRows(manifest, plan, [ledgerRow(0)]).length, 1)
  assert.equal(assertD104LedgerRows(manifest, plan, manifest.entries.map((_, index) => ledgerRow(index))).length, 6)
})

test('D1-04 ledger rejects domain contamination, wrong order, owner drift and checksum drift', () => {
  assert.throws(() => assertD104LedgerRows(manifest, plan, [{ ...ledgerRow(0), domain_id: 'D1-02' }]), /another logical domain/)
  assert.throws(() => assertD104LedgerRows(manifest, plan, [{ ...ledgerRow(0), database_name: 'luckreadpro' }]), /another logical domain/)
  assert.throws(() => assertD104LedgerRows(manifest, plan, [{ ...ledgerRow(0), migration_id: manifest.entries[1].migrationId }]), /does not exactly match/)
  assert.throws(() => assertD104LedgerRows(manifest, plan, [{ ...ledgerRow(0), owner_worker: 'W10' }]), /does not exactly match/)
  assert.throws(() => assertD104LedgerRows(manifest, plan, [{ ...ledgerRow(0), artifact_sha256: 'b'.repeat(64) }]), /does not exactly match/)
  assert.throws(() => assertD104LedgerRows(manifest, plan, [{ ...ledgerRow(0), manifest_entry_sha256: 'c'.repeat(64) }]), /does not exactly match/)
  assert.throws(() => assertD104LedgerRows(manifest, plan, manifest.entries.map((_, index) => ledgerRow(index)).concat(ledgerRow(0))), /ordered prefix/)
})

test('D1-04 final catalog requires the exact explicit index set, with no extras or omissions', () => {
  assert.equal(assertD104ExactIndexNames(['a_idx', 'b_idx'], ['b_idx', 'a_idx']), 2)
  assert.throws(
    () => assertD104ExactIndexNames(['a_idx', 'b_idx'], ['a_idx', 'b_idx', 'unexpected_idx']),
    /unexpected=\[unexpected_idx\]/,
  )
  assert.throws(
    () => assertD104ExactIndexNames(['a_idx', 'b_idx'], ['a_idx']),
    /missing=\[b_idx\]/,
  )
  assert.throws(
    () => assertD104ExactIndexNames(['a_idx'], ['a_idx', 'a_idx']),
    /index set differs/,
  )
})

test('D1-04 final catalog separates explicit indexes from PostgreSQL constraint-backed indexes', () => {
  const catalogRows = [
    ...plan.indexes.map((indexname) => ({ indexname, constraint_backed: false })),
    ...manifest.expected.constraintIndexNames.map((indexname) => ({ indexname, constraint_backed: true })),
  ]
  assert.deepEqual(assertD104IndexCatalog(manifest, plan, catalogRows), {
    explicitIndexes: 31,
    constraintIndexes: 29,
  })
  assert.throws(
    () => assertD104IndexCatalog(manifest, plan, [
      ...catalogRows,
      { indexname: 'unexpected_explicit_idx', constraint_backed: false },
    ]),
    /unexpected=\[unexpected_explicit_idx\]/,
  )
  assert.throws(
    () => assertD104IndexCatalog(manifest, plan, [
      ...catalogRows,
      { indexname: 'unexpected_constraint_key', constraint_backed: true },
    ]),
    /unexpected=\[unexpected_constraint_key\]/,
  )
  assert.throws(
    () => assertD104IndexCatalog(manifest, plan, [
      ...catalogRows.filter((row) => row.indexname !== manifest.expected.constraintIndexNames[0]),
    ]),
    /missing=\[/,
  )
  assert.throws(
    () => assertD104IndexCatalog(manifest, plan, [
      ...catalogRows,
      { indexname: 'malformed_idx', constraint_backed: 'true' },
    ]),
    /catalog row is malformed/,
  )
})

test('D1-04 control metadata is explicitly bounded to the single approved W07 scheduler row', () => {
  const seed = manifest.seedRows[0]
  assert.equal(seed.table, 'subscription_renewal_scheduler_state')
  assert.equal(seed.kind, 'SCHEMA_CONTROL_METADATA_NOT_BUSINESS_DATA')
  assert.equal(seed.ownerWorker, 'W07')
  assert.deepEqual(seed.rows, [{
    state_id: 'subscription-renewals',
    cursor_period_end: null,
    cursor_subscription_id: null,
    version: 1,
    updated_at: '1970-01-01T00:00:00.000Z',
  }])
  assert.equal(manifest.expected.controlSeedRows, 1)
})
