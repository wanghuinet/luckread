import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createPostgresNotificationPushDeliveryClaimStore } from '../../src/notification-push-delivery-claim-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_PUSH_DELIVERY_CLAIM_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_PUSH_DELIVERY_CLAIM_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1','localhost','postgres'].includes(target.hostname) || target.port !== '5432' ||
    target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to run W05 push delivery claim rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const marker = 'w05-push-delivery-claim-' + randomUUID()
const reportPath = process.env.W05_PUSH_DELIVERY_CLAIM_POSTGRES_REPORT ||
  'artifacts/neon/w05-push-delivery-claim-postgres-runtime-postflight.json'
const pool = new Pool({connectionString,max:8,connectionTimeoutMillis:5000})
const store = createPostgresNotificationPushDeliveryClaimStore(pool)
const now = '2026-11-11T08:00:00.000Z'
const leaseExpiresAt = '2026-11-11T08:03:00.000Z'
const checks = {
  boundedDueRowsClaimedAndAttemptsIncremented:false,
  expiredBelowLimitLeaseReclaimedWithNewToken:false,
  expiredMaxAttemptLeaseFailed:false,
  notificationContextJoinedFromW05Authority:false,
  tokenHashSnapshotIsLeaseProtected:false,
  missingNotificationCanBeCancelledWithLeaseToken:false,
  concurrentClaimUsesSkipLockedAndReturnsOneWinner:false,
  cleanupVerified:false,
}
let runtimePassed = false

async function addNotification(id) {
  await pool.query(
    `INSERT INTO social_notifications
      (notification_id,recipient_user_id,actor_user_id,notification_type,target_type,target_id,dedupe_key,created_at)
     VALUES ($1,$2,$3,'LIKE','content',$4,$5,$6::timestamptz)`,
    [id,marker+'-recipient',marker+'-actor',marker+'-content',marker+'-dedupe-'+id,now],
  )
}
async function addDelivery(id,status,attemptCount,nextAttemptAt,previousLeaseToken=null,leaseExpires=null) {
  await pool.query(
    `INSERT INTO social_notification_push_deliveries
      (delivery_id,notification_id,endpoint_id,status,attempt_count,receipt_poll_count,next_attempt_at,
       lease_token,lease_expires_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,0,$6::timestamptz,$7,$8::timestamptz,$6::timestamptz,$6::timestamptz)`,
    [id,marker+'-notification-'+id,marker+'-endpoint-'+id,status,attemptCount,nextAttemptAt,previousLeaseToken,leaseExpires],
  )
}

try {
  const pendingId = marker+'-pending-1'
  const retryId = marker+'-retry-1'
  const expiredId = marker+'-expired-1'
  for (const id of [pendingId,retryId,expiredId]) await addNotification(marker+'-notification-'+id)
  await addDelivery(pendingId,'PENDING',0,now)
  await addDelivery(retryId,'RETRY',2,now)
  await addDelivery(expiredId,'LEASED',3,'2026-11-11T07:00:00.000Z',marker+'-old-lease','2026-11-11T07:59:00.000Z')

  const exhaustedId = marker+'-exhausted'
  await addNotification(marker+'-notification-'+exhaustedId)
  await addDelivery(exhaustedId,'LEASED',6,'2026-11-11T07:00:00.000Z',marker+'-exhausted-lease','2026-11-11T07:59:00.000Z')
  const missingContextId = marker+'-missing-context'
  await addDelivery(missingContextId,'PENDING',0,now)

  const first = await store.claimDue({now,leaseExpiresAt,limit:3,maxAttempts:6})
  assert.equal(first.length,3)
  assert.deepEqual(first.map(row=>row.delivery_id),[expiredId,pendingId,retryId])
  assert.ok(first.every(row=>row.attempt_count === (row.delivery_id===pendingId ? 1 : row.delivery_id===retryId ? 3 : 4)))
  assert.ok(first.every(row=>row.notification_type==='LIKE' && row.target_type==='content'))
  checks.boundedDueRowsClaimedAndAttemptsIncremented = true
  checks.expiredBelowLimitLeaseReclaimedWithNewToken = first.some(row=>row.delivery_id===expiredId && row.lease_token!==marker+'-old-lease')
  assert.equal(checks.expiredBelowLimitLeaseReclaimedWithNewToken,true)
  checks.notificationContextJoinedFromW05Authority = true
  assert.equal(new Set(first.map(row=>row.lease_token)).size,3)

  const firstRow = first[0]
  assert.equal(await store.savePushTokenHash({
    deliveryId:firstRow.delivery_id,leaseToken:firstRow.lease_token,pushTokenHash:'a'.repeat(64),now,
  }),true)
  assert.equal(await store.savePushTokenHash({
    deliveryId:firstRow.delivery_id,leaseToken:'stale-'+firstRow.lease_token,pushTokenHash:'b'.repeat(64),now,
  }),false)
  checks.tokenHashSnapshotIsLeaseProtected = true

  const next = await store.claimDue({now,leaseExpiresAt,limit:5,maxAttempts:6})
  const missing = next.find(row=>row.delivery_id===missingContextId)
  assert.ok(missing && missing.recipient_user_id===null)
  assert.equal(await store.cancel({
    deliveryId:missing.delivery_id,leaseToken:missing.lease_token,reason:'NOTIFICATION_NOT_FOUND',now,
  }),true)
  checks.missingNotificationCanBeCancelledWithLeaseToken = true

  const exhausted = await pool.query(
    'SELECT status,lease_token,lease_expires_at,last_error_code FROM social_notification_push_deliveries WHERE delivery_id=$1',
    [exhaustedId],
  )
  assert.deepEqual(exhausted.rows[0],{
    status:'FAILED',lease_token:null,lease_expires_at:null,last_error_code:'SEND_LEASE_EXPIRED_MAX_ATTEMPTS',
  })
  checks.expiredMaxAttemptLeaseFailed = true

  const concurrentId = marker+'-concurrent'
  await addNotification(marker+'-notification-'+concurrentId)
  await addDelivery(concurrentId,'PENDING',0,now)
  const races = await Promise.all([
    store.claimDue({now,leaseExpiresAt,limit:1,maxAttempts:6}),
    store.claimDue({now,leaseExpiresAt,limit:1,maxAttempts:6}),
  ])
  assert.equal(races.flat().filter(row=>row.delivery_id===concurrentId).length,1)
  checks.concurrentClaimUsesSkipLockedAndReturnsOneWinner = true
  runtimePassed = true
} finally {
  try {
    await pool.query('DELETE FROM social_notification_push_deliveries WHERE delivery_id LIKE $1 OR notification_id LIKE $1',[marker+'%'])
    await pool.query('DELETE FROM social_notification_push_outbox WHERE notification_id LIKE $1',[marker+'%'])
    await pool.query('DELETE FROM social_notifications WHERE notification_id LIKE $1',[marker+'%'])
    const residual = await pool.query(
      'SELECT (SELECT count(*)::int FROM social_notification_push_deliveries WHERE delivery_id LIKE $1 OR notification_id LIKE $1) AS deliveries,'+
      '(SELECT count(*)::int FROM social_notification_push_outbox WHERE notification_id LIKE $1) AS outbox,'+
      '(SELECT count(*)::int FROM social_notifications WHERE notification_id LIKE $1) AS notifications',
      [marker+'%'],
    )
    const rows = residual.rows[0] ?? {deliveries:-1,outbox:-1,notifications:-1}
    assert.deepEqual(rows,{deliveries:0,outbox:0,notifications:0})
    checks.cleanupVerified = true
    const report = {
      status:runtimePassed ? 'W05_PUSH_DELIVERY_CLAIM_POSTGRES_RUNTIME_PASS' : 'W05_PUSH_DELIVERY_CLAIM_POSTGRES_RUNTIME_FAILED',
      postgresDatabase:target.pathname.slice(1),...checks,remainingFixtureRows:rows,
      remoteNeonTouched:false,cloudflareD1Touched:false,businessDataImported:false,
      w09EndpointAuthorityChanged:false,workerBindingsChanged:false,productionCutoverAuthorized:false,
    }
    await mkdir(dirname(reportPath),{recursive:true})
    await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
    console.log((runtimePassed?'W05_PUSH_DELIVERY_CLAIM_POSTGRES_RUNTIME_PASS ':'W05_PUSH_DELIVERY_CLAIM_POSTGRES_RUNTIME_FAILED ')+JSON.stringify(report))
  } finally { await pool.end() }
}
