import {describe,expect,it} from 'vitest'
import {createD1NotificationPushReceiptStore,type NotificationPushReceiptD1Executor} from './notification-push-receipt-store-d1.js'
describe('W05 notification push receipt D1 store',()=>{
 it('recovers max-poll leases and claims due receipt rows with W05 outbox owner',async()=>{
  const calls:Array<{sql:string;values:unknown[]}>=[]
  const candidate={delivery_id:'d1',notification_id:'n1',endpoint_id:'e1',expo_ticket_id:'t1'}
  const db:NotificationPushReceiptD1Executor={prepare(sql){return{bind(...values){calls.push({sql,values});return{
   async all<Row>(){return{results:[candidate as Row]}},
   async first<Row>(){if(sql.startsWith('UPDATE')&&sql.includes('RETURNING'))return{...candidate,attempt_count:2,receipt_poll_count:3,push_token_hash:'a'.repeat(64)} as Row;
    if(sql.startsWith('SELECT recipient_user_id'))return{recipient_user_id:'u1'} as Row;return null},
   async run(){return{meta:{changes:1}}}
  }}}}}
  const rows=await createD1NotificationPushReceiptStore(db).claimDue({now:'2026-11-11T08:00:00.000Z',leaseExpiresAt:'2026-11-11T08:03:00.000Z',limit:300,maxReceiptPolls:24})
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({delivery_id:'d1',recipient_user_id:'u1',receipt_poll_count:3,lease_token:expect.any(String)})
  expect(calls[0]?.sql).toContain('RECEIPT_LEASE_EXPIRED_MAX_POLLS')
  expect(calls[2]?.sql).toContain("status='RECEIPT_LEASED'")
 })
 it('uses lease-token CAS for cancellation and result transitions',async()=>{
  const calls:string[]=[]
  const db:NotificationPushReceiptD1Executor={prepare(sql){return{bind(){calls.push(sql);return{
   async all<Row>(){return{results:[] as Row[]}},async first<Row>(){return null},async run(){return{meta:{changes:1}}}
  }}}}}
  const s=createD1NotificationPushReceiptStore(db),lease={deliveryId:'d',leaseToken:'l',now:'now'}
  await s.cancelMissingOutbox(lease);await s.deferReceipt({...lease,nextAttemptAt:'later'})
  await s.timeoutReceipt(lease);await s.acceptReceipt(lease)
  await s.failReceipt({...lease,status:'RETRY',nextAttemptAt:'later',errorCode:'ExpoServerError'})
  expect(calls).toHaveLength(5)
  expect(calls.every(sql=>sql.includes("status='RECEIPT_LEASED' AND lease_token=?"))).toBe(true)
 })
 it('returns false for stale lease and sanitizes database failures',async()=>{
  const empty:NotificationPushReceiptD1Executor={prepare(){return{bind(){return{
   async all<Row>(){return{results:[] as Row[]}},async first<Row>(){return null},async run(){return{meta:{changes:0}}}
  }}}}}
  const s=createD1NotificationPushReceiptStore(empty)
  await expect(s.acceptReceipt({deliveryId:'d',leaseToken:'old',now:'now'})).resolves.toBe(false)
  const broken={prepare(){return{bind(){return{async all(){throw Error('secret')},async first(){return null},async run(){return{}}}}}}} as unknown as NotificationPushReceiptD1Executor
  await expect(createD1NotificationPushReceiptStore(broken).claimDue({now:'now',leaseExpiresAt:'later',limit:1,maxReceiptPolls:24})).rejects.toThrow('NOTIFICATION_PUSH_RECEIPT_STORE_UNAVAILABLE')
 })
})
