import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { getRelation, removeRelation, setRelation } from '../../src/block-mute-runtime.ts'
import { createPostgresBlockMuteRelationStore } from '../../src/block-mute-relation-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_BLOCK_MUTE_RELATION_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_BLOCK_MUTE_RELATION_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to run W05 Block/Mute relation rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-pg-block-mute-relation-' + randomUUID()
const reportPath = process.env.W05_BLOCK_MUTE_RELATION_POSTGRES_REPORT || '../../artifacts/neon/w05-block-mute-relation-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresBlockMuteRelationStore(pool)
let runtimePassed = false
const checks = {
  blockSetAndReadVerified: false,
  concurrentBlockSetConverges: false,
  originalBlockIdentityAndTimestampsPreserved: false,
  muteIsIndependentFromBlock: false,
  removeIsIdempotentAndTypeScoped: false,
  cleanupVerified: false,
}

const assertBlockRows = async (viewer, targetUser) => {
  const result = await pool.query(
    'SELECT count(*)::int AS relation_rows FROM social_user_interactions WHERE actor_user_id = $1 AND target_user_id = $2',
    [viewer, targetUser],
  )
  return result.rows[0]?.relation_rows ?? -1
}

try {
  const viewer = marker + '-viewer'
  const targetUser = marker + '-target'

  const block = await setRelation(store, viewer, targetUser, 'block')
  const readBack = await getRelation(store, viewer, targetUser, 'block')
  assert.deepEqual(readBack, block)
  assert.equal(await assertBlockRows(viewer, targetUser), 1)
  checks.blockSetAndReadVerified = true

  const duplicateResults = await Promise.all([
    setRelation(store, viewer, targetUser, 'block'),
    setRelation(store, viewer, targetUser, 'block'),
  ])
  assert.equal(duplicateResults[0]?.relationshipId, block.relationshipId)
  assert.equal(duplicateResults[1]?.relationshipId, block.relationshipId)
  assert.equal(duplicateResults[0]?.createdAt, block.createdAt)
  assert.equal(duplicateResults[1]?.createdAt, block.createdAt)
  assert.equal(duplicateResults[0]?.updatedAt, block.updatedAt)
  assert.equal(duplicateResults[1]?.updatedAt, block.updatedAt)
  checks.concurrentBlockSetConverges = true
  checks.originalBlockIdentityAndTimestampsPreserved = true

  const mute = await setRelation(store, viewer, targetUser, 'mute')
  assert.equal(mute.relationType, 'mute')
  assert.equal((await getRelation(store, viewer, targetUser, 'block'))?.relationshipId, block.relationshipId)
  assert.equal((await getRelation(store, viewer, targetUser, 'mute'))?.relationshipId, mute.relationshipId)
  assert.equal(await assertBlockRows(viewer, targetUser), 2)
  checks.muteIsIndependentFromBlock = true

  await removeRelation(store, viewer, targetUser, 'block')
  await removeRelation(store, viewer, targetUser, 'block')
  assert.equal(await getRelation(store, viewer, targetUser, 'block'), null)
  assert.equal((await getRelation(store, viewer, targetUser, 'mute'))?.relationshipId, mute.relationshipId)
  assert.equal(await assertBlockRows(viewer, targetUser), 1)
  checks.removeIsIdempotentAndTypeScoped = true

  runtimePassed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM social_user_interactions WHERE actor_user_id LIKE $1 OR target_user_id LIKE $1',
      [marker + '%'],
    )
    const postflight = await pool.query(
      'SELECT count(*)::int AS remaining_rows FROM social_user_interactions WHERE actor_user_id LIKE $1 OR target_user_id LIKE $1',
      [marker + '%'],
    )
    const remainingRows = postflight.rows[0]?.remaining_rows ?? -1
    assert.equal(remainingRows, 0, 'All synthetic Block/Mute relation rows must be removed')
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed ? 'W05_BLOCK_MUTE_RELATION_POSTGRES_RUNTIME_PASS' : 'W05_BLOCK_MUTE_RELATION_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: { interactions: remainingRows },
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_BLOCK_MUTE_RELATION_POSTGRES_RUNTIME_PASS ' : 'W05_BLOCK_MUTE_RELATION_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
