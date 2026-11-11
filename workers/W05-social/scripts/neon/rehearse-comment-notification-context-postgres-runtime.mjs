import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createPostgresCommentNotificationContextStore } from '../../src/comment-notification-context-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_COMMENT_NOTIFICATION_CONTEXT_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_COMMENT_NOTIFICATION_CONTEXT_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse comment notification context outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-comment-notification-context-' + randomUUID()
const reportPath = process.env.W05_COMMENT_NOTIFICATION_CONTEXT_POSTGRES_REPORT ||
  'artifacts/neon/w05-comment-notification-context-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 })
const store = createPostgresCommentNotificationContextStore(pool)
const publishedId = marker + '-published'
const pendingId = marker + '-pending'
const createdAt = '2026-11-11T03:00:00.000Z'
const checks = {
  publishedCommentContextResolved: false,
  authorAndParentContentReturned: false,
  nonPublishedCommentHidden: false,
  missingCommentReturnsNull: false,
  cleanupVerified: false,
}
let passed = false

try {
  await pool.query(
    `INSERT INTO social_comments
       (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at)
     VALUES
       ($1, $2, $3, NULL, 'published fixture', 'PUBLISHED', 0, $4, $5::timestamptz, $5::timestamptz),
       ($6, $7, $8, NULL, 'pending fixture', 'PENDING', 0, $9, $5::timestamptz, $5::timestamptz)`,
    [
      publishedId, marker + '-content-published', marker + '-author-published', marker + '-idem-published', createdAt,
      pendingId, marker + '-content-pending', marker + '-author-pending', marker + '-idem-pending',
    ],
  )

  const published = await store.getPublishedContext(publishedId)
  assert.deepEqual(published, {
    comment_id: publishedId,
    content_id: marker + '-content-published',
    author_user_id: marker + '-author-published',
  })
  checks.publishedCommentContextResolved = true
  checks.authorAndParentContentReturned = published?.author_user_id === marker + '-author-published' &&
    published?.content_id === marker + '-content-published'

  assert.equal(await store.getPublishedContext(pendingId), null)
  checks.nonPublishedCommentHidden = true
  assert.equal(await store.getPublishedContext(marker + '-missing'), null)
  checks.missingCommentReturnsNull = true
  passed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM social_comments WHERE id = ANY($1::text[])',
      [[publishedId, pendingId]],
    )
    const residual = await pool.query(
      'SELECT count(*)::int AS count FROM social_comments WHERE id = ANY($1::text[])',
      [[publishedId, pendingId]],
    )
    assert.deepEqual(residual.rows[0], { count: 0 })
    checks.cleanupVerified = true
    const report = {
      status: passed ? 'W05_COMMENT_NOTIFICATION_CONTEXT_POSTGRES_RUNTIME_PASS' : 'W05_COMMENT_NOTIFICATION_CONTEXT_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: residual.rows[0],
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      w03ContentAuthorityChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((passed ? 'W05_COMMENT_NOTIFICATION_CONTEXT_POSTGRES_RUNTIME_PASS ' : 'W05_COMMENT_NOTIFICATION_CONTEXT_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
