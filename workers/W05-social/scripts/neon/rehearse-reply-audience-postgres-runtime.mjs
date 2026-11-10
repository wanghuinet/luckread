import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import {
  getContentReplyAudience,
  setContentReplyAudience,
} from '../../src/reply-audience-runtime.ts'
import { createPostgresReplyAudienceStore } from '../../src/reply-audience-store-postgres.ts'
import {
  replyAudienceAllowedPostgresParams,
  replyAudienceAllowedPostgresSql,
} from '../../src/reply-audience-postgres-predicate.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_REPLY_AUDIENCE_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_REPLY_AUDIENCE_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const reportPath = process.env.W05_REPLY_AUDIENCE_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-reply-audience-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 })
const store = createPostgresReplyAudienceStore(pool)
const unusedD1 = { prepare() { throw new Error('Unexpected D1 access during PostgreSQL reply-audience rehearsal') } }
const marker = 'w05-reply-audience-' + randomUUID()
const owner = marker + '-owner'
const otherOwner = marker + '-other-owner'
const contentId = marker + '-content'
const mentionedUser = marker + '-mentioned'
const context = ownerUserId => ({
  contentId,
  ownerUserId,
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt: '2026-11-10T00:00:00.000Z',
})

const predicateContentIds = {
  defaultAudience: marker + '-predicate-default',
  verified: marker + '-predicate-verified',
  following: marker + '-predicate-following',
  mentioned: marker + '-predicate-mentioned',
  mentionOverride: marker + '-predicate-mention-override',
  followingNetwork: marker + '-predicate-following-network',
}
const predicateUserIds = {
  owner: marker + '-predicate-owner',
  directActor: marker + '-predicate-direct-actor',
  networkActor: marker + '-predicate-network-actor',
  middle: marker + '-predicate-middle',
  verifiedActor: marker + '-predicate-verified-actor',
  mentionedActor: marker + '-predicate-mentioned-actor',
  otherActor: marker + '-predicate-other-actor',
}

let writeReadPassed = false
let ownerConflictPassed = false
let ownerScopePassed = false
let cleanupPassed = false
let predicateMatrixPassed = false
let postgresMajor = null


async function rehearseReplyAudiencePredicate() {
  const p = predicateContentIds
  const u = predicateUserIds
  const policyRows = [
    [p.verified, u.owner, 'verified', '[]'],
    [p.following, u.owner, 'following', '[]'],
    [p.mentioned, u.owner, 'mentioned', JSON.stringify([u.mentionedActor])],
    [p.mentionOverride, u.owner, 'following', JSON.stringify([u.mentionedActor])],
    [p.followingNetwork, u.owner, 'followingNetwork', '[]'],
  ]
  for (const [policyContentId, policyOwner, audience, mentionedIds] of policyRows) {
    await pool.query(
      'INSERT INTO social_content_reply_policies ' +
      '(content_id, owner_user_id, audience, mentioned_user_ids_json, created_at, updated_at) ' +
      'VALUES ($1, $2, $3, $4, NOW(), NOW())',
      [policyContentId, policyOwner, audience, mentionedIds],
    )
  }

  await pool.query(
    'INSERT INTO social_follow_relationships ' +
    '(relationship_id, follower_user_id, target_user_id, created_at) VALUES ' +
    '($1, $2, $3, NOW()), ($4, $2, $5, NOW()), ($6, $5, $7, NOW())',
    [
      marker + '-predicate-follow-direct',
      u.owner,
      u.directActor,
      marker + '-predicate-follow-network-middle',
      u.middle,
      marker + '-predicate-follow-middle-actor',
      u.networkActor,
    ],
  )

  const assertAllowed = async (label, policyContentId, viewer, verified, expected) => {
    const result = await pool.query(
      'WITH content AS (SELECT $10::text AS id, $11::text AS owner_user_id) ' +
      'SELECT CASE WHEN ' + replyAudienceAllowedPostgresSql + ' THEN TRUE ELSE FALSE END AS allowed ' +
      'FROM content',
      [
        ...replyAudienceAllowedPostgresParams(viewer, verified),
        policyContentId,
        u.owner,
      ],
    )
    assert.equal(result.rows[0]?.allowed, expected, label)
  }

  // Default, owner bypass and trusted verification facts.
  await assertAllowed('missing policy defaults to everyone', p.defaultAudience, u.otherActor, false, true)
  await assertAllowed('owner bypasses the verified-only policy', p.verified, u.owner, false, true)
  await assertAllowed('verified actor satisfies verified-only policy', p.verified, u.verifiedActor, true, true)
  await assertAllowed('unverified actor is denied by verified-only policy', p.verified, u.verifiedActor, false, false)

  // Direct follow, mention-only access and the mention override.
  await assertAllowed('direct follower satisfies following policy', p.following, u.directActor, false, true)
  await assertAllowed('non-follower is denied by following policy', p.following, u.otherActor, false, false)
  await assertAllowed('explicit mention satisfies mentioned policy', p.mentioned, u.mentionedActor, false, true)
  await assertAllowed('unmentioned actor is denied by mentioned policy', p.mentioned, u.otherActor, false, false)
  await assertAllowed('mention overrides the following policy', p.mentionOverride, u.mentionedActor, false, true)

  // Direct and second-degree network paths, with both directions of each
  // block edge checked independently.
  await assertAllowed('direct follow satisfies followingNetwork policy', p.followingNetwork, u.directActor, false, true)
  await assertAllowed('unblocked second-degree follow satisfies followingNetwork policy', p.followingNetwork, u.networkActor, false, true)
  await assertAllowed('unrelated actor is denied by followingNetwork policy', p.followingNetwork, u.otherActor, false, false)

  const insertBlock = async (label, actor, target) => {
    await pool.query(
      'INSERT INTO social_user_interactions ' +
      '(relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) ' +
      "VALUES ($1, $2, $3, 'block', NOW(), NOW())",
      [marker + '-predicate-block-' + label, actor, target],
    )
  }
  const removeBlock = async (actor, target) => {
    await pool.query(
      "DELETE FROM social_user_interactions WHERE actor_user_id = $1 AND target_user_id = $2 AND relation_type = 'block'",
      [actor, target],
    )
  }

  for (const [label, actor, target] of [
    ['owner-middle-forward', u.owner, u.middle],
    ['owner-middle-reverse', u.middle, u.owner],
  ]) {
    await insertBlock(label, actor, target)
    await assertAllowed(label + ' blocks second-degree access', p.followingNetwork, u.networkActor, false, false)
    await removeBlock(actor, target)
  }
  for (const [label, actor, target] of [
    ['middle-actor-forward', u.middle, u.networkActor],
    ['middle-actor-reverse', u.networkActor, u.middle],
  ]) {
    await insertBlock(label, actor, target)
    await assertAllowed(label + ' blocks second-degree access', p.followingNetwork, u.networkActor, false, false)
    await removeBlock(actor, target)
  }
  return true
}

try {
  const version = await pool.query(
    "SELECT current_setting('server_version_num')::integer / 10000 AS major",
  )
  postgresMajor = Number(version.rows[0]?.major)
  assert.equal(postgresMajor, 18, 'runtime rehearsal must use PostgreSQL 18')

  const saved = await setContentReplyAudience(
    unusedD1, owner, contentId, 'mentioned', [mentionedUser, mentionedUser], context(owner), store,
  )
  assert.deepEqual(saved.mentionedUserIds, [mentionedUser])
  assert.equal(saved.replyAudience, 'mentioned')
  writeReadPassed = true

  const loaded = await getContentReplyAudience(unusedD1, owner, contentId, context(owner), store)
  assert.deepEqual(loaded, saved)

  await assert.rejects(
    setContentReplyAudience(
      unusedD1, otherOwner, contentId, 'everyone', [], context(otherOwner), store,
    ),
    error => error?.code === 'CONFLICT' && error?.status === 409,
  )
  ownerConflictPassed = true

  const otherOwnerView = await getContentReplyAudience(
    unusedD1, otherOwner, contentId, context(otherOwner), store,
  )
  assert.equal(otherOwnerView.replyAudience, 'everyone')
  assert.deepEqual(otherOwnerView.mentionedUserIds, [])
  ownerScopePassed = true

  predicateMatrixPassed = await rehearseReplyAudiencePredicate()
} finally {
  try {
    await pool.query('DELETE FROM social_content_reply_policies WHERE content_id = $1', [contentId])

    const syntheticContentIds = [contentId, ...Object.values(predicateContentIds)]
    const syntheticUserIds = [owner, otherOwner, ...Object.values(predicateUserIds)]
    await pool.query(
      'DELETE FROM social_content_reply_policies WHERE content_id = ANY($1::text[])',
      [syntheticContentIds],
    )
    await pool.query(
      'DELETE FROM social_follow_relationships WHERE follower_user_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])',
      [syntheticUserIds],
    )
    await pool.query(
      'DELETE FROM social_user_interactions WHERE actor_user_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])',
      [syntheticUserIds],
    )
    const residue = await pool.query(
      'SELECT 1 FROM social_content_reply_policies WHERE content_id = $1 LIMIT 1',
      [contentId],
    )
    assert.equal(residue.rows.length, 0, 'synthetic reply-audience policy row must be removed')
    cleanupPassed = true

    const remaining = await pool.query(
      'SELECT ' +
      '(SELECT COUNT(*)::integer FROM social_content_reply_policies WHERE content_id = ANY($1::text[])) AS policies, ' +
      '(SELECT COUNT(*)::integer FROM social_follow_relationships WHERE follower_user_id = ANY($2::text[]) OR target_user_id = ANY($2::text[])) AS follows, ' +
      '(SELECT COUNT(*)::integer FROM social_user_interactions WHERE actor_user_id = ANY($2::text[]) OR target_user_id = ANY($2::text[])) AS interactions',
      [
        [contentId, ...Object.values(predicateContentIds)],
        [owner, otherOwner, ...Object.values(predicateUserIds)],
      ],
    )
    assert.deepEqual(remaining.rows[0], { policies: 0, follows: 0, interactions: 0 })
  } finally {
    await pool.end()
  }
}

if (!writeReadPassed || !ownerConflictPassed || !ownerScopePassed || !predicateMatrixPassed || !cleanupPassed) {
  throw new Error('W05 reply-audience PostgreSQL rehearsal did not complete every assertion')
}
const report = {
  database: target.pathname.slice(1),
  postgresMajor,
  checks: {
    writeRead: writeReadPassed,
    ownerConflict: ownerConflictPassed,
    ownerScope: ownerScopePassed,
    replyAudiencePredicateMatrix: predicateMatrixPassed,
    syntheticRowsRemoved: cleanupPassed,
  },
  completedAt: new Date().toISOString(),
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('W05 reply-audience PostgreSQL 18 policy store and eligibility matrix passed; synthetic rows removed')
