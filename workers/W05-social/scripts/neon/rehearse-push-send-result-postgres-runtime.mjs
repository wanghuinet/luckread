import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { createPostgresNotificationPushSendResultStore } from '../../src/notification-push-send-result-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_PUSH_SEND_RESULT_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_PUSH_SEND_RESULT_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to run W05 push send-result rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-push-send-result-' + randomUUID()
const reportPath = process.env.W05_PUSH_SEND_RESULT_POSTGRES_REPORT ||
  'artifacts/neon/w05-push-send-result-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresNotificationPushSendResultStore(pool)
const now = new Date('2026-11-11T08:00:00.000Z')
const nowIso = now.toISOString()
const laterIso = '2026-11-11T08:15:00.000Z'
const checks = {
  validExpoTicketTransitionsToReceiptPending: false,
  staleTicketLeaseCannotOverwriteDelivery: false,
  retryableExpoErrorTransitionsToRetry: false,
  maxAttemptsPermanentErrorTransitionsToFailed: false,
  concurrentTicketAndRetryResultsConvergeToSingleLeaseWinner: false,
  cleanupVerified: false,
}
let runtimePassed = false

async function insertLeasedDelivery(deliveryId, attemptCount, leaseToken) {
  await pool.query(
    `INSERT INTO social_notification_push_deliveries
      (delivery_id, notification_id, endpoint_id, status, attempt_count, receipt_poll_count,
       next_attempt_at, lease_token, lease_expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'LEASED', $4, 0, $5::timestamptz, $6, $7::timestamptz, $5::timestamptz, $5::timestamptz)`,
    [deliveryId, marker + '-notification-' + deliveryId, marker + '-endpoint-' + deliveryId,
      attemptCount, nowIso, leaseToken, '2026-11-11T08:03:00.000Z'],
  )
}

try {
  const ticketDelivery = marker + '-ticket'
  const ticketLease = marker + '-lease-ticket'
  await insertLeasedDelivery(ticketDelivery, 1, ticketLease)
  assert.equal(await store.recordTicket({
    deliveryId: ticketDelivery,
    leaseToken: ticketLease,
    ticketId: marker + '-expo-ticket',
    nextAttemptAt: laterIso,
    now: nowIso,
  }), true)

  let state = await pool.query(
    'SELECT status, expo_ticket_id, receipt_poll_count, next_attempt_at, lease_token, lease_expires_at, last_error_code FROM social_notification_push_deliveries WHERE delivery_id = $1',
    [ticketDelivery],
  )
  assert.deepEqual(state.rows[0], {
    status: 'RECEIPT_PENDING',
    expo_ticket_id: marker + '-expo-ticket',
    receipt_poll_count: 0,
    next_attempt_at: new Date(laterIso),
    lease_token: null,
    lease_expires_at: null,
    last_error_code: null,
  })
  assert.equal(await store.scheduleRetry({
    deliveryId: ticketDelivery,
    leaseToken: ticketLease,
    status: 'RETRY',
    nextAttemptAt: laterIso,
    errorCode: 'ExpoServerError',
    now: nowIso,
  }), false)
  checks.validExpoTicketTransitionsToReceiptPending = true
  checks.staleTicketLeaseCannotOverwriteDelivery = true

  const retryDelivery = marker + '-retry'
  const retryLease = marker + '-lease-retry'
  await insertLeasedDelivery(retryDelivery, 2, retryLease)
  assert.equal(await store.scheduleRetry({
    deliveryId: retryDelivery,
    leaseToken: retryLease,
    status: 'RETRY',
    nextAttemptAt: laterIso,
    errorCode: 'ExpoServerError',
    now: nowIso,
  }), true)
  state = await pool.query(
    'SELECT status, expo_ticket_id, next_attempt_at, lease_token, lease_expires_at, last_error_code FROM social_notification_push_deliveries WHERE delivery_id = $1',
    [retryDelivery],
  )
  assert.deepEqual(state.rows[0], {
    status: 'RETRY',
    expo_ticket_id: null,
    next_attempt_at: new Date(laterIso),
    lease_token: null,
    lease_expires_at: null,
    last_error_code: 'ExpoServerError',
  })
  checks.retryableExpoErrorTransitionsToRetry = true

  const failedDelivery = marker + '-failed'
  const failedLease = marker + '-lease-failed'
  await insertLeasedDelivery(failedDelivery, 6, failedLease)
  assert.equal(await store.scheduleRetry({
    deliveryId: failedDelivery,
    leaseToken: failedLease,
    status: 'FAILED',
    nextAttemptAt: nowIso,
    errorCode: 'DeviceNotRegistered',
    now: nowIso,
  }), true)
  state = await pool.query(
    'SELECT status, last_error_code, lease_token, lease_expires_at FROM social_notification_push_deliveries WHERE delivery_id = $1',
    [failedDelivery],
  )
  assert.deepEqual(state.rows[0], {
    status: 'FAILED',
    last_error_code: 'DeviceNotRegistered',
    lease_token: null,
    lease_expires_at: null,
  })
  checks.maxAttemptsPermanentErrorTransitionsToFailed = true

  const concurrentDelivery = marker + '-concurrent'
  const concurrentLease = marker + '-lease-concurrent'
  await insertLeasedDelivery(concurrentDelivery, 1, concurrentLease)
  const outcomes = await Promise.all([
    store.recordTicket({
      deliveryId: concurrentDelivery,
      leaseToken: concurrentLease,
      ticketId: marker + '-concurrent-ticket',
      nextAttemptAt: laterIso,
      now: nowIso,
    }),
    store.scheduleRetry({
      deliveryId: concurrentDelivery,
      leaseToken: concurrentLease,
      status: 'RETRY',
      nextAttemptAt: laterIso,
      errorCode: 'ExpoServerError',
      now: nowIso,
    }),
  ])
  assert.equal(outcomes.filter(Boolean).length, 1)
  state = await pool.query(
    'SELECT status, expo_ticket_id, last_error_code, lease_token FROM social_notification_push_deliveries WHERE delivery_id = $1',
    [concurrentDelivery],
  )
  assert.ok(['RECEIPT_PENDING', 'RETRY'].includes(state.rows[0]?.status))
  assert.equal(state.rows[0]?.lease_token, null)
  checks.concurrentTicketAndRetryResultsConvergeToSingleLeaseWinner = true

  runtimePassed = true
} finally {
  try {
    await pool.query('DELETE FROM social_notification_push_deliveries WHERE delivery_id LIKE $1', [marker + '%'])
    const residual = await pool.query(
      'SELECT count(*)::int AS count FROM social_notification_push_deliveries WHERE delivery_id LIKE $1',
      [marker + '%'],
    )
    assert.equal(residual.rows[0]?.count, 0, 'All synthetic push delivery rows must be removed')
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed ? 'W05_PUSH_SEND_RESULT_POSTGRES_RUNTIME_PASS' : 'W05_PUSH_SEND_RESULT_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: residual.rows[0]?.count ?? -1,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      w09EndpointAuthorityChanged: false,
      workerBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_PUSH_SEND_RESULT_POSTGRES_RUNTIME_PASS ' : 'W05_PUSH_SEND_RESULT_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
