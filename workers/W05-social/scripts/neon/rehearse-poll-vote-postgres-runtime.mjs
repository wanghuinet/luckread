import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { castContentPollVote, SocialPollError } from '../../src/poll-runtime.ts'
import { createPostgresPollReadStore } from '../../src/poll-read-store-postgres.ts'
import { createPostgresPollVoteStore } from '../../src/poll-vote-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_POLL_VOTE_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_POLL_VOTE_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const reportPath = process.env.W05_POLL_VOTE_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-poll-vote-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
const client = await pool.connect()
const readStore = createPostgresPollReadStore(client)
const voteStore = createPostgresPollVoteStore(client)
const unusedD1 = {
  prepare() { throw new Error('Unexpected D1 access during PostgreSQL poll-vote rehearsal') },
  batch() { throw new Error('Unexpected D1 batch during PostgreSQL poll-vote rehearsal') },
}
const marker = 'w05-poll-vote-' + randomUUID()
const owner = marker + '-owner'
const now = new Date()
const nowIso = now.toISOString()
const future = new Date(now.getTime() + 60 * 60_000).toISOString()
const past = new Date(now.getTime() - 60_000).toISOString()
const makeW03Binding = (expectedOwner, override = {}) => ({
  async fetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init)
    const parts = new URL(request.url).pathname.split('/').filter(Boolean)
    const contentId = decodeURIComponent(parts.at(-3) ?? '')
    const ownerUserId = decodeURIComponent(parts.at(-1) ?? '')
    return Response.json({
      data: {
        contentId,
        ownerUserId: expectedOwner ?? ownerUserId,
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: nowIso,
        ...override,
      },
    })
  },
})
const contentContextBinding = (ownerUserId, override) => makeW03Binding(ownerUserId, override)
const expectSocialError = async (promise, code, status) => {
  await assert.rejects(
    promise,
    error => error instanceof SocialPollError && error.code === code && error.status === status,
  )
}
const createPoll = async ({ suffix, endsAt = future }) => {
  const pollId = marker + '-' + suffix + '-poll'
  const contentId = marker + '-' + suffix + '-content'
  const options = [marker + '-' + suffix + '-option-1', marker + '-' + suffix + '-option-2']
  await client.query(
    `INSERT INTO social_polls
      (poll_id, content_id, owner_user_id, duration_hours, duration_minutes, ends_at, created_at, updated_at)
     VALUES ($1, $2, $3, 24, 1440, $4::timestamptz, $5::timestamptz, $5::timestamptz)`,
    [pollId, contentId, owner, endsAt, nowIso],
  )
  for (const [position, optionId] of options.entries()) {
    await client.query(
      `INSERT INTO social_poll_options (option_id, poll_id, option_text, position)
       VALUES ($1, $2, $3, $4)`,
      [optionId, pollId, position === 0 ? 'Yes' : 'No', position],
    )
  }
  return { pollId, contentId, options }
}
const checkVoteCount = async (pollId) => {
  const result = await client.query(
    'SELECT COUNT(*)::integer AS count FROM social_poll_votes WHERE poll_id = $1',
    [pollId],
  )
  return result.rows[0].count
}

let firstVoteSaved = false
let repeatedSameChoiceIsIdempotent = false
let changedChoiceRejected = false
let bidirectionalBlockDenied = false
let expiredPollDenied = false
let invalidOptionDenied = false
let pollOwnerContextMismatchDenied = false
let syntheticRowsRemoved = false
let pollFixture = null
let expiredFixture = null

try {
  pollFixture = await createPoll({ suffix: 'open' })
  const binding = contentContextBinding(owner)

  const firstVote = await castContentPollVote(
    unusedD1, binding, marker + '-voter', pollFixture.contentId, pollFixture.options[0],
    marker + '-correlation-first', voteStore, readStore,
  )
  assert.equal(firstVote.viewerOptionId, pollFixture.options[0])
  assert.equal(firstVote.totalVotes, 1)
  firstVoteSaved = true

  const repeatedVote = await castContentPollVote(
    unusedD1, binding, marker + '-voter', pollFixture.contentId, pollFixture.options[0],
    marker + '-correlation-repeat', voteStore, readStore,
  )
  assert.equal(repeatedVote.viewerOptionId, pollFixture.options[0])
  assert.equal(repeatedVote.totalVotes, 1)
  repeatedSameChoiceIsIdempotent = true

  await expectSocialError(
    castContentPollVote(
      unusedD1, binding, marker + '-voter', pollFixture.contentId, pollFixture.options[1],
      marker + '-correlation-different', voteStore, readStore,
    ),
    'ALREADY_VOTED',
    409,
  )
  changedChoiceRejected = true

  const blockedVoter = marker + '-blocked-viewer'
  await client.query(
    `INSERT INTO social_user_interactions
      (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at)
     VALUES ($1, $2, $3, 'block', $4::timestamptz, $4::timestamptz)`,
    [marker + '-block-out', blockedVoter, owner, nowIso],
  )
  const reverseBlockedVoter = marker + '-reverse-block-viewer'
  await client.query(
    `INSERT INTO social_user_interactions
      (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at)
     VALUES ($1, $2, $3, 'block', $4::timestamptz, $4::timestamptz)`,
    [marker + '-block-in', owner, reverseBlockedVoter, nowIso],
  )
  await expectSocialError(
    castContentPollVote(
      unusedD1, binding, blockedVoter, pollFixture.contentId, pollFixture.options[0],
      marker + '-correlation-block-out', voteStore, readStore,
    ),
    'NOT_FOUND',
    404,
  )
  await expectSocialError(
    castContentPollVote(
      unusedD1, binding, reverseBlockedVoter, pollFixture.contentId, pollFixture.options[0],
      marker + '-correlation-block-in', voteStore, readStore,
    ),
    'NOT_FOUND',
    404,
  )
  assert.equal(await checkVoteCount(pollFixture.pollId), 1)
  bidirectionalBlockDenied = true

  await expectSocialError(
    castContentPollVote(
      unusedD1, binding, marker + '-invalid-option-viewer', pollFixture.contentId,
      marker + '-not-a-real-option', marker + '-correlation-invalid-option', voteStore, readStore,
    ),
    'VALIDATION_FAILED',
    400,
  )
  invalidOptionDenied = true

  const mismatchedOwnerBinding = contentContextBinding(marker + '-different-owner')
  await expectSocialError(
    castContentPollVote(
      unusedD1, mismatchedOwnerBinding, marker + '-mismatch-viewer', pollFixture.contentId,
      pollFixture.options[0], marker + '-correlation-owner-mismatch', voteStore, readStore,
    ),
    'NOT_FOUND',
    404,
  )
  pollOwnerContextMismatchDenied = true

  expiredFixture = await createPoll({ suffix: 'expired', endsAt: past })
  await expectSocialError(
    castContentPollVote(
      unusedD1, binding, marker + '-expired-viewer', expiredFixture.contentId,
      expiredFixture.options[0], marker + '-correlation-expired', voteStore, readStore,
    ),
    'POLL_CLOSED',
    409,
  )
  assert.equal(await checkVoteCount(expiredFixture.pollId), 0)
  expiredPollDenied = true
} finally {
  try {
    await client.query('DELETE FROM social_poll_votes WHERE vote_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_user_interactions WHERE relationship_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_poll_options WHERE option_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_polls WHERE poll_id LIKE $1', [marker + '-%'])
    const residue = await client.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM social_polls WHERE poll_id LIKE $1) AS polls,
         (SELECT COUNT(*)::integer FROM social_poll_options WHERE option_id LIKE $1) AS options,
         (SELECT COUNT(*)::integer FROM social_poll_votes WHERE vote_id LIKE $1) AS votes,
         (SELECT COUNT(*)::integer FROM social_user_interactions WHERE relationship_id LIKE $1) AS blocks`,
      [marker + '-%'],
    )
    assert.deepEqual(residue.rows[0], { polls: 0, options: 0, votes: 0, blocks: 0 })
    syntheticRowsRemoved = true
  } finally {
    client.release()
    await pool.end()
  }
}

const checks = {
  firstVoteSaved,
  repeatedSameChoiceIsIdempotent,
  changedChoiceRejected,
  bidirectionalBlockDenied,
  expiredPollDenied,
  invalidOptionDenied,
  pollOwnerContextMismatchDenied,
  syntheticRowsRemoved,
}
if (Object.values(checks).some(value => value !== true)) {
  throw new Error('W05 PostgreSQL poll-vote rehearsal did not complete every assertion: ' + JSON.stringify(checks))
}
const report = {
  database: target.pathname.slice(1),
  postgresMajor: 18,
  checks,
  d1Touched: false,
  remoteNeonTouched: false,
  completedAt: new Date().toISOString(),
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('W05 PostgreSQL 18 poll-vote store rehearsal passed; synthetic rows removed')
