import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { listRelations } from '../../src/block-mute-runtime.ts'
import { createPostgresBlockMuteListReadStore } from '../../src/block-mute-list-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_BLOCK_MUTE_LIST_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_BLOCK_MUTE_LIST_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to run W05 Block/Mute list rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-pg-block-mute-list-' + randomUUID()
const reportPath = process.env.W05_BLOCK_MUTE_LIST_POSTGRES_REPORT || '../../artifacts/neon/w05-block-mute-list-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresBlockMuteListReadStore(pool)
let runtimePassed = false
const checks = {
  blockListActorAndTypeScoped: false,
  muteListActorAndTypeScoped: false,
  blockPaginationPreservesMicrosecondOrdering: false,
  mutePaginationVerified: false,
  pageLimitPlusOneAndNoDuplicates: false,
  cleanupVerified: false,
}

const insertRelation = async (actor, targetUser, relationType, relationshipId, createdAt) => {
  await pool.query(
    'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)',
    [relationshipId, actor, targetUser, relationType, createdAt],
  )
}

try {
  const viewer = marker + '-viewer'
  const blockedNewest = marker + '-blocked-newest'
  const blockedOlder = marker + '-blocked-older'
  const mutedNewest = marker + '-muted-newest'
  const mutedOlder = marker + '-muted-older'
  const otherActorBlock = marker + '-other-actor-block'
  const otherActorMute = marker + '-other-actor-mute'

  // Two records share the same public millisecond but differ in PostgreSQL
  // microseconds. The opaque cursor must retain the exact ordering value.
  await insertRelation(viewer, blockedOlder, 'block', marker + '-block-old', '2026-11-10T04:00:00.000100Z')
  await insertRelation(viewer, blockedNewest, 'block', marker + '-block-new', '2026-11-10T04:00:00.000900Z')
  await insertRelation(viewer, mutedOlder, 'mute', marker + '-mute-old', '2026-11-10T04:01:00.000100Z')
  await insertRelation(viewer, mutedNewest, 'mute', marker + '-mute-new', '2026-11-10T04:01:00.000900Z')
  await insertRelation(otherActorBlock, marker + '-not-viewer-block', 'block', marker + '-other-block-id', '2026-11-10T04:02:00Z')
  await insertRelation(otherActorMute, marker + '-not-viewer-mute', 'mute', marker + '-other-mute-id', '2026-11-10T04:02:00Z')

  const blockPageOne = await listRelations(store, viewer, 'block', null, 1)
  assert.deepEqual(blockPageOne.items.map(item => item.targetUserId), [blockedNewest])
  assert.equal(blockPageOne.items[0]?.createdAt, '2026-11-10T04:00:00.000Z')
  assert.equal(blockPageOne.hasMore, true)
  assert.ok(blockPageOne.nextCursor)
  checks.blockListActorAndTypeScoped = true

  const decodedBlockCursor = JSON.parse(atob(
    blockPageOne.nextCursor.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - blockPageOne.nextCursor.length % 4) % 4),
  ))
  assert.equal(decodedBlockCursor.createdAt, '2026-11-10T04:00:00.000900Z',
    'Cursor timestamp retains the exact PostgreSQL microseconds')

  const blockPageTwo = await listRelations(store, viewer, 'block', blockPageOne.nextCursor, 1)
  assert.deepEqual(blockPageTwo.items.map(item => item.targetUserId), [blockedOlder])
  assert.equal(blockPageTwo.items[0]?.createdAt, '2026-11-10T04:00:00.000Z')
  assert.equal(blockPageTwo.hasMore, false)
  assert.equal(blockPageTwo.nextCursor, null)
  assert.equal(new Set([...blockPageOne.items, ...blockPageTwo.items].map(item => item.relationshipId)).size, 2)
  checks.blockPaginationPreservesMicrosecondOrdering = true
  checks.pageLimitPlusOneAndNoDuplicates = true

  const mutePageOne = await listRelations(store, viewer, 'mute', null, 1)
  assert.deepEqual(mutePageOne.items.map(item => item.targetUserId), [mutedNewest])
  assert.equal(mutePageOne.hasMore, true)
  assert.ok(mutePageOne.nextCursor)
  const mutePageTwo = await listRelations(store, viewer, 'mute', mutePageOne.nextCursor, 1)
  assert.deepEqual(mutePageTwo.items.map(item => item.targetUserId), [mutedOlder])
  assert.equal(mutePageTwo.hasMore, false)
  assert.equal(new Set([...mutePageOne.items, ...mutePageTwo.items].map(item => item.relationshipId)).size, 2)
  checks.muteListActorAndTypeScoped = true
  checks.mutePaginationVerified = true

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
    assert.equal(remainingRows, 0, 'All synthetic Block/Mute rows must be removed')
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed ? 'W05_BLOCK_MUTE_LIST_POSTGRES_RUNTIME_PASS' : 'W05_BLOCK_MUTE_LIST_POSTGRES_RUNTIME_FAILED',
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
    console.log((runtimePassed ? 'W05_BLOCK_MUTE_LIST_POSTGRES_RUNTIME_PASS ' : 'W05_BLOCK_MUTE_LIST_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
