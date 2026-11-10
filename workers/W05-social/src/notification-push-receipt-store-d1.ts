import {
  NotificationPushReceiptStoreError,
  type ClaimDueReceiptsInput,
  type DeferReceiptInput,
  type FailReceiptInput,
  type NotificationPushReceiptStore,
  type ReceiptClaimCandidate,
  type ReceiptLeaseInput,
} from './notification-push-receipt-store.js'
type Rows<Row>={results?:Row[]|null}
type RunResult={meta?:{changes?:number}}
type Bound={all<Row>():Promise<Rows<Row>>;first<Row>():Promise<Row|null>;run():Promise<RunResult>}
type Statement={bind(...values:unknown[]):Bound}
export interface NotificationPushReceiptD1Executor {prepare(sql:string):Statement}

type CandidateRow={delivery_id:string;notification_id:string;endpoint_id:string;expo_ticket_id:string}

export function createD1NotificationPushReceiptStore(db:NotificationPushReceiptD1Executor):NotificationPushReceiptStore {
  const update=async(sql:string,values:unknown[])=>{
    try{return Number((await db.prepare(sql).bind(...values).run()).meta?.changes??0)===1}
    catch{throw new NotificationPushReceiptStoreError()}
  }
  return {
    async claimDue(input:ClaimDueReceiptsInput){
      try{
        await db.prepare(
          "UPDATE social_notification_push_deliveries SET status='FAILED',lease_token=NULL,lease_expires_at=NULL,"+
          "last_error_code='RECEIPT_LEASE_EXPIRED_MAX_POLLS',updated_at=? "+
          "WHERE status='RECEIPT_LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at<=? AND receipt_poll_count>=?",
        ).bind(input.now,input.now,input.maxReceiptPolls).run()
        const candidates=await db.prepare(
          "SELECT delivery_id,notification_id,endpoint_id,expo_ticket_id FROM social_notification_push_deliveries "+
          "WHERE ((status='RECEIPT_PENDING' AND expo_ticket_id IS NOT NULL AND next_attempt_at<=? AND receipt_poll_count<?) "+
          "OR (status='RECEIPT_LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at<=? AND receipt_poll_count<?)) "+
          "ORDER BY next_attempt_at ASC,created_at ASC,delivery_id ASC LIMIT ?",
        ).bind(input.now,input.maxReceiptPolls,input.now,input.maxReceiptPolls,input.limit).all<CandidateRow>()
        const claimed:ReceiptClaimCandidate[]=[]
        for(const candidate of candidates.results??[]){
          const token=crypto.randomUUID()
          const row=await db.prepare(
            "UPDATE social_notification_push_deliveries SET status='RECEIPT_LEASED',lease_token=?,lease_expires_at=?,"+
            "receipt_poll_count=receipt_poll_count+1,updated_at=? WHERE delivery_id=? AND "+
            "((status='RECEIPT_PENDING' AND next_attempt_at<=? AND receipt_poll_count<?) "+
            "OR (status='RECEIPT_LEASED' AND lease_expires_at IS NOT NULL AND lease_expires_at<=? AND receipt_poll_count<?)) "+
            "RETURNING delivery_id,notification_id,endpoint_id,expo_ticket_id,attempt_count,receipt_poll_count,push_token_hash",
          ).bind(token,input.leaseExpiresAt,input.now,candidate.delivery_id,input.now,input.maxReceiptPolls,input.now,input.maxReceiptPolls)
           .first<Omit<ReceiptClaimCandidate,'recipient_user_id'|'lease_token'>>()
          if(!row)continue
          const owner=await db.prepare(
            'SELECT recipient_user_id FROM social_notification_push_outbox WHERE notification_id=? LIMIT 1',
          ).bind(row.notification_id).first<{recipient_user_id:string}>()
          claimed.push({...row,lease_token:token,recipient_user_id:owner?.recipient_user_id??null})
        }
        return claimed
      }catch{throw new NotificationPushReceiptStoreError()}
    },
    async cancelMissingOutbox(input:ReceiptLeaseInput){
      return update(
        "UPDATE social_notification_push_deliveries SET status='CANCELLED',lease_token=NULL,lease_expires_at=NULL,"+
        "last_error_code='OUTBOX_NOT_FOUND',updated_at=? WHERE delivery_id=? AND status='RECEIPT_LEASED' AND lease_token=?",
        [input.now,input.deliveryId,input.leaseToken])
    },
    async deferReceipt(input:DeferReceiptInput){
      return update(
        "UPDATE social_notification_push_deliveries SET status='RECEIPT_PENDING',next_attempt_at=?,"+
        "lease_token=NULL,lease_expires_at=NULL,last_error_code='RECEIPT_NOT_READY',updated_at=? "+
        "WHERE delivery_id=? AND status='RECEIPT_LEASED' AND lease_token=?",
        [input.nextAttemptAt,input.now,input.deliveryId,input.leaseToken])
    },
    async timeoutReceipt(input:ReceiptLeaseInput){
      return update(
        "UPDATE social_notification_push_deliveries SET status='FAILED',lease_token=NULL,lease_expires_at=NULL,"+
        "last_error_code='RECEIPT_TIMEOUT',updated_at=? WHERE delivery_id=? AND status='RECEIPT_LEASED' AND lease_token=?",
        [input.now,input.deliveryId,input.leaseToken])
    },
    async acceptReceipt(input:ReceiptLeaseInput){
      return update(
        "UPDATE social_notification_push_deliveries SET status='PROVIDER_ACCEPTED',lease_token=NULL,"+
        "lease_expires_at=NULL,last_error_code=NULL,updated_at=? WHERE delivery_id=? AND status='RECEIPT_LEASED' AND lease_token=?",
        [input.now,input.deliveryId,input.leaseToken])
    },
    async failReceipt(input:FailReceiptInput){
      return update(
        "UPDATE social_notification_push_deliveries SET status=?,next_attempt_at=?,expo_ticket_id=NULL,"+
        "lease_token=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=? "+
        "WHERE delivery_id=? AND status='RECEIPT_LEASED' AND lease_token=?",
        [input.status,input.nextAttemptAt,input.errorCode,input.now,input.deliveryId,input.leaseToken])
    },
  }
}
