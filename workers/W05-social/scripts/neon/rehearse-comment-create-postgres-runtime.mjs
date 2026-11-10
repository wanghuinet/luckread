import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createComment, CommentRuntimeError } from '../../src/comment-runtime.ts'
import { createPostgresCommentCreateStore } from '../../src/comment-create-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_COMMENT_CREATE_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_COMMENT_CREATE_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const reportPath = process.env.W05_COMMENT_CREATE_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-comment-create-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
const client = await pool.connect()
const store = createPostgresCommentCreateStore(client)
const unusedD1 = { prepare() { throw new Error('Unexpected D1 access during PostgreSQL comment-create rehearsal') } }
const marker = 'w05-comment-create-' + randomUUID()
const owner = marker + '-owner'
const actor = marker + '-actor'
const blockedActor = marker + '-blocked'
const deniedActor = marker + '-denied'
const raceActor = marker + '-race'
const rateActor = marker + '-rate'
const contentId = marker + '-content'
const blockedContentId = marker + '-blocked-content'
const deniedContentId = marker + '-denied-content'
const raceContentId = marker + '-race-content'
const rateContentId = marker + '-rate-content'

let rootCreated = false
let idempotentReplayPassed = false
let mismatchedIdempotencyRejected = false
let nestedReplyPassed = false
let blockedActorRejected = false
let audienceDenied = false
let audienceRaceRejected = false
let blockRaceRejected = false
let rateLimitRejected = false
let cleanupPassed = false
let postgresMajor = null

const create = (actorUserId, id, body, key, parentId = null, actorVerified = false, injectedStore = store) =>
  createComment(unusedD1, actorUserId, id, { body, parentId, idempotencyKey: key }, actorVerified, injectedStore)

try {
  const version = await client.query("SELECT current_setting('server_version_num')::integer / 10000 AS major")
  postgresMajor = Number(version.rows[0]?.major)
  assert.equal(postgresMajor, 18, 'runtime rehearsal must use PostgreSQL 18')

  // W03 owns contents. This TEMP table exists only on the disposable rehearsal
  // connection, so the harness does not mutate W03 or create a W05-owned table.
  await client.query(\`
    CREATE TEMP TABLE contents (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      state TEXT NOT NULL,
      content_type TEXT NOT NULL
    ) ON COMMIT PRESERVE ROWS
  \`)
  await client.query(
    'INSERT INTO contents (id, owner_user_id, state, content_type) VALUES ' +
    '($1, $2, $3, $4), ($5, $2, $3, $4), ($6, $2, $3, $4), ($7, $2, $3, $4), ($8, $2, $3, $4)',
    [
      contentId, owner, 'PUBLISHED', 'post',
      blockedContentId, deniedContentId, raceContentId, rateContentId,
    ],
  )

  const root = await create(actor, contentId, 'root comment', marker + '-root-key')
  assert.equal(root.state, 'PUBLISHED')
  assert.equal(root.depth, 0)
  rootCreated = true

  const replay = await create(actor, contentId, 'root comment', marker + '-root-key')
  assert.equal(replay.id, root.id)
  idempotentReplayPassed = true

  await assert.rejects(
    create(actor, contentId, 'different payload', marker + '-root-key'),
    error => error instanceof CommentRuntimeError && error.code === 'CONFLICT' && error.status === 409,
  )
  mismatchedIdempotencyRejected = true

  const nested = await create(actor, contentId, 'nested reply', marker + '-reply-key', root.id)
  assert.equal(nested.parentId, root.id)
  assert.equal(nested.depth, 1)
  nestedReplyPassed = true

  await client.query(
    "INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1, $2, $3, 'block', NOW(), NOW())",
    [marker + '-block', owner, blockedActor],
  )
  await assert.rejects(
    create(blockedActor, blockedContentId, 'blocked write', marker + '-blocked-key'),
    error => error instanceof CommentRuntimeError && error.code === 'CONFLICT' && error.status === 409,
  )
  blockedActorRejected = true

  await client.query(
    "INSERT INTO social_content_reply_policies (content_id, owner_user_id, audience, mentioned_user_ids_json, created_at, updated_at) VALUES ($1, $2, 'verified', '[]', NOW(), NOW())",
    [deniedContentId, owner],
  )
  await assert.rejects(
    create(deniedActor, deniedContentId, 'not verified', marker + '-denied-key'),
    error => error instanceof CommentRuntimeError && error.code === 'PERMISSION_DENIED' && error.status === 403,
  )
  audienceDenied = true

  // Verify the final INSERT closes a policy race between validation and write.
  const audienceRaceStore = {
    async validate(input) {
      const validation = await store.validate(input)
      await client.query(
        "INSERT INTO social_content_reply_policies (content_id, owner_user_id, audience, mentioned_user_ids_json, created_at, updated_at) VALUES ($1, $2, 'verified', '[]', NOW(), NOW()) ON CONFLICT (content_id) DO UPDATE SET audience = EXCLUDED.audience, updated_at = EXCLUDED.updated_at",
        [raceContentId, owner],
      )
      return validation
    },
    insert: input => store.insert(input),
    getFinalState: input => store.getFinalState(input),
  }
  await assert.rejects(
    create(raceActor, raceContentId, 'policy race', marker + '-race-key', null, false, audienceRaceStore),
    error => error instanceof CommentRuntimeError && error.code === 'PERMISSION_DENIED' && error.status === 403,
  )
  audienceRaceRejected = true

  // Open the policy again before testing a concurrent Block.
  await client.query(
    "UPDATE social_content_reply_policies SET audience = 'everyone', updated_at = NOW() WHERE content_id = $1",
    [raceContentId],
  )

  const blockRaceStore = {
    async validate(input) {
      const validation = await store.validate(input)
      await client.query(
        "INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1, $2, $3, 'block', NOW(), NOW())",
        [marker + '-block-race', owner, raceActor],
      )
      return validation
    },
    insert: input => store.insert(input),
    getFinalState: input => store.getFinalState(input),
  }
  await assert.rejects(
    create(raceActor, raceContentId, 'block race', marker + '-block-race-key', null, false, blockRaceStore),
    error => error instanceof CommentRuntimeError && error.code === 'CONFLICT' && error.status === 409,
  )
  blockRaceRejected = true

  for (let i = 0; i < 10; i++) {
    await client.query(
      "INSERT INTO social_comments (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at) VALUES ($1, $2, $3, NULL, 'rate fixture', 'PUBLISHED', 0, $4, NOW(), NOW())",
      [marker + '-rate-' + i, rateContentId, rateActor, marker + '-rate-key-' + i],
    )
  }
  await assert.rejects(
    create(rateActor, rateContentId, 'rate limited', marker + '-rate-reject-key'),
    error => error instanceof CommentRuntimeError && error.code === 'RATE_LIMITED' && error.status === 429,
  )
  rateLimitRejected = true
} finally {
  try {
    await client.query(
      'DELETE FROM social_comments WHERE id LIKE $1 OR author_user_id = ANY($2::text[])',
      [marker + '-%', [actor, blockedActor, deniedActor, raceActor, rateActor]],
    )
    await client.query(
      'DELETE FROM social_content_reply_policies WHERE content_id = ANY($1::text[])',
      [[deniedContentId, raceContentId]],
    )
    await client.query(
      'DELETE FROM social_user_interactions WHERE actor_user_id = ANY($1::text[]) OR target_user_id = ANY($1::text[])',
      [[owner, actor, blockedActor, deniedActor, raceActor, rateActor]],
    )
    const residue = await client.query(
      'SELECT ' +
      '(SELECT COUNT(*)::integer FROM social_comments WHERE id LIKE $1 OR author_user_id = ANY($2::text[])) AS comments, ' +
      '(SELECT COUNT(*)::integer FROM social_content_reply_policies WHERE content_id = ANY($3::text[])) AS policies, ' +
      '(SELECT COUNT(*)::integer FROM social_user_interactions WHERE actor_user_id = ANY($2::text[]) OR target_user_id = ANY($2::text[])) AS interactions',
      [
        marker + '-%',
        [actor, blockedActor, deniedActor, raceActor, rateActor],
        [deniedContentId, raceContentId],
      ],
    )
    assert.deepEqual(residue.rows[0], { comments: 0, policies: 0, interactions: 0 })
    cleanupPassed = true
  } finally {
    client.release()
    await pool.end()
  }
}

const checks = {
  rootCreated,
  idempotentReplay: idempotentReplayPassed,
  mismatchedIdempotencyRejected,
  nestedReply: nestedReplyPassed,
  blockedActorRejected,
  audienceDenied,
  audienceRaceRejected,
  blockRaceRejected,
  rateLimitRejected,
  syntheticRowsRemoved: cleanupPassed,
}
if (Object.values(checks).some(value => value !== true) || postgresMajor !== 18) {
  throw new Error('W05 PostgreSQL comment-create rehearsal did not complete every assertion: ' + JSON.stringify(checks))
}
const report = {
  database: target.pathname.slice(1),
  postgresMajor,
  checks,
  completedAt: new Date().toISOString(),
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('W05 PostgreSQL 18 comment-create store rehearsal passed; synthetic rows removed')
