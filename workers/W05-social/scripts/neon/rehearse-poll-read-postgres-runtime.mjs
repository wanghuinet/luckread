import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { getContentPoll, SocialPollError } from '../../src/poll-runtime.ts'
import { createPostgresPollReadStore } from '../../src/poll-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_POLL_READ_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_POLL_READ_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const reportPath = process.env.W05_POLL_READ_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-poll-read-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
const client = await pool.connect()
const store = createPostgresPollReadStore(client)
const unusedD1 = { prepare() { throw new Error('Unexpected D1 access during PostgreSQL poll-read rehearsal') } }
const marker = 'w05-poll-read-' + randomUUID()
const pollId = marker + '-poll'
const contentId = marker + '-content'
const owner = marker + '-owner'
const viewer = marker + '-viewer'
const optionOne = marker + '-option-1'
const optionTwo = marker + '-option-2'
const voteOne = marker + '-vote-1'
const voteTwo = marker + '-vote-2'
const publishedAt = new Date(Date.now() - 60_000).toISOString()
const now = new Date().toISOString()
let publicRead = false
let expiryPersisted = false
let aggregatesCorrect = false
let viewerVoteCorrect = false
let blockFailsClosed = false
let ownerBlockLookupSkipped = false
let cleanupPassed = false

const publishedContext = {
  contentId,
  ownerUserId: owner,
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt: publishedAt,
}
const expectNotFound = async (promise) => {
  await assert.rejects(promise, error =>
    error instanceof SocialPollError && error.code === 'NOT_FOUND' && error.status === 404,
  )
}

try {
  await client.query(
    `INSERT INTO social_polls
      (poll_id, content_id, owner_user_id, duration_hours, duration_minutes, ends_at, created_at, updated_at)
     VALUES ($1, $2, $3, 24, 5, NULL, $4::timestamptz, $4::timestamptz)`,
    [pollId, contentId, owner, now],
  )
  await client.query(
    `INSERT INTO social_poll_options (option_id, poll_id, option_text, position)
     VALUES ($1, $3, 'Yes', 0), ($2, $3, 'No', 1)`,
    [optionOne, optionTwo, pollId],
  )
  await client.query(
    `INSERT INTO social_poll_votes (vote_id, poll_id, option_id, user_id, created_at)
     VALUES ($1, $3, $4, $5, $6::timestamptz), ($2, $3, $7, $8, $6::timestamptz)`,
    [voteOne, voteTwo, pollId, optionOne, viewer, now, optionTwo, owner],
  )

  const result = await getContentPoll(unusedD1, contentId, viewer, publishedContext, store)
  assert.ok(result)
  assert.equal(result.durationMinutes, 5)
  assert.equal(result.totalVotes, 2)
  assert.equal(result.viewerOptionId, optionOne)
  assert.equal(result.options.length, 2)
  assert.equal(result.options[0]?.votes, 1)
  assert.equal(result.options[1]?.votes, 1)
  assert.equal(result.endsAt, new Date(Date.parse(publishedAt) + 5 * 60_000).toISOString())
  assert.equal(result.closed, false)
  publicRead = true
  aggregatesCorrect = result.totalVotes === 2 && result.options[0]?.votes === 1 && result.options[1]?.votes === 1
  viewerVoteCorrect = result.viewerOptionId === optionOne

  const persisted = await store.getPoll(contentId)
  assert.equal(persisted?.ends_at, result.endsAt)
  expiryPersisted = true

  await store.setEndsAtIfUnset(pollId, new Date(Date.now() + 24 * 60 * 60_000).toISOString())
  const afterConditionalWrite = await store.getPoll(contentId)
  assert.equal(afterConditionalWrite?.ends_at, result.endsAt)

  await client.query(
    `INSERT INTO social_user_interactions
      (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at)
     VALUES ($1, $2, $3, 'block', $4::timestamptz, $4::timestamptz)`,
    [marker + '-block', owner, viewer, now],
  )
  await expectNotFound(getContentPoll(unusedD1, contentId, viewer, publishedContext, store))
  blockFailsClosed = true

  // Owners retain access to their own poll without an unnecessary Block lookup.
  const ownerRead = await getContentPoll(unusedD1, contentId, owner, publishedContext, store)
  assert.equal(ownerRead?.pollId, pollId)
  ownerBlockLookupSkipped = true
} finally {
  try {
    await client.query('DELETE FROM social_user_interactions WHERE relationship_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_poll_votes WHERE vote_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_poll_options WHERE option_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_polls WHERE poll_id LIKE $1', [marker + '-%'])
    const residue = await client.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM social_polls WHERE poll_id LIKE $1) AS polls,
         (SELECT COUNT(*)::integer FROM social_poll_options WHERE option_id LIKE $1) AS options,
         (SELECT COUNT(*)::integer FROM social_poll_votes WHERE vote_id LIKE $1) AS votes,
         (SELECT COUNT(*)::integer FROM social_user_interactions WHERE relationship_id LIKE $1) AS interactions`,
      [marker + '-%'],
    )
    assert.deepEqual(residue.rows[0], { polls: 0, options: 0, votes: 0, interactions: 0 })
    cleanupPassed = true
  } finally {
    client.release()
    await pool.end()
  }
}

const checks = {
  publicPollRead: publicRead,
  optionVoteAggregates: aggregatesCorrect,
  viewerVoteProjection: viewerVoteCorrect,
  lazyExpiryPersisted: expiryPersisted,
  BlockFailsClosed: blockFailsClosed,
  ownerReadSkipsBlockLookup: ownerBlockLookupSkipped,
  syntheticRowsRemoved: cleanupPassed,
}
if (Object.values(checks).some(value => value !== true)) {
  throw new Error('W05 PostgreSQL poll-read rehearsal did not complete every assertion: ' + JSON.stringify(checks))
}
const report = {
  database: target.pathname.slice(1),
  postgresMajor: 18,
  checks,
  completedAt: new Date().toISOString(),
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('W05 PostgreSQL 18 poll-read store rehearsal passed; synthetic rows removed')
