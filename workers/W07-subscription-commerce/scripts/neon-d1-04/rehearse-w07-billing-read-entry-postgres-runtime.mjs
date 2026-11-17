import assert from 'node:assert/strict'
import { createHmac, randomUUID, webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import worker from '../../src/index.ts'
import { issueReceiptForPaidPayment } from '../../src/billing-persistence.ts'
import { createPostgresWebhookD1Database } from '../../src/payment-webhook-database-postgres.ts'
import { receiveHyperswitchWebhook } from '../../src/payment-persistence.ts'
import { closeW07PostgresRuntimeForTest } from '../../src/neon/payment-method-read-runtime.ts'

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

const requireFromW07 = createRequire(new URL('../../package.json', import.meta.url))
const { Pool } = requireFromW07('pg')
const connectionString = process.env.W07_BILLING_READ_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W07_BILLING_READ_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_finance_schema') {
  throw new Error('Refusing W07 billing-read rehearsal outside disposable local PostgreSQL luckread_finance_schema')
}

const reportPath = process.env.W07_BILLING_READ_POSTGRES_REPORT ||
  'artifacts/neon/w07-billing-read-entry-postgres-runtime-postflight.json'
const adminPool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5_000 })
const database = createPostgresWebhookD1Database(adminPool)
const marker = 'w07-billing-entry-pg18-' + randomUUID().replaceAll('-', '')
const merchantId = marker + '-merchant'
const secret = 'postgres18-local-webhook-secret-' + randomUUID()
const now = new Date()
const nowIso = now.toISOString()
const priorIso = new Date(now.getTime() - 5 * 60_000).toISOString()
const providerUpdatedAt = new Date(now.getTime() - 2_000).toISOString()
const paymentId = 'pay_' + randomUUID().replaceAll('-', '').slice(0, 26)
const orderId = marker + '-order'
const customerId = marker + '-customer'
const eventId = marker + '-event'
const idempotencyKey = marker + '-order-key'

const checks = {
  signedPaymentWebhookAppliedToPostgres: false,
  immutableInvoiceAndReceiptIssued: false,
  billingDocumentsReadThroughW07NeonEntry: false,
  billingDocumentPaginationPreserved: false,
  customerIsolationPreserved: false,
  paymentHistoryReadThroughW07NeonEntry: false,
  refundHistoryReadThroughW07NeonEntry: false,
  legacyD1BindingsNeverAccessed: false,
  fixtureRowsCleaned: false,
}
let env
let passed = false
let failure

function signedWebhook() {
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
        amount: 2_500,
        currency: 'USD',
        status: 'succeeded',
        updated: providerUpdatedAt,
      },
    },
  })
  const bytes = Buffer.from(rawText, 'utf8')
  const rawBody = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return {
    rawBody,
    signatureHeader: createHmac('sha512', secret).update(bytes).digest('hex'),
    webhookSecret: secret,
    expectedMerchantId: merchantId,
  }
}

function billingHeaders(principalId) {
  return {
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': marker + '-correlation',
    'X-LuckRead-Principal-User-Id': principalId,
    'X-LuckRead-Principal-Layer': 'L2',
  }
}

async function billingGet(pathname, principalId = customerId) {
  const url = new URL(pathname, 'https://w07.internal')
  return worker.fetch(
    new Request(url, { method: 'GET', headers: billingHeaders(principalId) }),
    env,
  )
}

const tableNames = [
  'billing_documents',
  'refunds',
  'payment_provider_event_conflicts',
  'payment_provider_events',
  'payments',
  'order_lines',
  'orders',
  'order_create_idempotency',
]

try {
  await adminPool.query(
    `INSERT INTO order_create_idempotency
      (id, customer_id, operation_key, idempotency_key, request_hash, state,
       response_status, response_json, created_at, expires_at)
     VALUES ($1, $2, 'POST /v1/commerce/orders', $3, $4, 'COMPLETED',
       201, $5, $6::timestamptz, $7::timestamptz)`,
    [
      marker + '-idempotency',
      customerId,
      idempotencyKey,
      'a'.repeat(64),
      JSON.stringify({ orderId, status: 'CREATED' }),
      priorIso,
      new Date(now.getTime() + 86_400_000).toISOString(),
    ],
  )

  await adminPool.query(
    `INSERT INTO orders
      (order_id, customer_id, status, version, currency,
       subtotal_minor, discount_minor, tax_minor, total_minor,
       created_at, updated_at)
     VALUES ($1, $2, 'CREATED', 1, 'USD', 2_500, 0, 0, 2_500,
       $3::timestamptz, $4::timestamptz)`,
    [orderId, customerId, priorIso, priorIso],
  )

  await adminPool.query(
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
      marker + '-payment-key',
      'b'.repeat(64),
      priorIso,
      priorIso,
    ],
  )

  const received = await receiveHyperswitchWebhook(
    database,
    signedWebhook(),
    {
      now: () => new Date(now),
      createEventRowId: () => marker + '-receipt-row',
      createConflictId: () => marker + '-conflict-row',
      databaseDialect: 'postgres',
    },
  )
  assert.equal(received.outcome, 'APPLIED')
  assert.equal(received.state, 'APPLIED')
  checks.signedPaymentWebhookAppliedToPostgres = true

  const persistedPayment = await adminPool.query(
    'SELECT status, version::int AS version FROM payments WHERE payment_id = $1',
    [paymentId],
  )
  assert.deepEqual(persistedPayment.rows, [{ status: 'succeeded', version: 2 }])

  let issuedDocumentSequence = 0
  const issuedReceipt = await issueReceiptForPaidPayment(database, paymentId, merchantId, {
    now: () => new Date(now),
    createDocumentId: () => marker + '-document-' + (++issuedDocumentSequence),
    createDocumentNumber: () => (issuedDocumentSequence === 1 ? 'INV-' : 'RCT-') + marker,
  })
  assert.equal(issuedReceipt.documentType, 'RECEIPT')

  const issuedDocuments = await adminPool.query(
    'SELECT document_type, payment_id, amount_minor::int AS amount_minor, currency FROM billing_documents WHERE customer_id = $1 ORDER BY document_type',
    [customerId],
  )
  assert.deepEqual(issuedDocuments.rows, [
    { document_type: 'INVOICE', payment_id: null, amount_minor: 2_500, currency: 'USD' },
    { document_type: 'RECEIPT', payment_id: paymentId, amount_minor: 2_500, currency: 'USD' },
  ])
  checks.immutableInvoiceAndReceiptIssued = true

  const d1Accesses = { prepare: 0, batch: 0 }
  const d1Sentinel = {
    prepare() {
      d1Accesses.prepare += 1
      throw new Error('W07 Neon billing path must not access legacy D1')
    },
    batch() {
      d1Accesses.batch += 1
      throw new Error('W07 Neon billing path must not write legacy D1')
    },
  }
  const allowRateLimit = { async limit() { return { success: true } } }
  const hyperdriveBinding = { connectionString }
  env = {
    W07_DATABASE_DRIVER: 'neon',
    W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
    HYPERDRIVE_D1_04: hyperdriveBinding,
    D1_01: d1Sentinel,
    D1_04: d1Sentinel,
    SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER: allowRateLimit,
    SUBSCRIPTION_READ_LIMITER: allowRateLimit,
    SUBSCRIPTION_WRITE_LIMITER: allowRateLimit,
    HYPERSWITCH_WEBHOOK_SECRET: secret,
    HYPERSWITCH_MERCHANT_ID: merchantId,
  }

  const firstDocumentsResponse = await billingGet('/commerce/billing/documents?limit=1')
  assert.equal(firstDocumentsResponse.status, 200)
  const firstDocumentsBody = await firstDocumentsResponse.json()
  assert.equal(firstDocumentsBody.data.items.length, 1)
  assert.equal(firstDocumentsBody.data.hasMore, true)
  assert.equal(typeof firstDocumentsBody.data.nextCursor, 'string')
  const firstDocument = firstDocumentsBody.data.items[0]
  assert.equal(typeof firstDocument.documentId, 'string')
  assert.ok(['INVOICE', 'RECEIPT'].includes(firstDocument.documentType))
  checks.billingDocumentsReadThroughW07NeonEntry = true

  const secondDocumentsUrl = new URL('/commerce/billing/documents', 'https://w07.internal')
  secondDocumentsUrl.searchParams.set('limit', '1')
  secondDocumentsUrl.searchParams.set('cursor', firstDocumentsBody.data.nextCursor)
  const secondDocumentsResponse = await billingGet(secondDocumentsUrl.pathname + secondDocumentsUrl.search)
  assert.equal(secondDocumentsResponse.status, 200)
  const secondDocumentsBody = await secondDocumentsResponse.json()
  assert.equal(secondDocumentsBody.data.items.length, 1)
  assert.equal(secondDocumentsBody.data.hasMore, false)
  assert.equal(secondDocumentsBody.data.nextCursor, null)
  assert.notEqual(firstDocument.documentId, secondDocumentsBody.data.items[0].documentId)
  checks.billingDocumentPaginationPreserved = true

  const unrelatedCustomerResponse = await billingGet(
    '/commerce/billing/documents?limit=20',
    marker + '-different-customer',
  )
  assert.equal(unrelatedCustomerResponse.status, 200)
  const unrelatedCustomerBody = await unrelatedCustomerResponse.json()
  assert.deepEqual(unrelatedCustomerBody.data.items, [])
  checks.customerIsolationPreserved = true

  const paymentHistoryResponse = await billingGet('/commerce/payments/history?limit=20')
  assert.equal(paymentHistoryResponse.status, 200)
  const paymentHistoryBody = await paymentHistoryResponse.json()
  assert.equal(paymentHistoryBody.data.items.length, 1)
  assert.equal(paymentHistoryBody.data.items[0].paymentId, paymentId)
  assert.equal(paymentHistoryBody.data.items[0].status, 'succeeded')
  assert.equal(paymentHistoryBody.data.items[0].refundedMinor, 0)
  checks.paymentHistoryReadThroughW07NeonEntry = true

  const refundHistoryResponse = await billingGet('/commerce/payments/refunds?limit=20')
  assert.equal(refundHistoryResponse.status, 200)
  const refundHistoryBody = await refundHistoryResponse.json()
  assert.deepEqual(refundHistoryBody.data.items, [])
  checks.refundHistoryReadThroughW07NeonEntry = true

  assert.equal(d1Accesses.prepare, 0)
  assert.equal(d1Accesses.batch, 0)
  checks.legacyD1BindingsNeverAccessed = true
  passed = true
} catch (error) {
  failure = error
} finally {
  try {
    if (env) await closeW07PostgresRuntimeForTest(env)
  } catch (cleanupError) {
    failure ??= cleanupError
  }

  try {
    await adminPool.query('TRUNCATE TABLE ' + tableNames.join(', '))
    const counts = {}
    for (const table of tableNames) {
      const result = await adminPool.query(`SELECT count(*)::int AS count FROM ${table}`)
      counts[table] = Number(result.rows[0]?.count ?? -1)
    }
    checks.fixtureRowsCleaned = Object.values(counts).every((value) => value === 0)
  } catch (cleanupError) {
    failure ??= cleanupError
  }

  const report = {
    status: passed && !failure && checks.fixtureRowsCleaned
      ? 'W07_BILLING_READ_ENTRY_POSTGRES18_PASS'
      : 'W07_BILLING_READ_ENTRY_POSTGRES18_FAILED',
    postgresDatabase: target.pathname.slice(1),
    ...checks,
    remoteNeonTouched: false,
    cloudflareD1Touched: false,
    businessDataImported: false,
    productionCutoverAuthorized: false,
  }
  try {
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  } finally {
    await adminPool.end()
  }
}

if (failure) throw failure
if (!passed || !checks.fixtureRowsCleaned) {
  throw new Error('W07 Neon billing-read entrypoint rehearsal incomplete: ' + JSON.stringify(checks))
}
console.log('W07_BILLING_READ_ENTRY_POSTGRES18_PASS ' + JSON.stringify(checks))
