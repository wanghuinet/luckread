import assert from 'node:assert/strict'
import { createHmac, randomUUID, webcrypto } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { receiveHyperswitchRefundWebhookPostgres } from '../../src/refund-webhook-postgres-persistence.ts'

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W07_REFUND_WEBHOOK_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W07_REFUND_WEBHOOK_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) || target.port !== '5432' ||
    target.pathname !== '/luckread_finance_schema') {
  throw new Error('Refusing refund webhook rehearsal outside disposable local PostgreSQL luckread_finance_schema')
}
const reportPath = process.env.W07_REFUND_WEBHOOK_POSTGRES_REPORT ||
  'artifacts/neon/w07-refund-webhook-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5_000 })
const marker = 'w07-refund-pg18-' + randomUUID().replaceAll('-', '')
const merchantId = marker + '-merchant'
const customerId = marker + '-customer'
const orderId = marker + '-order'
const paymentId = 'pay_' + randomUUID().replaceAll('-', '').slice(0, 26)
const refundId = 'ref_' + randomUUID().replaceAll('-', '').slice(0, 26)
const secret = 'postgres18-refund-secret-' + randomUUID()
const now = new Date()
const nowIso = now.toISOString()
const priorIso = new Date(now.getTime() - 10 * 60_000).toISOString()
const baseProviderTime = new Date(now.getTime() - 5_000)
const checks = {
  signedRefundWebhookApplied: false,
  concurrentSameEventIsExactlyOnce: false,
  concurrentDistinctEventsPreserveNewestProviderTimestamp: false,
  staleTimestampRequiresReconciliation: false,
  amountMismatchRequiresReconciliation: false,
  terminalStateCannotRegress: false,
  transactionRollbackAndConnectionRelease: false,
  fixtureRowsCleaned: false,
}
let passed = false
let failure
let rollbackTriggerInstalled = false

function body({ eventId, status = 'succeeded', updatedAt, amount = 300, refund = refundId }) {
  const text = JSON.stringify({
    event_id: eventId, event_type: 'refund_' + status, merchant_id: merchantId, timestamp: nowIso,
    content: { type: 'refund_details', object: {
      refund_id: refund, payment_id: paymentId, merchant_id: merchantId,
      amount, currency: 'USD', status, updated_at: updatedAt,
    } },
  })
  const bytes = Buffer.from(text, 'utf8')
  return {
    rawBody: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    signatureHeader: createHmac('sha512', secret).update(bytes).digest('hex'),
    webhookSecret: secret, expectedMerchantId: merchantId,
  }
}
let rowSequence = 0
async function receive(input) {
  return receiveHyperswitchRefundWebhookPostgres(pool, input, {
    now: () => new Date(now),
    createEventRowId: () => marker + '-event-row-' + (++rowSequence),
    createConflictId: () => 'evtconf_' + marker + '-' + (++rowSequence),
  })
}
async function createFixture() {
  await pool.query(
    `INSERT INTO order_create_idempotency
      (id,customer_id,operation_key,idempotency_key,request_hash,state,response_status,response_json,created_at,expires_at)
     VALUES ($1,$2,'POST /v1/commerce/orders',$3,$4,'COMPLETED',201,$5,$6::timestamptz,$7::timestamptz)`,
    [marker + '-idem', customerId, marker + '-order-key', 'a'.repeat(64),
      JSON.stringify({ orderId, status: 'CREATED' }), priorIso, new Date(now.getTime()+86400000).toISOString()],
  )
  await pool.query(
    `INSERT INTO orders(order_id,customer_id,status,version,currency,subtotal_minor,discount_minor,tax_minor,total_minor,created_at,updated_at)
     VALUES($1,$2,'CREATED',1,'USD',2500,0,0,2500,$3::timestamptz,$4::timestamptz)`,
    [orderId, customerId, priorIso, priorIso],
  )
  await pool.query(
    `INSERT INTO payments(payment_id,order_id,customer_id,provider,merchant_id,amount_minor,currency,status,version,
      idempotency_key,request_hash,provider_updated_at,failure_code,created_at,updated_at)
     VALUES($1,$2,$3,'hyperswitch',$4,2500,'USD','succeeded',2,$5,$6,$7::timestamptz,NULL,$8::timestamptz,$8::timestamptz)`,
    [paymentId, orderId, customerId, merchantId, marker + '-payment-key', 'b'.repeat(64), priorIso, priorIso],
  )
  await pool.query(
    `UPDATE orders SET status='CONFIRMED',version=version+1,updated_at=updated_at+INTERVAL '1 second' WHERE order_id=$1`,
    [orderId],
  )
  await pool.query(
    `INSERT INTO refunds(refund_id,provider,merchant_id,customer_id,order_id,payment_id,amount_minor,captured_amount_minor,
      currency,status,reason,idempotency_key,request_hash,provider_updated_at,outcome_code,version,created_at,updated_at)
     VALUES($1,'hyperswitch',$2,$3,$4,$5,300,2500,'USD','PENDING','customer-request',$6,$7,NULL,NULL,1,$8::timestamptz,$8::timestamptz)`,
    [refundId, merchantId, customerId, orderId, paymentId, marker + '-refund-key', 'c'.repeat(64), priorIso],
  )
}
async function count(table, column, value) {
  const result = await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${column}=$1`, [value])
  return Number(result.rows[0]?.count ?? -1)
}
try {
  await createFixture()
  const initialTime = new Date(baseProviderTime).toISOString()
  const first = await receive(body({ eventId: marker + '-success', status: 'review', updatedAt: initialTime }))
  assert.equal(first?.outcome, 'APPLIED')
  assert.equal(first?.state, 'APPLIED')
  const state = await pool.query('SELECT status,version::int AS version,provider_updated_at FROM refunds WHERE refund_id=$1', [refundId])
  assert.equal(state.rows[0]?.status, 'REVIEW')
  assert.equal(state.rows[0]?.version, 2)
  checks.signedRefundWebhookApplied = true

  const replayInput = body({ eventId: marker + '-same-event', status: 'review', updatedAt: new Date(baseProviderTime.getTime()+1000).toISOString() })
  const same = await Promise.all([receive(replayInput), receive(replayInput)])
  assert.deepEqual(same.map(x => x?.outcome).sort(), ['APPLIED','DUPLICATE'])
  assert.equal(await count('payment_provider_events','event_id',marker+'-same-event'),1)
  const afterSame = await pool.query('SELECT version::int AS version FROM refunds WHERE refund_id=$1',[refundId])
  assert.equal(afterSame.rows[0]?.version,3)
  checks.concurrentSameEventIsExactlyOnce = true

  // Start from a non-terminal refund to test distinct, out-of-order deliveries.
  await pool.query("UPDATE refunds SET status='RECONCILIATION_REQUIRED',provider_updated_at=NULL,version=version+1,updated_at=updated_at+INTERVAL '1 second' WHERE refund_id=$1",[refundId])
  const older = new Date(baseProviderTime.getTime()+3000).toISOString()
  const newer = new Date(baseProviderTime.getTime()+4000).toISOString()
  const distinct = await Promise.all([
    receive(body({eventId:marker+'-older',status:'review',updatedAt:older})),
    receive(body({eventId:marker+'-newer',status:'review',updatedAt:newer})),
  ])
  const finalConcurrent = await pool.query('SELECT status,provider_updated_at,version::int AS version FROM refunds WHERE refund_id=$1',[refundId])
  assert.equal(finalConcurrent.rows[0]?.status,'REVIEW')
  assert.equal(new Date(finalConcurrent.rows[0]?.provider_updated_at).toISOString(),newer)
  assert.ok(distinct.some(x=>x?.outcome==='APPLIED'))
  checks.concurrentDistinctEventsPreserveNewestProviderTimestamp = true

  const stale = await receive(body({eventId:marker+'-stale',status:'review',updatedAt:older}))
  assert.equal(stale?.outcome,'RECONCILIATION_REQUIRED')
  checks.staleTimestampRequiresReconciliation = true

  const mismatch = await receive(body({eventId:marker+'-amount-mismatch',status:'review',updatedAt:new Date(baseProviderTime.getTime()+5000).toISOString(),amount:301}))
  assert.equal(mismatch?.outcome,'RECONCILIATION_REQUIRED')
  checks.amountMismatchRequiresReconciliation = true

  // Force the refund UPDATE to fail after the receipt insert; both must roll back.
  await pool.query("UPDATE refunds SET status='RECONCILIATION_REQUIRED',provider_updated_at=NULL,version=version+1,updated_at=updated_at+INTERVAL '1 second' WHERE refund_id=$1",[refundId])
  await pool.query(`CREATE OR REPLACE FUNCTION w07_test_reject_refund_update() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF OLD.refund_id='${refundId}' THEN RAISE EXCEPTION 'W07_TEST_REFUND_UPDATE_FAILURE' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$`)
  await pool.query('CREATE TRIGGER w07_test_reject_refund_update BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION w07_test_reject_refund_update()')
  rollbackTriggerInstalled = true
  let rollbackError
  try {
    await receive(body({eventId:marker+'-rollback',updatedAt:new Date(baseProviderTime.getTime()+8000).toISOString()}))
  } catch (error) {
    rollbackError = error
  }
  assert.equal(rollbackError?.code,'SERVICE_UNAVAILABLE')
  assert.equal(rollbackError?.status,503)
  // The persistence adapter must release its checked-out client even on rollback.
  assert.equal(pool.waitingCount,0)
  assert.ok(pool.idleCount >= 1)
  assert.equal(await count('payment_provider_events','event_id',marker+'-rollback'),0)
  const rolled = await pool.query('SELECT status,version::int AS version FROM refunds WHERE refund_id=$1',[refundId])
  assert.equal(rolled.rows[0]?.status,'RECONCILIATION_REQUIRED')
  checks.transactionRollbackAndConnectionRelease = true

  // REVIEW -> SUCCEEDED, then a later FAILED event must not reverse the terminal fact.
  const terminalTime = new Date(baseProviderTime.getTime()+6000).toISOString()
  const terminal = await receive(body({eventId:marker+'-terminal-success',updatedAt:terminalTime}))
  assert.equal(terminal?.outcome,'APPLIED')
  const regression = await receive(body({eventId:marker+'-terminal-regression',status:'failed',updatedAt:new Date(baseProviderTime.getTime()+7000).toISOString()}))
  assert.equal(regression?.outcome,'RECONCILIATION_REQUIRED')
  const terminalState = await pool.query('SELECT status FROM refunds WHERE refund_id=$1',[refundId])
  assert.equal(terminalState.rows[0]?.status,'SUCCEEDED')
  checks.terminalStateCannotRegress = true


  passed = true
} catch (error) {
  failure = error
} finally {
  try {
    if (rollbackTriggerInstalled) {
      await pool.query('DROP TRIGGER IF EXISTS w07_test_reject_refund_update ON refunds')
      await pool.query('DROP FUNCTION IF EXISTS w07_test_reject_refund_update()')
    }
    await pool.query('TRUNCATE TABLE payment_provider_event_conflicts,payment_provider_events,billing_documents,refunds,payments,order_lines,orders,order_create_idempotency')
    const tables=['payment_provider_event_conflicts','payment_provider_events','billing_documents','refunds','payments','order_lines','orders','order_create_idempotency']
    const counts={}
    for (const table of tables) {
      const result=await pool.query(`SELECT count(*)::int AS count FROM ${table}`)
      counts[table]=Number(result.rows[0]?.count??-1)
    }
    checks.fixtureRowsCleaned=Object.values(counts).every(x=>x===0)
  } catch(error) { failure ??= error }
  const report={
    status:passed&&!failure&&checks.fixtureRowsCleaned?'W07_REFUND_WEBHOOK_POSTGRES18_RUNTIME_PASS':'W07_REFUND_WEBHOOK_POSTGRES18_RUNTIME_FAILED',
    postgresDatabase:target.pathname.slice(1),...checks,remoteNeonTouched:false,cloudflareD1Touched:false,
    businessDataImported:false,productionCutoverAuthorized:false,
  }
  try { await mkdir(dirname(reportPath),{recursive:true}); await writeFile(reportPath,JSON.stringify(report,null,2)+'\n') }
  finally { await pool.end() }
}
if(failure) throw failure
if(!passed||!checks.fixtureRowsCleaned) throw new Error('W07 refund webhook PostgreSQL 18 rehearsal incomplete: '+JSON.stringify(checks))
console.log('W07_REFUND_WEBHOOK_POSTGRES18_RUNTIME_PASS '+JSON.stringify(checks))
