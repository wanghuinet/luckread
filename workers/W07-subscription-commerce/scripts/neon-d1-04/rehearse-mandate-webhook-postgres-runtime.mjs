import assert from 'node:assert/strict'
import { createHmac, randomUUID, webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { PaymentPersistenceError } from '../../src/payment-persistence.ts'
import { receiveHyperswitchPaymentWebhookPostgres } from '../../src/payment-webhook-payment-postgres.ts'
import { receiveHyperswitchMandateWebhookPostgres } from '../../src/mandate-webhook-postgres-persistence.ts'

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W07_MANDATE_WEBHOOK_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W07_MANDATE_WEBHOOK_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_finance_schema') {
  throw new Error('Refusing to rehearse W07 mandate webhook outside disposable local PostgreSQL luckread_finance_schema')
}

const reportPath = process.env.W07_MANDATE_WEBHOOK_POSTGRES_REPORT ||
  'artifacts/neon/w07-mandate-webhook-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5_000 })
const marker = 'w07-mandate-pg18-' + randomUUID().replaceAll('-', '')
const merchantId = marker + '-merchant'
const secret = 'postgres18-local-mandate-secret-' + randomUUID()
const now = new Date()
const priorIso = new Date(now.getTime() - 10 * 60_000).toISOString()
const paymentReceivedAt = new Date(now.getTime() - 5 * 60_000).toISOString()
const consentAcceptedAt = new Date(now.getTime() - 9 * 60_000).toISOString()
const paymentUpdatedAt = new Date(now.getTime() - 8 * 60_000).toISOString()
const mandateActiveAt = new Date(now.getTime() - 4 * 60_000).toISOString()
const providerMethodDeletedAt = new Date(now.getTime() - 3 * 60_000).toISOString()
const mandateRevokedAt = new Date(now.getTime() - 2 * 60_000).toISOString()
const checks = {
  paymentSucceededCreatedConsentMandate: false,
  nativeMandateActivationApplied: false,
  nativeMandateReplayReturnsDuplicate: false,
  nativeMandatePayloadConflictPreservesFirstReceipt: false,
  nativeMandateRevocationCompletesProviderDeletedMethod: false,
  nativeMandateRevocationReplayReturnsDuplicate: false,
  nativeMandateFailureRollsBackReceiptAndStatus: false,
  fixtureRowsCleaned: false,
}

function randomPaymentId() {
  return 'pay_' + randomUUID().replaceAll('-', '').slice(0, 26)
}

function randomSavedMethodId() {
  return 'pm_' + randomUUID().replaceAll('-', '').slice(0, 26)
}

function rawInput(rawText) {
  const bytes = Buffer.from(rawText, 'utf8')
  const rawBody = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return {
    rawBody,
    signatureHeader: createHmac('sha512', secret).update(bytes).digest('hex'),
    webhookSecret: secret,
    expectedMerchantId: merchantId,
  }
}

async function createPaymentFixture(suffix) {
  const orderId = marker + '-order-' + suffix
  const customerId = marker + '-customer-' + suffix
  const paymentId = randomPaymentId()
  const idempotencyKey = marker + '-order-key-' + suffix
  const orderResponse = JSON.stringify({ orderId, status: 'CREATED' })

  await pool.query(
    "INSERT INTO order_create_idempotency " +
    "(id, customer_id, operation_key, idempotency_key, request_hash, state, response_status, response_json, created_at, expires_at) " +
    "VALUES ($1, $2, 'POST /v1/commerce/orders', $3, $4, 'COMPLETED', 201, $5, $6::timestamptz, $7::timestamptz)",
    [
      marker + '-idem-' + suffix,
      customerId,
      idempotencyKey,
      'a'.repeat(64),
      orderResponse,
      priorIso,
      new Date(now.getTime() + 86_400_000).toISOString(),
    ],
  )
  await pool.query(
    "INSERT INTO orders " +
    "(order_id, customer_id, status, version, currency, subtotal_minor, discount_minor, tax_minor, total_minor, created_at, updated_at) " +
    "VALUES ($1, $2, 'CREATED', 1, 'USD', 2_500, 0, 0, 2_500, $3::timestamptz, $4::timestamptz)",
    [orderId, customerId, priorIso, priorIso],
  )
  await pool.query(
    "INSERT INTO payments " +
    "(payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, idempotency_key, request_hash, provider_updated_at, failure_code, created_at, updated_at) " +
    "VALUES ($1, $2, $3, 'hyperswitch', $4, 2_500, 'USD', 'INITIATING', 1, $5, $6, NULL, NULL, $7::timestamptz, $8::timestamptz)",
    [
      paymentId, orderId, customerId, merchantId,
      marker + '-payment-key-' + suffix,
      'b'.repeat(64),
      priorIso,
      priorIso,
    ],
  )
  return { orderId, customerId, paymentId }
}

function signedPaymentWithConsent({ eventId, payment, paymentMethodId }) {
  const rawText = JSON.stringify({
    event_id: eventId,
    event_type: 'payment_succeeded',
    merchant_id: merchantId,
    timestamp: paymentUpdatedAt,
    content: {
      type: 'payment_details',
      object: {
        payment_id: payment.paymentId,
        merchant_id: merchantId,
        customer_id: payment.customerId,
        amount: 2_500,
        currency: 'USD',
        status: 'succeeded',
        updated: paymentUpdatedAt,
        payment_method_id: paymentMethodId,
        mandate_data: {
          customer_acceptance: {
            acceptance_type: 'online',
            accepted_at: consentAcceptedAt,
            online: {
              ip_address: '203.0.113.10',
              user_agent: 'LuckRead PostgreSQL 18 mandate rehearsal',
            },
          },
        },
      },
    },
  })
  return rawInput(rawText)
}

function signedMandateWebhook({ eventId, eventType, status, paymentId, paymentMethodId, providerMandateId, updatedAt }) {
  const rawText = JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    merchant_id: merchantId,
    timestamp: updatedAt,
    content: {
      type: 'mandate_details',
      object: {
        mandate_id: providerMandateId,
        payment_method_id: paymentMethodId,
        payment_id: paymentId,
        merchant_id: merchantId,
        status,
        updated_at: updatedAt,
      },
    },
  })
  return rawInput(rawText)
}

async function receivePayment(input, eventRowId) {
  return receiveHyperswitchPaymentWebhookPostgres(pool, input, {
    now: () => new Date(paymentReceivedAt),
    createEventRowId: () => eventRowId,
    createConflictId: () => 'evtconf_' + marker + '-payment-conflict',
  })
}

async function receiveMandate(input, suffix) {
  return receiveHyperswitchMandateWebhookPostgres(pool, input, {
    now: () => new Date(now),
    createEventRowId: () => 'evtrow_' + marker + '-mandate-receipt-' + suffix,
    createConflictId: () => 'evtconf_' + marker + '-mandate-conflict-' + suffix,
  })
}

async function count(table, column, value) {
  const result = await pool.query(
    'SELECT count(*)::int AS count FROM ' + table + ' WHERE ' + column + ' = $1',
    [value],
  )
  return Number(result.rows[0]?.count ?? -1)
}

let passed = false
let failure
let mandateRollbackTriggerInstalled = false

try {
  const payment = await createPaymentFixture('mandate')
  const paymentMethodId = randomSavedMethodId()
  const paymentEventId = marker + '-payment-succeeded'
  const paymentResult = await receivePayment(
    signedPaymentWithConsent({ eventId: paymentEventId, payment, paymentMethodId }),
    'evtrow_' + marker + '-payment-receipt',
  )
  assert.equal(paymentResult?.outcome, 'APPLIED')

  const saved = await pool.query(
    'SELECT saved_payment_method_id FROM saved_payment_methods WHERE provider = $1 AND merchant_id = $2 AND payment_method_id = $3',
    ['hyperswitch', merchantId, paymentMethodId],
  )
  assert.equal(saved.rows.length, 1)
  const mandate = await pool.query(
    'SELECT mandate_record_id, status, version::int AS version, provider_mandate_id FROM payment_mandates ' +
    'WHERE provider = $1 AND merchant_id = $2 AND source_payment_id = $3',
    ['hyperswitch', merchantId, payment.paymentId],
  )
  assert.equal(mandate.rows.length, 1)
  assert.equal(mandate.rows[0]?.status, 'PENDING_PROVIDER_CONFIRMATION')
  assert.equal(mandate.rows[0]?.version, 1)
  assert.equal(mandate.rows[0]?.provider_mandate_id, null)
  checks.paymentSucceededCreatedConsentMandate = true

  const providerMandateId = marker + '-provider-mandate'
  const activeEventId = marker + '-mandate-active'
  const activeInput = signedMandateWebhook({
    eventId: activeEventId,
    eventType: 'mandate_active',
    status: 'active',
    paymentId: payment.paymentId,
    paymentMethodId,
    providerMandateId,
    updatedAt: mandateActiveAt,
  })
  const active = await receiveMandate(activeInput, 'active')
  assert.equal(active?.outcome, 'APPLIED')
  assert.equal(active?.state, 'APPLIED')
  const activeRecord = await pool.query(
    'SELECT status, version::int AS version, provider_mandate_id, provider_updated_at FROM payment_mandates ' +
    'WHERE source_payment_id = $1',
    [payment.paymentId],
  )
  assert.equal(activeRecord.rows[0]?.status, 'ACTIVE')
  assert.equal(activeRecord.rows[0]?.version, 2)
  assert.equal(activeRecord.rows[0]?.provider_mandate_id, providerMandateId)
  assert.ok(activeRecord.rows[0]?.provider_updated_at instanceof Date)
  checks.nativeMandateActivationApplied = true

  const replay = await receiveMandate(activeInput, 'active-replay')
  assert.equal(replay?.outcome, 'DUPLICATE')
  assert.equal(await count('payment_provider_events', 'event_id', activeEventId), 1)
  checks.nativeMandateReplayReturnsDuplicate = true

  const conflictingActive = signedMandateWebhook({
    eventId: activeEventId,
    eventType: 'mandate_active',
    status: 'active',
    paymentId: payment.paymentId,
    paymentMethodId,
    providerMandateId,
    updatedAt: new Date(new Date(mandateActiveAt).getTime() + 1_000).toISOString(),
  })
  const conflict = await receiveMandate(conflictingActive, 'active-conflict')
  assert.equal(conflict?.outcome, 'PAYLOAD_CONFLICT')
  const conflictRows = await pool.query(
    'SELECT existing_payload_sha256, incoming_payload_sha256, state, occurrence_count::int AS occurrence_count ' +
    'FROM payment_provider_event_conflicts WHERE provider = $1 AND merchant_id = $2 AND event_id = $3',
    ['hyperswitch', merchantId, activeEventId],
  )
  assert.equal(conflictRows.rows.length, 1)
  assert.equal(conflictRows.rows[0]?.state, 'OPEN')
  assert.equal(conflictRows.rows[0]?.occurrence_count, 1)
  assert.equal(conflictRows.rows[0]?.existing_payload_sha256, active?.payloadSha256)
  assert.equal(conflictRows.rows[0]?.incoming_payload_sha256, conflict?.payloadSha256)
  checks.nativeMandatePayloadConflictPreservesFirstReceipt = true

  const revocationRequestId = 'pmr_' + randomUUID().replaceAll('-', '').slice(0, 26)
  await pool.query(
    "INSERT INTO payment_method_revocation_requests " +
    "(revocation_request_id, saved_payment_method_id, payment_method_id, provider, merchant_id, customer_id, idempotency_key, status, provider_method_deleted_at, version, created_at, updated_at) " +
    "VALUES ($1,$2,$3,'hyperswitch',$4,$5,$6,'PENDING_PROVIDER',$7::timestamptz,1,$8::timestamptz,$8::timestamptz)",
    [
      revocationRequestId,
      saved.rows[0].saved_payment_method_id,
      paymentMethodId,
      merchantId,
      payment.customerId,
      marker + '-revoke-method',
      providerMethodDeletedAt,
      priorIso,
    ],
  )
  const revokedEventId = marker + '-mandate-revoked'
  const revokedInput = signedMandateWebhook({
    eventId: revokedEventId,
    eventType: 'mandate_revoked',
    status: 'revoked',
    paymentId: payment.paymentId,
    paymentMethodId,
    providerMandateId,
    updatedAt: mandateRevokedAt,
  })
  const revoked = await receiveMandate(revokedInput, 'revoked')
  assert.equal(revoked?.outcome, 'APPLIED')
  const revokedRecord = await pool.query(
    'SELECT status, version::int AS version FROM payment_mandates WHERE source_payment_id = $1',
    [payment.paymentId],
  )
  assert.deepEqual(revokedRecord.rows, [{ status: 'REVOKED', version: 3 }])
  const completed = await pool.query(
    'SELECT status, version::int AS version, provider_method_deleted_at FROM payment_method_revocation_requests ' +
    'WHERE revocation_request_id = $1',
    [revocationRequestId],
  )
  assert.equal(completed.rows[0]?.status, 'COMPLETED')
  assert.equal(completed.rows[0]?.version, 2)
  assert.ok(completed.rows[0]?.provider_method_deleted_at instanceof Date)
  const revokedReplay = await receiveMandate(revokedInput, 'revoked-replay')
  assert.equal(revokedReplay?.outcome, 'DUPLICATE')
  checks.nativeMandateRevocationCompletesProviderDeletedMethod = true
  checks.nativeMandateRevocationReplayReturnsDuplicate = true

  const rollbackPayment = await createPaymentFixture('mandate-rollback')
  const rollbackMethodId = randomSavedMethodId()
  const rollbackPaymentEventId = marker + '-rollback-payment-succeeded'
  const rollbackPaymentResult = await receivePayment(
    signedPaymentWithConsent({
      eventId: rollbackPaymentEventId,
      payment: rollbackPayment,
      paymentMethodId: rollbackMethodId,
    }),
    marker + '-rollback-payment-receipt',
  )
  assert.equal(rollbackPaymentResult?.outcome, 'APPLIED')
  const rollbackMandate = await pool.query(
    'SELECT mandate_record_id FROM payment_mandates WHERE source_payment_id = $1',
    [rollbackPayment.paymentId],
  )
  assert.equal(rollbackMandate.rows.length, 1)

  const escapedPaymentId = rollbackPayment.paymentId.replaceAll("'", "''")
  await pool.query(
    "CREATE OR REPLACE FUNCTION w07_test_reject_mandate_update() " +
    "RETURNS trigger LANGUAGE plpgsql AS $$ " +
    "BEGIN " +
    "IF OLD.source_payment_id = '" + escapedPaymentId + "' AND NEW.status = 'ACTIVE' THEN " +
    "RAISE EXCEPTION 'W07_TEST_MANDATE_UPDATE_FAILURE' USING ERRCODE = '23514'; " +
    "END IF; " +
    "RETURN NEW; " +
    "END; " +
    "$$",
  )
  await pool.query(
    'CREATE TRIGGER w07_test_reject_mandate_update BEFORE UPDATE OF status ON payment_mandates ' +
    'FOR EACH ROW EXECUTE FUNCTION w07_test_reject_mandate_update()',
  )
  mandateRollbackTriggerInstalled = true

  await assert.rejects(
    receiveMandate(signedMandateWebhook({
      eventId: marker + '-mandate-rollback',
      eventType: 'mandate_active',
      status: 'active',
      paymentId: rollbackPayment.paymentId,
      paymentMethodId: rollbackMethodId,
      providerMandateId: marker + '-rollback-provider-mandate',
      updatedAt: mandateActiveAt,
    }), 'rollback'),
    (error) => error instanceof PaymentPersistenceError &&
      error.code === 'SERVICE_UNAVAILABLE' &&
      error.status === 503,
  )
  const rollbackState = await pool.query(
    'SELECT status, version::int AS version, provider_mandate_id FROM payment_mandates WHERE source_payment_id = $1',
    [rollbackPayment.paymentId],
  )
  assert.deepEqual(rollbackState.rows, [{
    status: 'PENDING_PROVIDER_CONFIRMATION',
    version: 1,
    provider_mandate_id: null,
  }])
  assert.equal(await count('payment_provider_events', 'event_id', marker + '-mandate-rollback'), 0)
  checks.nativeMandateFailureRollsBackReceiptAndStatus = true
  passed = true
} catch (error) {
  failure = error
} finally {
  try {
    if (mandateRollbackTriggerInstalled) {
      await pool.query('DROP TRIGGER IF EXISTS w07_test_reject_mandate_update ON payment_mandates')
      await pool.query('DROP FUNCTION IF EXISTS w07_test_reject_mandate_update()')
    }
    await pool.query(
      'TRUNCATE TABLE payment_provider_event_conflicts, payment_provider_events, ' +
      'payment_method_revocation_requests, payment_mandates, saved_payment_methods, ' +
      'payments, order_lines, orders, order_create_idempotency',
    )
    const tables = [
      'payment_provider_event_conflicts',
      'payment_provider_events',
      'payment_method_revocation_requests',
      'payment_mandates',
      'saved_payment_methods',
      'payments',
      'order_lines',
      'orders',
      'order_create_idempotency',
    ]
    const counts = {}
    for (const table of tables) {
      const result = await pool.query('SELECT count(*)::int AS count FROM ' + table)
      counts[table] = Number(result.rows[0]?.count ?? -1)
    }
    checks.fixtureRowsCleaned = Object.values(counts).every(value => value === 0)
  } catch (cleanupError) {
    failure ??= cleanupError
  }

  const report = {
    status: passed && !failure && checks.fixtureRowsCleaned
      ? 'W07_MANDATE_WEBHOOK_POSTGRES18_RUNTIME_PASS'
      : 'W07_MANDATE_WEBHOOK_POSTGRES18_RUNTIME_FAILED',
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
  throw new Error('W07 mandate webhook PostgreSQL 18 rehearsal incomplete: ' + JSON.stringify(checks))
}
console.log('W07_MANDATE_WEBHOOK_POSTGRES18_RUNTIME_PASS ' + JSON.stringify(checks))
