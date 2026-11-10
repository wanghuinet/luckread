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

let writeReadPassed = false
let ownerConflictPassed = false
let ownerScopePassed = false
let cleanupPassed = false
let postgresMajor = null

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
} finally {
  try {
    await pool.query('DELETE FROM social_content_reply_policies WHERE content_id = $1', [contentId])
    const residue = await pool.query(
      'SELECT 1 FROM social_content_reply_policies WHERE content_id = $1 LIMIT 1',
      [contentId],
    )
    assert.equal(residue.rows.length, 0, 'synthetic reply-audience policy row must be removed')
    cleanupPassed = true
  } finally {
    await pool.end()
  }
}

if (!writeReadPassed || !ownerConflictPassed || !ownerScopePassed || !cleanupPassed) {
  throw new Error('W05 reply-audience PostgreSQL rehearsal did not complete every assertion')
}
const report = {
  database: target.pathname.slice(1),
  postgresMajor,
  checks: {
    writeRead: writeReadPassed,
    ownerConflict: ownerConflictPassed,
    ownerScope: ownerScopePassed,
    syntheticRowsRemoved: cleanupPassed,
  },
  completedAt: new Date().toISOString(),
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('W05 reply-audience PostgreSQL 18 rehearsal passed; synthetic row removed')
