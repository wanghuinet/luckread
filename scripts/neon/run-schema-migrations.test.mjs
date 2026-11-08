import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertManifestPrefixRows,
  enforceVerifiedNeonConnectionString,
  extractSqlEffects,
  isRemoteApplyReleased,
  stripOuterTransaction,
  validateLocalTarget,
  validateRemoteNeonTarget,
} from './run-schema-migrations.mjs'

const manifestEntries = [
  { order: 100, ownerWorker: 'W01', migrationId: 'W01-BASELINE', kind: 'PAYLOAD_NATIVE' },
  { order: 200, ownerWorker: 'W02', migrationId: 'W02-CORE', kind: 'GENERATED_POSTGRESQL_SQL' },
]
const checksums = [
  { migrationId: 'W01-BASELINE', artifactSha256: 'a'.repeat(64), manifestEntrySha256: '1'.repeat(64) },
  { migrationId: 'W02-CORE', artifactSha256: 'b'.repeat(64), manifestEntrySha256: '2'.repeat(64) },
]
const rows = [
  {
    domain_id: 'D1-01', database_name: 'luckread', owner_worker: 'W01',
    migration_id: 'W01-BASELINE', migration_order: 100, migration_kind: 'PAYLOAD_NATIVE',
    artifact_sha256: 'a'.repeat(64), manifest_entry_sha256: '1'.repeat(64),
    source_commit_sha: 'c'.repeat(40),
  },
  {
    domain_id: 'D1-01', database_name: 'luckread', owner_worker: 'W02',
    migration_id: 'W02-CORE', migration_order: 200, migration_kind: 'GENERATED_POSTGRESQL_SQL',
    artifact_sha256: 'b'.repeat(64), manifest_entry_sha256: '2'.repeat(64),
    source_commit_sha: 'd'.repeat(40),
  },
]

test('accepts only the disposable local PostgreSQL target', () => {
  assert.equal(validateLocalTarget('postgresql://local:secret@127.0.0.1:5432/luckread_schema').valid, true)
  assert.equal(validateLocalTarget('postgresql://local:secret@postgres:5432/luckread_schema').valid, true)
  assert.equal(validateLocalTarget('postgresql://owner:secret@ep-example.neon.tech/luckread?sslmode=require').valid, false)
  assert.equal(validateLocalTarget('postgresql://local:secret@127.0.0.1:5433/luckread_schema').valid, false)
  assert.equal(validateLocalTarget('postgresql://local:secret@127.0.0.1:5432/other').valid, false)
})

test('accepts only the exact D1-01 Neon target with required channel binding', () => {
  const host = 'ep-example-pooler.c-3.ap-southeast-1.aws.neon.tech'
  const base = 'postgresql://owner:secret@' + host + '/luckread?channel_binding=require'
  const requireMode = base + '&sslmode=require'
  const verifyFull = base + '&sslmode=verify-full'
  assert.equal(validateRemoteNeonTarget(requireMode).valid, true)
  assert.equal(validateRemoteNeonTarget(verifyFull).valid, true)
  assert.equal(validateRemoteNeonTarget('postgresql://owner:secret@ep-example.neon.tech/luckread?sslmode=require&channel_binding=require').valid, true)
  assert.equal(validateRemoteNeonTarget(requireMode.replace('/luckread?', '/luckreadpro?')).valid, false)
  assert.equal(validateRemoteNeonTarget(requireMode.replace(host, 'db.example.com')).valid, false)
  assert.equal(validateRemoteNeonTarget(requireMode.replace('sslmode=require', 'sslmode=disable')).valid, false)
  assert.equal(validateRemoteNeonTarget(requireMode.replace('&channel_binding=require', '')).valid, false)
  assert.equal(validateRemoteNeonTarget(requireMode.replace('@' + host, '@' + host + ':6432')).valid, false)
  assert.equal(validateRemoteNeonTarget(requireMode.replace('channel_binding=require', 'channel_binding=prefer')).valid, false)
  const effective = new URL(enforceVerifiedNeonConnectionString(requireMode))
  assert.equal(effective.searchParams.get('sslmode'), 'verify-full')
  assert.equal(effective.searchParams.get('channel_binding'), 'require')
})

test('keeps remote Neon execution disabled until both reviewed contracts enable it', () => {
  const manifest = { remoteApplyReady: false, execution: { runnerStatus: 'NOT_IMPLEMENTED' } }
  const ledger = { remoteApplyReady: false, execution: { runnerStatus: 'NOT_IMPLEMENTED' } }
  assert.equal(isRemoteApplyReleased(manifest, ledger), false)
  assert.equal(isRemoteApplyReleased({ ...manifest, remoteApplyReady: true }, ledger), false)
  assert.equal(isRemoteApplyReleased(
    { remoteApplyReady: true, execution: { runnerStatus: 'IMPLEMENTED_AND_REVIEWED' } },
    { remoteApplyReady: true, execution: { runnerStatus: 'IMPLEMENTED_AND_REVIEWED' } },
  ), true)
  assert.equal(isRemoteApplyReleased(
    { remoteApplyReady: true, execution: { runnerStatus: 'NOT_IMPLEMENTED' } },
    { remoteApplyReady: true, execution: { runnerStatus: 'IMPLEMENTED_AND_REVIEWED' } },
  ), false)
})

test('strips only an exact outer BEGIN/COMMIT wrapper', () => {
  const sql = '-- generated schema\n\nBEGIN;\nCREATE TABLE demo (id TEXT);\nCOMMIT;\n'
  assert.equal(stripOuterTransaction(sql, 'demo'), '-- generated schema\n\n\nCREATE TABLE demo (id TEXT);')
})

test('rejects a half-formed outer transaction wrapper', () => {
  assert.throws(() => stripOuterTransaction('BEGIN;\nCREATE TABLE demo (id TEXT);', 'broken'), /incomplete outer transaction/)
})

test('extracts quoted table effects and required extensions', () => {
  assert.deepEqual(
    extractSqlEffects('CREATE EXTENSION IF NOT EXISTS btree_gist; CREATE TABLE "user" (id text); ALTER TABLE public."user" ADD COLUMN name text;'),
    { tables: ['user'], extensions: ['btree_gist'] },
  )
})

test('accepts an exact manifest prefix with artifact and manifest checksums', () => {
  assert.deepEqual(assertManifestPrefixRows(manifestEntries, checksums, rows), manifestEntries)
  assert.deepEqual(assertManifestPrefixRows(manifestEntries, checksums, rows.slice(0, 1)), manifestEntries.slice(0, 1))
})

test('rejects ledger rows that are missing, reordered, unknown or checksum-drifted', () => {
  assert.throws(() => assertManifestPrefixRows(manifestEntries, checksums, []), /non-empty ordered prefix/)
  assert.throws(() => assertManifestPrefixRows(manifestEntries, checksums, [rows[1]]), /does not exactly match/)
  const drifted = structuredClone(rows)
  drifted[0].artifact_sha256 = 'f'.repeat(64)
  assert.throws(() => assertManifestPrefixRows(manifestEntries, checksums, drifted), /does not exactly match/)
  assert.throws(() => assertManifestPrefixRows(manifestEntries, checksums, [...rows, rows[1]]), /non-empty ordered prefix/)
})
