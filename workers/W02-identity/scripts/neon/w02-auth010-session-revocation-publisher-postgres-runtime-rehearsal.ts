import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import { buildSessionRevokedEvent } from '../../src/auth/session-revocation-events.js'
import { publishPendingSessionRevocationEventsPostgres } from '../../src/neon/session-revocation-publisher-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing AUTH-010 publisher rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({
  connectionString,
  max: 8,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(workerRoot, 'artifacts/neon/w02-auth010-session-revocation-publisher-postgres-runtime-rehearsal.json')
const suffix = randomUUID().replaceAll('-', '').slice(0, 20).toLowerCase()
const now = new Date().toISOString()
const resourceIds = {
  success: 'session-auth010-pub-success-' + suffix,
  retry: 'session-auth010-pub-retry-' + suffix,
  invalid: 'session-auth010-pub-invalid-' + suffix,
  concurrent: 'session-auth010-pub-concurrent-' + suffix,
}
const actorIds = {
  success: 'user-auth010-pub-success-' + suffix,
  retry: 'user-auth010-pub-retry-' + suffix,
  concurrent: 'user-auth010-pub-concurrent-' + suffix,
}
let primaryError: unknown
let cleanupError: unknown
let cleanupVerified = false

const insertJournal = async (input: {
  resourceId: string
  eventId: string
  idempotencyKey: string
  payload: string
  attempt?: number
}): Promise<void> => {
  await pool.query(
    'INSERT INTO auth_010_session_revocation_journal ' +
      '(journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
      'idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
      "VALUES ($1, $2, 'user.session.revoked', '1.0', $3, 1, $4, $5, 'PENDING', $6, NULL, $7, NULL, NULL)",
    [
      'auth010-publisher-journal-' + randomUUID().replaceAll('-', ''),
      input.eventId,
      input.resourceId,
      input.idempotencyKey,
      input.payload,
      input.attempt ?? 1,
      now,
    ],
  )
}

const makeEvent = (resourceId: string, actorId: string) =>
  buildSessionRevokedEvent({
    sessionId: resourceId,
    userId: actorId,
    occurredAt: now,
    correlationId: 'req_auth010_pub_' + suffix,
    causationId: 'trace-auth010-pub:' + suffix,
  })

const readJournal = async (resourceId: string) => {
  const result = await pool.query<{
    status: string
    attempt: number
    nextAttemptAt: Date | string | null
    publishedAt: Date | string | null
    lastErrorCode: string | null
    payload: string
  }>(
    'SELECT status, attempt, next_attempt_at AS "nextAttemptAt", published_at AS "publishedAt", ' +
      'last_error_code AS "lastErrorCode", payload ' +
      'FROM auth_010_session_revocation_journal WHERE resource_id = $1',
    [resourceId],
  )
  assert.equal(result.rows.length, 1, 'expected exactly one AUTH-010 journal row')
  return result.rows[0]!
}

const checks: Record<string, boolean> = {
  validEventsSentToExistingQueueAndMarkedPublished: false,
  queueFailureUsesBoundedBackoffAndPreservesPendingState: false,
  invalidEventIsQuarantinedWithoutQueueDelivery: false,
  concurrentPublisherRunsDoNotDoubleSendLockedRow: false,
  syntheticJournalRowsCleaned: false,
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  const successEvent = await makeEvent(resourceIds.success, actorIds.success)
  await insertJournal({
    resourceId: resourceIds.success,
    eventId: successEvent.eventId,
    idempotencyKey: successEvent.idempotencyKey,
    payload: JSON.stringify(successEvent),
  })
  const delivered: unknown[] = []
  const successQueue = { send: async (message: unknown) => { delivered.push(message) } }
  const success = await publishPendingSessionRevocationEventsPostgres(
    pool,
    successQueue,
    now,
    1,
  )
  assert.deepEqual(success, { selected: 1, published: 1, failed: 0 })
  assert.deepEqual(delivered, [successEvent])
  const publishedRow = await readJournal(resourceIds.success)
  assert.equal(publishedRow.status, 'PUBLISHED')
  assert.equal(Number(publishedRow.attempt), 1)
  assert.equal(publishedRow.nextAttemptAt, null)
  assert.ok(publishedRow.publishedAt)
  assert.equal(publishedRow.lastErrorCode, null)
  checks.validEventsSentToExistingQueueAndMarkedPublished = true

  const retryEvent = await makeEvent(resourceIds.retry, actorIds.retry)
  await insertJournal({
    resourceId: resourceIds.retry,
    eventId: retryEvent.eventId,
    idempotencyKey: retryEvent.idempotencyKey,
    payload: JSON.stringify(retryEvent),
    attempt: 3,
  })
  const unavailableQueue = { send: async () => { throw new Error('synthetic queue failure') } }
  const retry = await publishPendingSessionRevocationEventsPostgres(
    pool,
    unavailableQueue,
    now,
    1,
  )
  assert.deepEqual(retry, { selected: 1, published: 0, failed: 1 })
  const retryRow = await readJournal(resourceIds.retry)
  assert.equal(retryRow.status, 'PENDING')
  assert.equal(Number(retryRow.attempt), 4)
  assert.equal(new Date(retryRow.nextAttemptAt as Date | string).toISOString(),
    new Date(Date.parse(now) + 4_000).toISOString())
  assert.equal(retryRow.lastErrorCode, 'QUEUE_DESTINATION_FAILED')
  assert.equal(retryRow.publishedAt, null)
  checks.queueFailureUsesBoundedBackoffAndPreservesPendingState = true

  await insertJournal({
    resourceId: resourceIds.invalid,
    eventId: 'evt_' + suffix.padEnd(32, '0').slice(0, 32),
    idempotencyKey: 'AUTH010_SESSION_REVOKE_' + suffix.padEnd(32, '0').slice(0, 32),
    payload: JSON.stringify({ notAnAuth010Event: true }),
  })
  let invalidSendCount = 0
  const invalidQueue = { send: async () => { invalidSendCount += 1 } }
  const invalid = await publishPendingSessionRevocationEventsPostgres(
    pool,
    invalidQueue,
    now,
    1,
  )
  assert.deepEqual(invalid, { selected: 1, published: 0, failed: 1 })
  assert.equal(invalidSendCount, 0)
  const invalidRow = await readJournal(resourceIds.invalid)
  assert.equal(invalidRow.status, 'FAILED')
  assert.equal(invalidRow.nextAttemptAt, null)
  assert.equal(invalidRow.lastErrorCode, 'INVALID_EVENT_PAYLOAD')
  checks.invalidEventIsQuarantinedWithoutQueueDelivery = true

  const concurrentEvent = await makeEvent(resourceIds.concurrent, actorIds.concurrent)
  await insertJournal({
    resourceId: resourceIds.concurrent,
    eventId: concurrentEvent.eventId,
    idempotencyKey: concurrentEvent.idempotencyKey,
    payload: JSON.stringify(concurrentEvent),
  })
  let concurrentSends = 0
  const concurrentQueue = {
    send: async () => {
      concurrentSends += 1
      await new Promise((resolve) => setTimeout(resolve, 150))
    },
  }
  const concurrent = await Promise.all([
    publishPendingSessionRevocationEventsPostgres(pool, concurrentQueue, now, 1),
    publishPendingSessionRevocationEventsPostgres(pool, concurrentQueue, now, 1),
  ])
  assert.equal(concurrentSends, 1)
  assert.equal(concurrent.reduce((total, item) => total + item.selected, 0), 1)
  assert.equal(concurrent.reduce((total, item) => total + item.published, 0), 1)
  assert.equal(await (async () => (await readJournal(resourceIds.concurrent)).status)(), 'PUBLISHED')
  checks.concurrentPublisherRunsDoNotDoubleSendLockedRow = true
} catch (error) {
  primaryError = error
} finally {
  try {
    const resources = Object.values(resourceIds)
    await pool.query(
      'DELETE FROM auth_010_session_revocation_journal WHERE resource_id = ANY($1::text[])',
      [resources],
    )
    const residual = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM auth_010_session_revocation_journal WHERE resource_id = ANY($1::text[])',
      [resources],
    )
    cleanupVerified = Number(residual.rows[0]?.count ?? -1) === 0
    checks.syntheticJournalRowsCleaned = cleanupVerified
    assert.equal(cleanupVerified, true, 'all synthetic AUTH-010 journal rows must be removed')
  } catch (error) {
    cleanupError = error
  }
  await pool.end()
}

const failure = primaryError ?? cleanupError
const report = {
  reportVersion: 1,
  status: failure ? 'W02_AUTH010_SESSION_REVOCATION_PUBLISHER_POSTGRES_RUNTIME_REHEARSAL_FAILED' :
    'W02_AUTH010_SESSION_REVOCATION_PUBLISHER_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only AUTH-010 PostgreSQL outbox publisher against disposable PostgreSQL 18; production W02 remains on D1-01.',
  postgresMajor: 18,
  database: 'luckread_schema',
  checks,
  assertionsPassed: Object.values(checks).filter(Boolean).length,
  cleanupVerified,
  existingQueueBindingChanged: false,
  productionWorkerChanged: false,
  productionD1Touched: false,
  neonRemoteTouched: false,
  businessDataImported: false,
  productionCutoverAuthorized: false,
  error: failure instanceof Error ? failure.message.slice(0, 240) : null,
}
mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')

if (failure) {
  console.error('W02_AUTH010_SESSION_REVOCATION_PUBLISHER_POSTGRES_RUNTIME_REHEARSAL_FAILED ' + report.error)
  process.exitCode = 1
} else {
  console.log('W02_AUTH010_SESSION_REVOCATION_PUBLISHER_POSTGRES_RUNTIME_REHEARSAL_PASS ' + JSON.stringify(report))
}
