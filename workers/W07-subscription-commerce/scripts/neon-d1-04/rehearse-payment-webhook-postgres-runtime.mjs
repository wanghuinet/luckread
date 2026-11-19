import assert from 'node:assert/strict'
import { createHmac, randomUUID, webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { PaymentPersistenceError } from '../../src/payment-contracts.ts'
import { receiveHyperswitchWebhook } from '../../src/payment-persistence.ts'
import { createPostgresWebhookD1Database } from '../../src/payment-webhook-database-postgres.ts'
import { receiveHyperswitchPaymentWebhookPostgres } from '../../src/payment-webhook-payment-postgres.ts'

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W07_PAYMENT_WEBHOOK_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W07_PAYMENT_WEBHOOK_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_finance_schema') {
  throw new Error('Refusing to rehearse W07 payment webhook outside disposable local PostgreSQL luckread_finance_schema')
}

const reportPath = process.env.W07_PAYMENT_WEBHOOK_POSTGRES_REPORT ||
  'artifacts/neon/w07-payment-webhook-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5_000 })
const database = createPostgresWebhookD1Database(pool)
const marker = 'w07-payment-webhook-pg18-' + randomUUID().replaceAll('-', '')
const merchantId = marker + '-merchant'
const secret = 'postgres18-local-webhook-secret-' + randomUUID()
const now = new Date()
const nowIso = now.toISOString()
const priorIso = new Date(now.getTime() - 5 * 60_000).toISOString()
const providerUpdatedAt = new Date(now.getTime() - 2_000).toISOString()
const checks = {
  signedSuccessReceiptApplied: false,
  paymentAndOrderCommittedTogether: false,
  samePayloadReplayReturnsDuplicate: false,
  payloadConflictPreservesFirstReceipt: false,
  midBatchFailureRollsBackPaymentOrderAndReceipt: false,
  nativePaymentAndOrderCommittedTogether: false,
  nativeSamePayloadReplayReturnsDuplicate: false,
  nativePayloadConflictPreservesFirstReceipt: false,
  fixtureRowsCleaned: false,
}

function randomPaymentId() {
  return 'pay_' + randomUUID().replaceAll('-', '').slice(0, 26)
}

async function createPaymentFixture(suffix) {
  const orderId = marker + '-order-' + suffix
  const customerId = marker + '-customer-' + suffix
  const paymentId = randomPaymentId()
  const idempotencyKey = marker + '-order-key-' + suffix
  const requestHash = 'a'.repeat(64)
  const orderResponse = JSON.stringify({ orderId, status: 'CREATED' })

  await pool.query(
    `INSERT INTO order_create_idempotency
      (id, customer_id, operation_key, idempotency_key, request_hash, state,
       response_status, response_json, created_at, expires_at)
     VALUES ($1, $2, 'POST /v1/commerce/orders', $3, $4, 'COMPLETED',
       201, $5, $6::timestamptz, $7::timestamptz)`,
    [
      marker + '-idem-' + suffix,
      customerId,
      idempotencyKey,
      requestHash,
      orderResponse,
      priorIso,
      new Date(now.getTime() + 86_400_000).toISOString(),
    ],
  )

  await pool.query(
    `INSERT INTO orders
      (order_id, customer_id, status, version, currency,
       subtotal_minor, discount_minor, tax_minor, total_minor,
       created_at, updated_at)
     VALUES ($1, $2, 'CREATED', 1, 'USD', 2_500, 0, 0, 2_500,
       $3::timestamptz, $4::timestamptz)`,
    [orderId, customerId, priorIso, priorIso],
  )

  await pool.query(
    `INSERT INTO payments
      (payment_id, order_id, customer_id, provider, merchant_id,
       amount_minor, currency, status, version, idempotency_key, request_hash,
       provider_updated_at, failure_code, created_at, updated_at)
     VALUES ($1, $2, $3, 'hyperswitch', $4,
       2_500, 'USD', 'INITIATING', 1, $5, $6,
       NULL, NULL, $7::timestamptz, $8::timestamptz)`,
    [
      paymentId,
      orderId,
      customerId,
      merchantId,
      marker + '-payment-key-' + suffix,
      'b'.repeat(64),
      priorIso,
      priorIso,
    ],
  )

  return { orderId, customerId, paymentId }
}

function signedWebhook({ eventId, paymentId, amount = 2_500, updated = providerUpdatedAt }) {
  const rawText = JSON.stringify({
    event_id: eventId,
    event_type: 'payment_succeeded',
    merchant_id: merchantId,
    timestamp: nowIso,
    content: {
      type: 'payment_details',
      object: {
        payment_id: paymentId,
        merchant_id: merchantId,
        amount,
        currency: 'USD',
        status: 'succeeded',
        updated,
      },
    },
  })
  const bytes = Buffer.from(rawText, 'utf8')
  const rawBody = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const signatureHeader = createHmac('sha512', secret).update(bytes).digest('hex')
  return {
    rawBody,
    signatureHeader,
    webhookSecret: secret,
    expectedMerchantId: merchantId,
  }
}

async function receive(input, eventRowId, conflictId) {
  return receiveHyperswitchWebhook(database, input, {
    now: () => new Date(now),
    createEventRowId: () => eventRowId,
    createConflictId: () => conflictId,
    databaseDialect: 'postgres',
  })
}

async function receiveNative(input, eventRowId, conflictId) {
  return receiveHyperswitchPaymentWebhookPostgres(pool, input, {
    now: () => new Date(now),
    createEventRowId: () => eventRowId,
    createConflictId: () => conflictId,
  })
}

async function count(table, column, value) {
  const result = await pool.query(
    `SELECT count(*)::int AS count FROM ${table} WHERE ${column} = $1`,
    [value],
  )
  return Number(result.rows[0]?.count ?? -1)
}

let passed = false
let failure
let rollbackTriggerInstalled = false

try {
  // Successful signed webhook: a single PostgreSQL transaction must insert
  // the immutable provider receipt, update the Payment and confirm the Order.
  const success = await createPaymentFixture('success')
  const successEventId = marker + '-event-success'
  const successReceiptId = marker + '-receipt-success'
  const firstInput = signedWebhook({
    eventId: successEventId,
    paymentId: success.paymentId,
  })

  const first = await receive(
    firstInput,
    successReceiptId,
    marker + '-conflict-unused',
  )
  assert.equal(first.outcome, 'APPLIED')
  assert.equal(first.state, 'APPLIED')
  assert.equal(first.eventId, successEventId)
  checks.signedSuccessReceiptApplied = true

  const payment = await pool.query(
    'SELECT status, version::int AS version, provider_updated_at FROM payments WHERE payment_id = $1',
    [success.paymentId],
  )
  assert.deepEqual(payment.rows, [{
    status: 'succeeded',
    version: 2,
    provider_updated_at: new Date(providerUpdatedAt),
  }])

  const order = await pool.query(
    'SELECT status, version::int AS version, confirmed_at FROM orders WHERE order_id = $1',
    [success.orderId],
  )
  assert.equal(order.rows[0]?.status, 'CONFIRMED')
  assert.equal(order.rows[0]?.version, 2)
  assert.ok(order.rows[0]?.confirmed_at instanceof Date)

  const event = await pool.query(
    'SELECT event_row_id, payload_sha256, state, outcome_code FROM payment_provider_events WHERE provider = $1 AND merchant_id = $2 AND event_id = $3',
    ['hyperswitch', merchantId, successEventId],
  )
  assert.equal(event.rows.length, 1)
  assert.equal(event.rows[0]?.event_row_id, successReceiptId)
  assert.equal(event.rows[0]?.state, 'APPLIED')
  assert.equal(event.rows[0]?.outcome_code, 'PAYMENT_STATUS_APPLIED_AND_ORDER_CONFIRMED')
  checks.paymentAndOrderCommittedTogether = true

  // Re-delivery of the exact signed bytes is a DUPLICATE and must not advance
  // the payment version or create another receipt.
  const replay = await receive(
    firstInput,
    marker + '-receipt-replay-unused',
    marker + '-conflict-replay-unused',
  )
  assert.equal(replay.outcome, 'DUPLICATE')
  assert.equal(await count('payment_provider_events', 'event_id', successEventId), 1)
  const paymentAfterReplay = await pool.query(
    'SELECT status, version::int AS version FROM payments WHERE payment_id = $1',
    [success.paymentId],
  )
  assert.deepEqual(paymentAfterReplay.rows, [{ status: 'succeeded', version: 2 }])
  checks.samePayloadReplayReturnsDuplicate = true

  // Reusing the same event identity with different signed bytes records a
  // conflict row while preserving the first receipt and its payload hash.
  const conflicting = signedWebhook({
    eventId: successEventId,
    paymentId: success.paymentId,
    amount: 2_499,
  })
  const conflict = await receive(
    conflicting,
    marker + '-receipt-conflict-unused',
    marker + '-conflict-success',
  )
  assert.equal(conflict.outcome, 'PAYLOAD_CONFLICT')
  assert.equal(conflict.conflictId, marker + '-conflict-success')

  const preservedReceipt = await pool.query(
    'SELECT event_row_id, payload_sha256, state FROM payment_provider_events WHERE provider = $1 AND merchant_id = $2 AND event_id = $3',
    ['hyperswitch', merchantId, successEventId],
  )
  assert.deepEqual(preservedReceipt.rows, [{
    event_row_id: successReceiptId,
    payload_sha256: first.payloadSha256,
    state: 'APPLIED',
  }])
  const conflicts = await pool.query(
    'SELECT conflict_id, existing_payload_sha256, incoming_payload_sha256, state, occurrence_count::int AS occurrence_count FROM payment_provider_event_conflicts WHERE conflict_id = $1',
    [marker + '-conflict-success'],
  )
  assert.equal(conflicts.rows.length, 1)
  assert.equal(conflicts.rows[0]?.state, 'OPEN')
  assert.equal(conflicts.rows[0]?.occurrence_count, 1)
  assert.equal(conflicts.rows[0]?.existing_payload_sha256, first.payloadSha256)
  assert.equal(conflicts.rows[0]?.incoming_payload_sha256, conflict.payloadSha256)
  checks.payloadConflictPreservesFirstReceipt = true

  // The production Neon runtime uses this native Store rather than the
  // D1-shaped compatibility facade for payment_details events.
  const native = await createPaymentFixture('native')
  const nativeEventId = marker + '-native-event-success'
  const nativeReceiptId = marker + '-native-receipt-success'
  const nativeInput = signedWebhook({
    eventId: nativeEventId,
    paymentId: native.paymentId,
  })
  const nativeFirst = await receiveNative(
    nativeInput,
    nativeReceiptId,
    marker + '-native-conflict-unused',
  )
  assert.equal(nativeFirst?.outcome, 'APPLIED')
  assert.equal(nativeFirst?.state, 'APPLIED')

  const nativePayment = await pool.query(
    'SELECT status, version::int AS version, provider_updated_at FROM payments WHERE payment_id = $1',
    [native.paymentId],
  )
  assert.deepEqual(nativePayment.rows, [{
    status: 'succeeded',
    version: 2,
    provider_updated_at: new Date(providerUpdatedAt),
  }])
  const nativeOrder = await pool.query(
    'SELECT status, version::int AS version, confirmed_at FROM orders WHERE order_id = $1',
    [native.orderId],
  )
  assert.equal(nativeOrder.rows[0]?.status, 'CONFIRMED')
  assert.equal(nativeOrder.rows[0]?.version, 2)
  assert.ok(nativeOrder.rows[0]?.confirmed_at instanceof Date)
  const nativeEvent = await pool.query(
    'SELECT event_row_id, payload_sha256, state, outcome_code FROM payment_provider_events ' +
    'WHERE provider = $1 AND merchant_id = $2 AND event_id = $3',
    ['hyperswitch', merchantId, nativeEventId],
  )
  assert.deepEqual(nativeEvent.rows, [{
    event_row_id: nativeReceiptId,
    payload_sha256: nativeFirst?.payloadSha256,
    state: 'APPLIED',
    outcome_code: 'PAYMENT_STATUS_APPLIED_AND_ORDER_CONFIRMED',
  }])
  checks.nativePaymentAndOrderCommittedTogether = true

  const nativeReplay = await receiveNative(
    nativeInput,
    marker + '-native-receipt-replay-unused',
    marker + '-native-conflict-replay-unused',
  )
  assert.equal(nativeReplay?.outcome, 'DUPLICATE')
  assert.equal(await count('payment_provider_events', 'event_id', nativeEventId), 1)
  const nativePaymentAfterReplay = await pool.query(
    'SELECT status, version::int AS version FROM payments WHERE payment_id = $1',
    [native.paymentId],
  )
  assert.deepEqual(nativePaymentAfterReplay.rows, [{ status: 'succeeded', version: 2 }])
  checks.nativeSamePayloadReplayReturnsDuplicate = true

  const nativeConflicting = signedWebhook({
    eventId: nativeEventId,
    paymentId: native.paymentId,
    amount: 2_499,
  })
  const nativeConflictId = 'evtconf_' + marker + '-native-conflict-success'
  const nativeConflict = await receiveNative(
    nativeConflicting,
    marker + '-native-receipt-conflict-unused',
    nativeConflictId,
  )
  assert.equal(nativeConflict?.outcome, 'PAYLOAD_CONFLICT')
  assert.equal(nativeConflict?.conflictId, nativeConflictId)
  const nativeConflictRow = await pool.query(
    'SELECT existing_payload_sha256, incoming_payload_sha256, state, occurrence_count::int AS occurrence_count ' +
    'FROM payment_provider_event_conflicts WHERE conflict_id = $1',
    [nativeConflictId],
  )
  assert.deepEqual(nativeConflictRow.rows, [{
    existing_payload_sha256: nativeFirst?.payloadSha256,
    incoming_payload_sha256: nativeConflict?.payloadSha256,
    state: 'OPEN',
    occurrence_count: 1,
  }])
  checks.nativePayloadConflictPreservesFirstReceipt = true

  // Force an Order-confirmation constraint failure after the Payment update
  // is attempted. The adapter's PostgreSQL batch transaction must roll back
  // the new receipt and Payment mutation as a single unit.
  const rollback = await createPaymentFixture('rollback')
  const rollbackEventId = marker + '-event-rollback'
  await pool.query(
    `CREATE OR REPLACE FUNCTION w07_test_reject_order_confirmation()
     RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN
       IF OLD.order_id = '${rollback.orderId}' AND NEW.status = 'CONFIRMED' THEN
         RAISE EXCEPTION 'W07_TEST_ORDER_CONFIRMATION_FAILURE' USING ERRCODE = '23514';
       END IF;
       RETURN NEW;
     END;
     $$`,
  )
  await pool.query(
    'CREATE TRIGGER w07_test_reject_order_confirmation BEFORE UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION w07_test_reject_order_confirmation()',
  )
  rollbackTriggerInstalled = true

  await assert.rejects(
    receive(
      signedWebhook({ eventId: rollbackEventId, paymentId: rollback.paymentId }),
      marker + '-receipt-rollback',
      marker + '-conflict-rollback',
    ),
    (error) => error instanceof PaymentPersistenceError &&
      error.code === 'SERVICE_UNAVAILABLE' &&
      error.status === 503,
  )

  const rollbackPayment = await pool.query(
    'SELECT status, version::int AS version, provider_updated_at FROM payments WHERE payment_id = $1',
    [rollback.paymentId],
  )
  assert.deepEqual(rollbackPayment.rows, [{
    status: 'INITIATING',
    version: 1,
    provider_updated_at: null,
  }])
  const rollbackOrder = await pool.query(
    'SELECT status, version::int AS version, confirmed_at FROM orders WHERE order_id = $1',
    [rollback.orderId],
  )
  assert.deepEqual(rollbackOrder.rows, [{
    status: 'CREATED',
    version: 1,
    confirmed_at: null,
  }])
  assert.equal(
    await count('payment_provider_events', 'event_id', rollbackEventId),
    0,
  )
  checks.midBatchFailureRollsBackPaymentOrderAndReceipt = true
  passed = true
} catch (error) {
  failure = error
} finally {
  try {
    if (rollbackTriggerInstalled) {
      await pool.query('DROP TRIGGER IF EXISTS w07_test_reject_order_confirmation ON orders')
      await pool.query('DROP FUNCTION IF EXISTS w07_test_reject_order_confirmation()')
    }
    await pool.query(
      'TRUNCATE TABLE payment_provider_event_conflicts, payment_provider_events, payments, order_lines, orders, order_create_idempotency',
    )
    const tables = [
      'payment_provider_event_conflicts',
      'payment_provider_events',
      'payments',
      'order_lines',
      'orders',
      'order_create_idempotency',
    ]
    const counts = {}
    for (const table of tables) {
      const result = await pool.query(`SELECT count(*)::int AS count FROM ${table}`)
      counts[table] = Number(result.rows[0]?.count ?? -1)
    }
    checks.fixtureRowsCleaned = Object.values(counts).every(value => value === 0)
  } catch (cleanupError) {
    failure ??= cleanupError
  }

  const report = {
    status: passed && !failure && checks.fixtureRowsCleaned
      ? 'W07_PAYMENT_WEBHOOK_POSTGRES18_RUNTIME_PASS'
      : 'W07_PAYMENT_WEBHOOK_POSTGRES18_RUNTIME_FAILED',
    postgresDatabase: target.pathname.slice(1),
    ...checks,
    remoteNeonTouched: false,
    cloudflareD1Touched: false,
    businessDataImported: false,
    productionCutoverAuthorized: false,
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  await pool.end()
}

if (failure) throw failure
if (!passed || !checks.fixtureRowsCleaned) {
  throw new Error('W07 payment webhook PostgreSQL 18 rehearsal incomplete: ' + JSON.stringify(checks))
}
console.log('W07_PAYMENT_WEBHOOK_POSTGRES18_RUNTIME_PASS ' + JSON.stringify(checks))
