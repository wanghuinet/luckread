import {describe,expect,it,vi} from 'vitest'
import {createPostgresNotificationPushReceiptStore,type NotificationPushReceiptPostgresExecutor} from './notification-push-receipt-store-postgres.js'
import {NotificationPushReceiptStoreError} from './notification-push-receipt-store.js'
describe('W05 notification push receipt PostgreSQL store',()=>{
 it('claims receipt rows atomically using SKIP LOCKED and joins W05 outbox owner',async()=>{
  const calls:Array<{sql:string;values:unknown[]}>=[]
  const db:NotificationPushReceiptPostgresExecutor={async query<Row extends Record<string,unknown>>(sql,values=[]){
   calls.push({sql,values});return{rows:[{delivery_id:'d',notification_id:'n',endpoint_id:'e',expo_ticket_id:'t',lease_token:'l',
    attempt_count:2,receipt_poll_count:3,push_token_hash:'a'.repeat(64),recipient_user_id:'u'}] as Row[]}
  }}
  const s=createPostgresNotificationPushReceiptStore(db)
  await expect(s.claimDue({now:'now',leaseExpiresAt:'later',limit:300,maxReceiptPolls:24})).resolves.toMatchObject([{delivery_id:'d',recipient_user_id:'u'}])
  expect(calls).toHaveLength(1);expect(calls[0]?.sql).toContain('FOR UPDATE OF delivery SKIP LOCKED')
  expect(calls[0]?.sql).toContain('LEFT JOIN social_notification_push_outbox')
  expect(calls[0]?.values).toEqual([300,24,'now','later'])
 })
 it('guards every receipt outcome with a lease-token CAS',async()=>{
  const calls:Array<{sql:string;values:unknown[]}>=[]
  const db:NotificationPushReceiptPostgresExecutor={async query<Row extends Record<string,unknown>>(sql,values=[]){
   calls.push({sql,values});return{rows:[{delivery_id:'d'}] as Row[]}
  }}
  const s=createPostgresNotificationPushReceiptStore(db),lease={deliveryId:'d',leaseToken:'l',now:'now'}
  await s.cancelMissingOutbox(lease);await s.deferReceipt({...lease,nextAttemptAt:'later'})
  await s.timeoutReceipt(lease);await s.acceptReceipt(lease)
  await s.failReceipt({...lease,status:'RETRY',nextAttemptAt:'later',errorCode:'ExpoServerError'})
  expect(calls).toHaveLength(5);expect(calls.every(c=>c.sql.includes("status='RECEIPT_LEASED' AND lease_token="))).toBe(true)
  expect(calls.every(c=>c.sql.includes('RETURNING delivery_id'))).toBe(true)
 })
 it('rejects stale lease results and sanitizes PostgreSQL failures',async()=>{
  const query=vi.fn(async()=>({rows:[]}))
  const s=createPostgresNotificationPushReceiptStore({query} as unknown as NotificationPushReceiptPostgresExecutor)
  await expect(s.acceptReceipt({deliveryId:'d',leaseToken:'old',now:'now'})).resolves.toBe(false)
  const broken=createPostgresNotificationPushReceiptStore({async query(){throw Error('private host password')}} as unknown as NotificationPushReceiptPostgresExecutor)
  await expect(broken.claimDue({now:'now',leaseExpiresAt:'later',limit:1,maxReceiptPolls:24})).rejects.toBeInstanceOf(NotificationPushReceiptStoreError)
 })
})
