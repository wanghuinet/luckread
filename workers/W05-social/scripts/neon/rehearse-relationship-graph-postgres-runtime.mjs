import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import {
  clearRelationshipGraphCacheForTests,
  getRelationshipGraph,
  invalidateRelationshipGraph,
} from '../../src/relationship-graph-runtime.ts'
import { createPostgresRelationshipGraphReadStore } from '../../src/relationship-graph-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_RELATIONSHIP_GRAPH_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_RELATIONSHIP_GRAPH_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to run W05 RelationshipGraph rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-pg-relationship-graph-' + randomUUID()
const reportPath = process.env.W05_RELATIONSHIP_GRAPH_POSTGRES_REPORT || '../../artifacts/neon/w05-relationship-graph-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresRelationshipGraphReadStore(pool)
let runtimePassed = false
const checks = {
  mutualFollowAndDirectionalMute: false,
  outboundBlockHidesFollowDetails: false,
  inboundBlockHidesFollowDetails: false,
  cacheHitAvoidsSecondRead: false,
  directionalInvalidationRefreshesBlockState: false,
  selfRelationshipAvoidsStoreRead: false,
}

const insertFollow = async (follower, targetUser, relationshipId, createdAt) => {
  await pool.query(
    'INSERT INTO social_follow_relationships (relationship_id, follower_user_id, target_user_id, created_at) VALUES ($1, $2, $3, $4)',
    [relationshipId, follower, targetUser, createdAt],
  )
}

const insertInteraction = async (actor, targetUser, type, relationshipId) => {
  await pool.query(
    'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())',
    [relationshipId, actor, targetUser, type],
  )
}

try {
  const viewer = marker + '-mutual-viewer'
  const targetUser = marker + '-mutual-target'
  const viewerRelationshipId = marker + '-mutual-forward'
  await insertFollow(viewer, targetUser, viewerRelationshipId, '2026-11-10T03:00:00.123456Z')
  await insertFollow(targetUser, viewer, marker + '-mutual-reverse', '2026-11-10T03:01:00.000123Z')
  await insertInteraction(viewer, targetUser, 'mute', marker + '-mutual-mute')

  clearRelationshipGraphCacheForTests()
  const mutual = await getRelationshipGraph(store, viewer, targetUser)
  assert.equal(mutual.following, true)
  assert.equal(mutual.followedBy, true)
  assert.equal(mutual.mutualFollow, true)
  assert.equal(mutual.blocked, false)
  assert.equal(mutual.blockedBy, false)
  assert.equal(mutual.muted, true, 'Mute state is directional from the viewer to the target')
  assert.equal(mutual.relationshipId, viewerRelationshipId)
  assert.equal(mutual.createdAt, '2026-11-10T03:00:00.123Z', 'PostgreSQL timestamps remain millisecond-compatible')
  checks.mutualFollowAndDirectionalMute = true

  const failingStore = {
    async read() {
      throw new Error('RELATIONSHIP_GRAPH_CACHE_MISS')
    },
  }
  const cached = await getRelationshipGraph(failingStore, viewer, targetUser)
  assert.deepEqual(cached, mutual, 'The 5-second relationship graph cache must be provider independent')
  checks.cacheHitAvoidsSecondRead = true

  const blockViewer = marker + '-outbound-block-viewer'
  const blockTarget = marker + '-outbound-block-target'
  await insertFollow(blockViewer, blockTarget, marker + '-outbound-forward', '2026-11-10T03:10:00Z')
  await insertFollow(blockTarget, blockViewer, marker + '-outbound-reverse', '2026-11-10T03:11:00Z')
  clearRelationshipGraphCacheForTests()
  const beforeBlock = await getRelationshipGraph(store, blockViewer, blockTarget)
  assert.equal(beforeBlock.mutualFollow, true)
  await insertInteraction(blockViewer, blockTarget, 'block', marker + '-outbound-block')
  await invalidateRelationshipGraph(blockViewer, blockTarget)
  const afterBlock = await getRelationshipGraph(store, blockViewer, blockTarget)
  assert.deepEqual(
    {
      following: afterBlock.following,
      followedBy: afterBlock.followedBy,
      mutualFollow: afterBlock.mutualFollow,
      relationshipId: afterBlock.relationshipId,
      createdAt: afterBlock.createdAt,
      blocked: afterBlock.blocked,
      blockedBy: afterBlock.blockedBy,
    },
    {
      following: false,
      followedBy: false,
      mutualFollow: false,
      relationshipId: null,
      createdAt: null,
      blocked: true,
      blockedBy: false,
    },
  )
  checks.outboundBlockHidesFollowDetails = true
  checks.directionalInvalidationRefreshesBlockState = true

  const inboundViewer = marker + '-inbound-block-viewer'
  const inboundTarget = marker + '-inbound-block-target'
  await insertFollow(inboundViewer, inboundTarget, marker + '-inbound-forward', '2026-11-10T03:20:00Z')
  await insertFollow(inboundTarget, inboundViewer, marker + '-inbound-reverse', '2026-11-10T03:21:00Z')
  await insertInteraction(inboundTarget, inboundViewer, 'block', marker + '-inbound-block')
  clearRelationshipGraphCacheForTests()
  const inbound = await getRelationshipGraph(store, inboundViewer, inboundTarget)
  assert.equal(inbound.following, false)
  assert.equal(inbound.followedBy, false)
  assert.equal(inbound.mutualFollow, false)
  assert.equal(inbound.blocked, false)
  assert.equal(inbound.blockedBy, true)
  assert.equal(inbound.relationshipId, null)
  assert.equal(inbound.createdAt, null)
  checks.inboundBlockHidesFollowDetails = true

  let selfReadCount = 0
  const noReadStore = {
    async read() {
      selfReadCount += 1
      throw new Error('SELF_RELATIONSHIP_MUST_NOT_QUERY')
    },
  }
  const self = await getRelationshipGraph(noReadStore, marker + '-self', marker + '-self')
  assert.equal(self.mutualFollow, false)
  assert.equal(self.blocked, false)
  assert.equal(self.blockedBy, false)
  assert.equal(self.muted, false)
  assert.equal(selfReadCount, 0)
  checks.selfRelationshipAvoidsStoreRead = true

  runtimePassed = true
} finally {
  try {
    clearRelationshipGraphCacheForTests()
    await pool.query(
      'DELETE FROM social_follow_relationships WHERE follower_user_id LIKE $1 OR target_user_id LIKE $1',
      [marker + '%'],
    )
    await pool.query(
      'DELETE FROM social_user_interactions WHERE actor_user_id LIKE $1 OR target_user_id LIKE $1',
      [marker + '%'],
    )
    const postflight = await pool.query(
      'SELECT (SELECT count(*)::int FROM social_follow_relationships WHERE follower_user_id LIKE $1 OR target_user_id LIKE $1) AS follow_rows, (SELECT count(*)::int FROM social_user_interactions WHERE actor_user_id LIKE $1 OR target_user_id LIKE $1) AS interaction_rows',
      [marker + '%'],
    )
    const followRows = postflight.rows[0]?.follow_rows ?? -1
    const interactionRows = postflight.rows[0]?.interaction_rows ?? -1
    assert.equal(followRows, 0, 'All synthetic Follow rows must be removed')
    assert.equal(interactionRows, 0, 'All synthetic Block/Mute rows must be removed')

    const report = {
      status: runtimePassed ? 'W05_RELATIONSHIP_GRAPH_POSTGRES_RUNTIME_PASS' : 'W05_RELATIONSHIP_GRAPH_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: { follow: followRows, interactions: interactionRows },
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_RELATIONSHIP_GRAPH_POSTGRES_RUNTIME_PASS ' : 'W05_RELATIONSHIP_GRAPH_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
