import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {createPostgresNotificationPushReceiptStore} from '../../src/notification-push-receipt-store-postgres.ts'
const requireFromW02=createRequire(new URL('../../../W02-identity/package.json',import.meta.url))
const {Pool}=requireFromW02('pg')
const connectionString=process.env.W05_PUSH_RECEIPT_POSTGRES_DATABASE_URL
if(!connectionString)throw Error('W05_PUSH_RECEIPT_POSTGRES_DATABASE_URL is required')
const target=new URL(connectionString)
if(!['127.0.0.1','localhost','postgres'].includes(target.hostname)||target.port!=='5432'||target.pathname!=='/luckread_w05_d1_02_schema')
 throw Error('Refusing to rehearse receipts outside disposable local PostgreSQL luckread_w05_d1_02_schema')
const marker='w05-push-receipt-'+randomUUID()
const reportPath=process.env.W05_PUSH_RECEIPT_POSTGRES_REPORT||'artifacts/neon/w05-push-receipt-postgres-runtime-postflight.json'
const pool=new Pool({connectionString,max:8,connectionTimeoutMillis:5000}),store=createPostgresNotificationPushReceiptStore(pool)
const now='2026-11-11T08:00:00.000Z',leaseExpiresAt='2026-11-11T08:03:00.000Z'
const checks={boundedClaimAndPollIncrement:false,expiredLeaseReclaimed:false,maxPollExpiredLeaseFailed:false,
 missingOutboxCancelled:false,providerAccepted:false,notReadyDeferred:false,receiptTimeout:false,
 retryableErrorToRetry:false,permanentErrorToFailed:false,staleLeaseCannotOverwrite:false,
 concurrentResultsOneWinner:false,cleanupVerified:false}
let passed=false
async function addNotification(id){
 await pool.query(`INSERT INTO social_notifications(notification_id,recipient_user_id,actor_user_id,notification_type,target_type,target_id,dedupe_key,created_at)
 VALUES($1,$2,$3,'MENTION','content',$4,$5,$6::timestamptz)`,
 [id,marker+'-recipient',marker+'-actor',marker+'-content',marker+'-dedupe-'+id,now])
}
async function addDelivery(id,status,attempt,polls,nextAt,lease=null,expires=null,ticket='ticket'){
 await pool.query(`INSERT INTO social_notification_push_deliveries
 (delivery_id,notification_id,endpoint_id,status,attempt_count,receipt_poll_count,next_attempt_at,lease_token,lease_expires_at,expo_ticket_id,push_token_hash,created_at,updated_at)
 VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9::timestamptz,$10,$11,$7::timestamptz,$7::timestamptz)`,
 [id,marker+'-notification-'+id,marker+'-endpoint-'+id,status,attempt,polls,nextAt,lease,expires,ticket,'a'.repeat(64)])
}
try{
 const pending=marker+'-pending',expired=marker+'-expired',exhausted=marker+'-exhausted',missing=marker+'-missing'
 for(const id of [pending,expired,exhausted])await addNotification(marker+'-notification-'+id)
 await addDelivery(pending,'RECEIPT_PENDING',2,0,now)
 await addDelivery(expired,'RECEIPT_LEASED',2,2,'2026-11-11T07:00:00.000Z',marker+'-old','2026-11-11T07:59:00.000Z')
 await addDelivery(exhausted,'RECEIPT_LEASED',2,24,'2026-11-11T07:00:00.000Z',marker+'-max','2026-11-11T07:59:00.000Z')
 await addDelivery(missing,'RECEIPT_PENDING',1,0,now)
 const first=await store.claimDue({now,leaseExpiresAt,limit:3,maxReceiptPolls:24})
 assert.equal(first.length,3)
 assert.ok(first.some(x=>x.delivery_id===pending))
 assert.ok(first.some(x=>x.delivery_id===expired&&x.lease_token!==marker+'-old'))
 assert.ok(first.every(x=>x.recipient_user_id===marker+'-recipient'))
 checks.boundedClaimAndPollIncrement=first.every(x=>x.receipt_poll_count>=1)
 checks.expiredLeaseReclaimed=first.some(x=>x.delivery_id===expired&&x.lease_token!==marker+'-old')
 const pendingTask=first.find(x=>x.delivery_id===pending)
 assert.equal(await store.acceptReceipt({deliveryId:pendingTask.delivery_id,leaseToken:pendingTask.lease_token,now}),true)
 checks.providerAccepted=true
 const next=await store.claimDue({now,leaseExpiresAt,limit:20,maxReceiptPolls:24})
 const missingTask=next.find(x=>x.delivery_id===missing)
 assert.ok(missingTask&&missingTask.recipient_user_id===null)
 assert.equal(await store.cancelMissingOutbox({deliveryId:missingTask.delivery_id,leaseToken:missingTask.lease_token,now}),true)
 checks.missingOutboxCancelled=true
 const exhaustedState=await pool.query('SELECT status,last_error_code,lease_token,lease_expires_at FROM social_notification_push_deliveries WHERE delivery_id=$1',[exhausted])
 assert.deepEqual(exhaustedState.rows[0],{status:'FAILED',last_error_code:'RECEIPT_LEASE_EXPIRED_MAX_POLLS',lease_token:null,lease_expires_at:null})
 checks.maxPollExpiredLeaseFailed=true
 const noReceipt=next.find(x=>x.delivery_id===expired)
 assert.ok(noReceipt)
 assert.equal(await store.deferReceipt({deliveryId:noReceipt.delivery_id,leaseToken:noReceipt.lease_token,nextAttemptAt:'2026-11-11T08:05:00.000Z',now}),true)
 const deferred=await pool.query('SELECT status,expo_ticket_id,last_error_code,lease_token FROM social_notification_push_deliveries WHERE delivery_id=$1',[expired])
 assert.deepEqual(deferred.rows[0],{status:'RECEIPT_PENDING',expo_ticket_id:'ticket',last_error_code:'RECEIPT_NOT_READY',lease_token:null})
 checks.notReadyDeferred=true
 const timeout=marker+'-timeout';await addNotification(marker+'-notification-'+timeout)
 await addDelivery(timeout,'RECEIPT_LEASED',6,24,now,marker+'-timeout-lease',leaseExpiresAt)
 assert.equal(await store.timeoutReceipt({deliveryId:timeout,leaseToken:marker+'-timeout-lease',now}),true);checks.receiptTimeout=true
 const retry=marker+'-retry';await addNotification(marker+'-notification-'+retry)
 await addDelivery(retry,'RECEIPT_LEASED',2,3,now,marker+'-retry-lease',leaseExpiresAt)
 assert.equal(await store.failReceipt({deliveryId:retry,leaseToken:marker+'-retry-lease',status:'RETRY',nextAttemptAt:'2026-11-11T08:01:00.000Z',errorCode:'ExpoServerError',now}),true)
 checks.retryableErrorToRetry=true
 const fail=marker+'-fail';await addNotification(marker+'-notification-'+fail)
 await addDelivery(fail,'RECEIPT_LEASED',6,3,now,marker+'-fail-lease',leaseExpiresAt)
 assert.equal(await store.failReceipt({deliveryId:fail,leaseToken:marker+'-fail-lease',status:'FAILED',nextAttemptAt:now,errorCode:'MessageTooBig',now}),true)
 checks.permanentErrorToFailed=true
 assert.equal(await store.acceptReceipt({deliveryId:retry,leaseToken:marker+'-retry-lease',now}),false)
 checks.staleLeaseCannotOverwrite=true
 const race=marker+'-race';await addNotification(marker+'-notification-'+race)
 await addDelivery(race,'RECEIPT_LEASED',1,2,now,marker+'-race-lease',leaseExpiresAt)
 const outcomes=await Promise.all([
  store.acceptReceipt({deliveryId:race,leaseToken:marker+'-race-lease',now}),
  store.failReceipt({deliveryId:race,leaseToken:marker+'-race-lease',status:'RETRY',nextAttemptAt:'2026-11-11T08:01:00.000Z',errorCode:'ExpoServerError',now}),
 ])
 assert.equal(outcomes.filter(Boolean).length,1);checks.concurrentResultsOneWinner=true
 passed=true
}finally{
 try{
  await pool.query('DELETE FROM social_notification_push_deliveries WHERE delivery_id LIKE $1 OR notification_id LIKE $1',[marker+'%'])
  await pool.query('DELETE FROM social_notification_push_outbox WHERE notification_id LIKE $1',[marker+'%'])
  await pool.query('DELETE FROM social_notifications WHERE notification_id LIKE $1',[marker+'%'])
  const residual=await pool.query('SELECT (SELECT count(*)::int FROM social_notification_push_deliveries WHERE delivery_id LIKE $1 OR notification_id LIKE $1) AS deliveries,(SELECT count(*)::int FROM social_notification_push_outbox WHERE notification_id LIKE $1) AS outbox,(SELECT count(*)::int FROM social_notifications WHERE notification_id LIKE $1) AS notifications',[marker+'%'])
  const rows=residual.rows[0]??{deliveries:-1,outbox:-1,notifications:-1}
  assert.deepEqual(rows,{deliveries:0,outbox:0,notifications:0});checks.cleanupVerified=true
  const report={status:passed?'W05_PUSH_RECEIPT_POSTGRES_RUNTIME_PASS':'W05_PUSH_RECEIPT_POSTGRES_RUNTIME_FAILED',postgresDatabase:target.pathname.slice(1),...checks,remainingFixtureRows:rows,remoteNeonTouched:false,cloudflareD1Touched:false,businessDataImported:false,w09EndpointAuthorityChanged:false,workerBindingsChanged:false,productionCutoverAuthorized:false}
  await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n')
  console.log((passed?'W05_PUSH_RECEIPT_POSTGRES_RUNTIME_PASS ':'W05_PUSH_RECEIPT_POSTGRES_RUNTIME_FAILED ')+JSON.stringify(report))
 }finally{await pool.end()}
}
