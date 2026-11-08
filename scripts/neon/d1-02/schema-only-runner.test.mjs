import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildArtifactChecksums,
  canonicalJson,
  stripOuterTransaction,
  validateLocalTarget,
  validateManifestShape,
} from './schema-only-runner.mjs'

const root = process.cwd()
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-d1-02-migration-manifest.v1.json'), 'utf8'))
const readArtifact = (file) => readFileSync(resolve(root, file))

test('local target guard accepts only the disposable D1-02 PostgreSQL 18 database name and address', () => {
  assert.equal(validateLocalTarget('postgresql://postgres:local@127.0.0.1:5432/luckread_d1_02_schema').valid, true)
  assert.equal(validateLocalTarget('postgresql://postgres:local@localhost:5432/luckread_d1_02_schema').valid, true)
  assert.equal(validateLocalTarget('postgresql://postgres:local@127.0.0.1:5432/luckreadpro').valid, false)
  assert.equal(validateLocalTarget('postgresql://postgres:local@db.example.com:5432/luckread_d1_02_schema').valid, false)
  assert.equal(validateLocalTarget('https://example.com').valid, false)
})

test('D1-02 manifest is a frozen two-owner ordered schema-only plan', () => {
  assert.equal(validateManifestShape(manifest).valid, true)
  const altered = structuredClone(manifest)
  altered.entries.reverse()
  assert.equal(validateManifestShape(altered).valid, false)
  const withD1_03 = structuredClone(manifest)
  withD1_03.entries[1].artifactPaths = ['workers/W05-social/src/neon-postgres-migrations/notification_push_endpoints.sql']
  assert.equal(validateManifestShape(withD1_03).valid, false)
  const withImport = structuredClone(manifest)
  withImport.businessDataImport = true
  assert.equal(validateManifestShape(withImport).valid, false)
})

test('artifact checksums cover exact W03 then W05 generated SQL bytes', () => {
  const checksums = buildArtifactChecksums(manifest, readArtifact)
  assert.equal(checksums.length, 2)
  assert.deepEqual(checksums.map((entry) => entry.ownerWorker), ['W03', 'W05'])
  assert.deepEqual(checksums.map((entry) => entry.order), [1, 2])
  assert.equal(checksums.every((entry) => /^[0-9a-f]{64}$/.test(entry.artifactSha256)), true)
  assert.equal(checksums.every((entry) => /^[0-9a-f]{64}$/.test(entry.manifestEntrySha256)), true)
  assert.equal(checksums[0].tableNames.length, 9)
  assert.equal(checksums[1].tableNames.length, 19)
})

test('manifest checksum canonicalization ignores object property insertion order but preserves array order', () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }))
  assert.notEqual(canonicalJson(['W03', 'W05']), canonicalJson(['W05', 'W03']))
})

test('transaction wrapper is removed only when both BEGIN and COMMIT exist', () => {
  assert.equal(stripOuterTransaction('-- generated\nBEGIN;\nCREATE TABLE demo(id text);\nCOMMIT;\n'), '-- generated\n\nCREATE TABLE demo(id text);')
  assert.throws(() => stripOuterTransaction('BEGIN;\nCREATE TABLE demo(id text);'), /incomplete outer transaction wrapper/)
  assert.throws(() => stripOuterTransaction('-- empty\n'), /SQL artifact is empty/)
})
