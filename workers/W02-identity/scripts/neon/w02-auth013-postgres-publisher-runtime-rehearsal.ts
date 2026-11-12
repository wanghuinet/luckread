import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

import { publishPendingAccountStateEventsPostgres } from '../../src/neon/account-state-publication-journal-publisher-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')
const target = new URL(connectionString)
if (
  !new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_schema'
) {
  throw new Error('Refusing AUTH-013 publisher rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 })
const journalIds: string[] = []
const now = new Date().toISOString()

function eventFor(resourceId: string, sourceVersion: number) {
  const eventId = randomUUID()
  return {
    eventId,
    eventType: 'identity.account_state_changed',
    schemaVersion: '1.0',
    producer: 'W02',
    resourceType: 'User',
    resourceId,
    occurredAt: now,
    publishedAt: now,
    correlationId: eventId,
    causationId: eventId,
    idempotencyKey: 'auth013-rehearsal-' + eventId,
    attempt: 1,
    sourceVersion,
    actor: { actorId: resourceId, actorType: 'user' },
    before: { accountState: 'PENDING_VERIFICATION', accountStateVersion: 1 },
    after: { accountState: 'ACTIVE', accountStateVersion: 2 },
    reason: 'email_verified',
  }
}

async function insertJournal(event: ReturnType<typeof eventFor>): Promise<string> {
  const journalId = randomUUID()
  journalIds.push(journalId)
  await pool.query(
    'INSERT INTO auth_013_publication_journal (' +
      'journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
      'payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code' +
    ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
    [
      journalId, event.eventId, event.eventType, event.schemaVersion, event.resourceId,
      event.sourceVersion, JSON.stringify(event), 'PENDING', 1, null, now, null, null,
    ],
  )
  return journalId
}

try {
  const deliveredAuth: unknown[] = []
  const deliveredProjection: unknown[] = []
  const successJournalId = await insertJournal(eventFor('w02auth013ok' + randomUUID().slice(0, 8), 2))
  const success = await publishPendingAccountStateEventsPostgres(pool, {
    auth013: { send: async (message) => { deliveredAuth.push(message) } },
    projection: { send: async (message) => { deliveredProjection.push(message) } },
  }, now)
  assert.deepEqual(success, { selected: 1, published: 1, failed: 0 })
  assert.equal(deliveredAuth.length, 1)
  assert.equal(deliveredProjection.length, 1)
  const published = await pool.query<{ status: string; publishedAt: Date | null }>(
    'SELECT status, published_at AS "publishedAt" FROM auth_013_publication_journal WHERE journal_id = $1',
    [successJournalId],
  )
  assert.equal(published.rows[0]?.status, 'PUBLISHED')
  assert.ok(published.rows[0]?.publishedAt)

  const retryJournalId = await insertJournal(eventFor('w02auth013retry' + randomUUID().slice(0, 8), 2))
  const retry = await publishPendingAccountStateEventsPostgres(pool, {
    auth013: { send: async () => undefined },
    projection: { send: async () => { throw new Error('synthetic queue delivery failure') } },
  }, now)
  assert.deepEqual(retry, { selected: 1, published: 0, failed: 1 })
  const pending = await pool.query<{
    status: string
    attempt: number
    nextAttemptAt: Date | null
    lastErrorCode: string | null
  }>(
    'SELECT status, attempt, next_attempt_at AS "nextAttemptAt", last_error_code AS "lastErrorCode" ' +
      'FROM auth_013_publication_journal WHERE journal_id = $1',
    [retryJournalId],
  )
  assert.equal(pending.rows[0]?.status, 'PENDING')
  assert.equal(Number(pending.rows[0]?.attempt), 2)
  assert.ok(pending.rows[0]?.nextAttemptAt)
  assert.equal(pending.rows[0]?.lastErrorCode, 'QUEUE_DESTINATION_FAILED')

  console.log(JSON.stringify({
    event: 'w02.auth013.postgres.publisher.rehearsal.passed',
    success: { selected: success.selected, published: success.published, bothQueues: true },
    retry: { selected: retry.selected, failed: retry.failed, attemptIncremented: true },
    databaseTarget: 'disposable-postgresql-18-only',
  }))
} finally {
  if (journalIds.length > 0) {
    await pool.query('DELETE FROM auth_013_publication_journal WHERE journal_id = ANY($1::text[])', [journalIds])
  }
  await pool.end()
}
