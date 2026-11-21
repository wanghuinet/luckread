import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { listFollowingAuthorIds } from '../../src/follow-runtime.ts'
import { createPostgresFollowingAuthorIdsReadStore } from '../../src/following-author-ids-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_FOLLOWING_AUTHOR_IDS_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_FOLLOWING_AUTHOR_IDS_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to run W05 Following author IDs rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-pg-following-author-ids-' + randomUUID()
const reportPath = process.env.W05_FOLLOWING_AUTHOR_IDS_POSTGRES_REPORT || '../../artifacts/neon/w05-following-author-ids-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresFollowingAuthorIdsReadStore(pool)
let runtimePassed = false
const checks = {
  followsScopedToViewer: false,
  outboundBlockExcluded: false,
  inboundBlockExcluded: false,
  viewerDirectedMuteExcluded: false,
  reverseMuteDoesNotHideAuthor: false,
  stableFollowOrderingPreserved: false,
  authorOnlyProjectionPreserved: false,
  candidateWindowCappedAt500: false,
  candidateWindowTruncationReported: false,
  cleanupVerified: false,
}

const insertFollow = async (follower, targetUser, relationshipId, createdAt) => {
  await pool.query(
    'INSERT INTO social_follow_relationships (relationship_id, follower_user_id, target_user_id, created_at) VALUES ($1, $2, $3, $4)',
    [relationshipId, follower, targetUser, createdAt],
  )
}

const insertInteraction = async (actor, targetUser, relationType, relationshipId, createdAt) => {
  await pool.query(
    'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)',
    [relationshipId, actor, targetUser, relationType, createdAt],
  )
}

try {
  const viewer = marker + '-policy-viewer'
  const visibleOld = marker + '-visible-old'
  const visibleNew = marker + '-visible-new'
  const outboundBlocked = marker + '-outbound-blocked'
  const inboundBlocked = marker + '-inbound-blocked'
  const viewerMuted = marker + '-viewer-muted'
  const reverseMuted = marker + '-reverse-muted'
  const otherActor = marker + '-other-actor'
  const otherActorOnly = marker + '-other-actor-only'

  await insertFollow(viewer, visibleOld, marker + '-follow-visible-old', '2026-11-10T04:00:00.000100Z')
  await insertFollow(viewer, visibleNew, marker + '-follow-visible-new', '2026-11-10T04:03:00.000100Z')
  await insertFollow(viewer, outboundBlocked, marker + '-follow-outbound-blocked', '2026-11-10T04:04:00.000100Z')
  await insertFollow(viewer, inboundBlocked, marker + '-follow-inbound-blocked', '2026-11-10T04:05:00.000100Z')
  await insertFollow(viewer, viewerMuted, marker + '-follow-viewer-muted', '2026-11-10T04:06:00.000100Z')
  await insertFollow(viewer, reverseMuted, marker + '-follow-reverse-muted', '2026-11-10T04:02:00.000100Z')
  await insertFollow(otherActor, otherActorOnly, marker + '-follow-other-actor', '2026-11-10T04:07:00.000100Z')

  await insertInteraction(viewer, outboundBlocked, 'block', marker + '-block-outbound', '2026-11-10T04:08:00.000100Z')
  await insertInteraction(inboundBlocked, viewer, 'block', marker + '-block-inbound', '2026-11-10T04:09:00.000100Z')
  await insertInteraction(viewer, viewerMuted, 'mute', marker + '-mute-viewer-directed', '2026-11-10T04:10:00.000100Z')
  await insertInteraction(reverseMuted, viewer, 'mute', marker + '-mute-reverse-direction', '2026-11-10T04:11:00.000100Z')

  const policyResult = await listFollowingAuthorIds(store, viewer)
  const policyIds = policyResult.items.map(item => item.userId)
  assert.deepEqual(policyIds, [visibleNew, reverseMuted, visibleOld])
  assert.equal(policyResult.candidateWindowTruncated, false)
  assert.equal(policyIds.includes(outboundBlocked), false)
  assert.equal(policyIds.includes(inboundBlocked), false)
  assert.equal(policyIds.includes(viewerMuted), false)
  assert.equal(policyIds.includes(otherActorOnly), false)
  checks.followsScopedToViewer = true
  checks.outboundBlockExcluded = true
  checks.inboundBlockExcluded = true
  checks.viewerDirectedMuteExcluded = true
  checks.reverseMuteDoesNotHideAuthor = true
  checks.stableFollowOrderingPreserved = true
  checks.authorOnlyProjectionPreserved = Object.keys(policyResult.items[0] ?? {}).sort().join(',') === 'userId'
  assert.equal(checks.authorOnlyProjectionPreserved, true)

  const bulkViewer = marker + '-bulk-viewer'
  const bulkCount = 501
  const values = []
  const tuples = []
  for (let index = 1; index <= bulkCount; index += 1) {
    const offset = values.length
    tuples.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::timestamptz)`)
    values.push(
      marker + '-bulk-follow-' + String(index).padStart(4, '0'),
      bulkViewer,
      marker + '-bulk-author-' + String(index).padStart(4, '0'),
      '2026-11-10T05:00:00.000000Z',
    )
  }
  await pool.query(
    `INSERT INTO social_follow_relationships (relationship_id, follower_user_id, target_user_id, created_at) VALUES ${tuples.join(', ')}`,
    values,
  )

  const bulkResult = await listFollowingAuthorIds(store, bulkViewer)
  assert.equal(bulkResult.items.length, 500)
  assert.equal(bulkResult.candidateWindowTruncated, true)
  assert.equal(bulkResult.items[0]?.userId, marker + '-bulk-author-0501')
  assert.equal(bulkResult.items[499]?.userId, marker + '-bulk-author-0002')
  assert.equal(new Set(bulkResult.items.map(item => item.userId)).size, 500)
  assert.ok(bulkResult.items.every(item => Object.keys(item).join(',') === 'userId'))
  checks.candidateWindowCappedAt500 = true
  checks.candidateWindowTruncationReported = true

  runtimePassed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM social_follow_relationships WHERE follower_user_id LIKE $1 OR target_user_id LIKE $1 OR relationship_id LIKE $1',
      [marker + '%'],
    )
    await pool.query(
      'DELETE FROM social_user_interactions WHERE actor_user_id LIKE $1 OR target_user_id LIKE $1 OR relationship_id LIKE $1',
      [marker + '%'],
    )
    const postflight = await pool.query(
      'SELECT (SELECT count(*)::int FROM social_follow_relationships WHERE follower_user_id LIKE $1 OR target_user_id LIKE $1 OR relationship_id LIKE $1) AS follow_rows, (SELECT count(*)::int FROM social_user_interactions WHERE actor_user_id LIKE $1 OR target_user_id LIKE $1 OR relationship_id LIKE $1) AS interaction_rows',
      [marker + '%'],
    )
    const remainingFollowRows = postflight.rows[0]?.follow_rows ?? -1
    const remainingInteractionRows = postflight.rows[0]?.interaction_rows ?? -1
    assert.equal(remainingFollowRows, 0, 'All synthetic Follow rows must be removed')
    assert.equal(remainingInteractionRows, 0, 'All synthetic Block/Mute rows must be removed')
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed ? 'W05_FOLLOWING_AUTHOR_IDS_POSTGRES_RUNTIME_PASS' : 'W05_FOLLOWING_AUTHOR_IDS_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: { follow: remainingFollowRows, interactions: remainingInteractionRows },
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_FOLLOWING_AUTHOR_IDS_POSTGRES_RUNTIME_PASS ' : 'W05_FOLLOWING_AUTHOR_IDS_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
