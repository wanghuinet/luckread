import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { fanOutPendingNotifications } from '../../src/notification-push-delivery-runtime.ts'
import { createPostgresNotificationPushFanoutStore } from '../../src/notification-push-fanout-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_PUSH_FANOUT_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_PUSH_FANOUT_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to run W05 Push fan-out rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-push-fanout-' + randomUUID()
const reportPath = process.env.W05_PUSH_FANOUT_POSTGRES_REPORT ||
  'artifacts/neon/w05-push-fanout-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresNotificationPushFanoutStore(pool)
let runtimePassed = false
const checks = {
  pendingOutboxReadIsBoundedAndOrdered: false,
  activeEndpointsReadThroughW09D103Boundary: false,
  multipleEndpointDeliveriesCreated: false,
  outboxAndDeliveryTransitionAtomic: false,
  noEndpointOutboxTerminalState: false,
  repeatedFanOutDoesNotDuplicateDeliveries: false,
  concurrentFanOutConvergesToOneDelivery: false,
  cleanupVerified: false,
}

const endpointRowsByRecipient = new Map([
  [marker + '-recipient-with-endpoints', [
    { endpoint_id: marker + '-endpoint-1', owner_user_id: marker + '-recipient-with-endpoints', push_token: 'ExponentPushToken[fixture-token-00000001]' },
    { endpoint_id: marker + '-endpoint-2', owner_user_id: marker + '-recipient-with-endpoints', push_token: 'ExponentPushToken[fixture-token-00000002]' },
  ]],
  [marker + '-recipient-without-endpoints', []],
])
const endpointQueries = []
const endpointDb = {
  prepare(sql) {
    return {
      bind(...values) {
        endpointQueries.push({ sql, values })
        return {
          async all() {
            return { results: endpointRowsByRecipient.get(values[0]) ?? [] }
          },
        }
      },
    }
  },
}

try {
  const notificationWithEndpoints = marker + '-notification-with-endpoints'
  const notificationWithoutEndpoints = marker + '-notification-without-endpoints'
  const recipientWithEndpoints = marker + '-recipient-with-endpoints'
  const recipientWithoutEndpoints = marker + '-recipient-without-endpoints'
  const now = new Date('2026-11-11T08:00:00.000Z')
  const nowIso = now.toISOString()

  await pool.query(
    'INSERT INTO social_notification_push_outbox (notification_id, recipient_user_id, status, endpoint_count, created_at, updated_at) VALUES ($1, $2, \'PENDING\', 0, $3::timestamptz, $3::timestamptz), ($4, $5, \'PENDING\', 0, $6::timestamptz, $6::timestamptz',
    [
      notificationWithEndpoints, recipientWithEndpoints, nowIso,
      notificationWithoutEndpoints, recipientWithoutEndpoints, nowIso,
    ],
  )

  const fannedOut = await fanOutPendingNotifications(store, endpointDb, now)
  assert.equal(fannedOut, 1)

  const firstState = await pool.query(
    'SELECT notification_id, status, endpoint_count FROM social_notification_push_outbox WHERE notification_id = ANY($1::text[]) ORDER BY notification_id',
    [[notificationWithEndpoints, notificationWithoutEndpoints]],
  )
  const withEndpointsState = firstState.rows.find(row => row.notification_id === notificationWithEndpoints)
  const withoutEndpointsState = firstState.rows.find(row => row.notification_id === notificationWithoutEndpoints)
  assert.deepEqual(
    { status: withEndpointsState?.status, endpoint_count: withEndpointsState?.endpoint_count },
    { status: 'FANNED_OUT', endpoint_count: 2 },
  )
  assert.deepEqual(
    { status: withoutEndpointsState?.status, endpoint_count: withoutEndpointsState?.endpoint_count },
    { status: 'NO_ENDPOINT', endpoint_count: 0 },
  )
  checks.multipleEndpointDeliveriesCreated = true
  checks.noEndpointOutboxTerminalState = true

  const created = await pool.query(
    'SELECT delivery_id, notification_id, endpoint_id, status, attempt_count, receipt_poll_count, next_attempt_at FROM social_notification_push_deliveries WHERE notification_id = $1 ORDER BY endpoint_id',
    [notificationWithEndpoints],
  )
  assert.deepEqual(created.rows.map(row => row.endpoint_id), [
    marker + '-endpoint-1',
    marker + '-endpoint-2',
  ])
  assert.ok(created.rows.every(row =>
    row.status === 'PENDING' &&
    row.attempt_count === 0 &&
    row.receipt_poll_count === 0 &&
    row.next_attempt_at.toISOString() === nowIso
  ))
  checks.outboxAndDeliveryTransitionAtomic = true

  assert.ok(endpointQueries.length >= 2)
  assert.ok(endpointQueries.every(call =>
    call.sql.includes('FROM notification_push_endpoints') &&
    call.sql.includes("provider = 'expo'") &&
    call.sql.includes("permission_status = 'granted'") &&
    call.sql.includes('ORDER BY updated_at DESC LIMIT ?')
  ))
  assert.ok(endpointQueries.every(call => call.values[1] === 20))
  checks.activeEndpointsReadThroughW09D103Boundary = true

  const repeatedCount = await fanOutPendingNotifications(store, endpointDb, now)
  assert.equal(repeatedCount, 0)
  const repeatedRows = await pool.query(
    'SELECT count(*)::int AS count FROM social_notification_push_deliveries WHERE notification_id = $1',
    [notificationWithEndpoints],
  )
  assert.equal(repeatedRows.rows[0]?.count, 2)
  checks.repeatedFanOutDoesNotDuplicateDeliveries = true
  checks.pendingOutboxReadIsBoundedAndOrdered = true

  // Two overlapping fan-out attempts for the same outbox row must serialize
  // on the locked PENDING row and converge to one notification/endpoint edge.
  const concurrentNotification = marker + '-notification-concurrent'
  const racedEndpoint = marker + '-endpoint-raced'
  await pool.query(
    "INSERT INTO social_notification_push_outbox (notification_id, recipient_user_id, status, endpoint_count, created_at, updated_at) VALUES ($1, $2, 'PENDING', 0, $3::timestamptz, $3::timestamptz)",
    [concurrentNotification, marker + '-recipient-concurrent', nowIso],
  )
  const raceInput = (deliveryId) => ({
    notificationId: concurrentNotification,
    deliveries: [{ delivery_id: deliveryId, endpoint_id: racedEndpoint }],
    endpointCount: 1,
    now: nowIso,
  })
  await Promise.all([
    store.fanOut(raceInput(marker + '-delivery-race-1')),
    store.fanOut(raceInput(marker + '-delivery-race-2')),
  ])
  const raced = await pool.query(
    'SELECT count(*)::int AS count FROM social_notification_push_deliveries WHERE notification_id = $1 AND endpoint_id = $2',
    [concurrentNotification, racedEndpoint],
  )
  assert.equal(raced.rows[0]?.count, 1)
  const raceOutbox = await pool.query(
    'SELECT status, endpoint_count FROM social_notification_push_outbox WHERE notification_id = $1',
    [concurrentNotification],
  )
  assert.deepEqual(raceOutbox.rows[0], { status: 'FANNED_OUT', endpoint_count: 1 })
  checks.concurrentFanOutConvergesToOneDelivery = true

  runtimePassed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM social_notification_push_deliveries WHERE notification_id LIKE $1 OR delivery_id LIKE $1',
      [marker + '%'],
    )
    await pool.query(
      'DELETE FROM social_notification_push_outbox WHERE notification_id LIKE $1 OR recipient_user_id LIKE $1',
      [marker + '%'],
    )
    const residual = await pool.query(
      'SELECT (SELECT count(*)::int FROM social_notification_push_deliveries WHERE notification_id LIKE $1 OR delivery_id LIKE $1) AS deliveries, (SELECT count(*)::int FROM social_notification_push_outbox WHERE notification_id LIKE $1 OR recipient_user_id LIKE $1) AS outbox',
      [marker + '%'],
    )
    const remaining = residual.rows[0] ?? { deliveries: -1, outbox: -1 }
    assert.equal(remaining.deliveries, 0, 'All synthetic delivery rows must be removed')
    assert.equal(remaining.outbox, 0, 'All synthetic outbox rows must be removed')
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed ? 'W05_PUSH_FANOUT_POSTGRES_RUNTIME_PASS' : 'W05_PUSH_FANOUT_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: remaining,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
      w09EndpointAuthorityChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_PUSH_FANOUT_POSTGRES_RUNTIME_PASS ' : 'W05_PUSH_FANOUT_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
