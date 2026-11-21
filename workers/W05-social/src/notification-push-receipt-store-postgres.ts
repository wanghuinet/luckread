import {
  NotificationPushReceiptStoreError,
  type ClaimDueReceiptsInput,
  type DeferReceiptInput,
  type FailReceiptInput,
  type NotificationPushReceiptStore,
  type ReceiptClaimCandidate,
  type ReceiptLeaseInput,
} from './notification-push-receipt-store.js'
type QueryResult<Row>={rows:Row[]}
export interface NotificationPushReceiptPostgresExecutor {
  query<Row extends Record<string,unknown>=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<QueryResult<Row>>
}
export function createPostgresNotificationPushReceiptStore(db:NotificationPushReceiptPostgresExecutor):NotificationPushReceiptStore {
  const query=async<Row extends Record<string,unknown>>(sql:string,values:unknown[]):Promise<Row[]>=>{
    try{return (await db.query<Row>(sql,values)).rows}
    catch{throw new NotificationPushReceiptStoreError()}
  }
  const update=async(sql:string,values:unknown[]) => (await query<{delivery_id:string}>(sql,values)).length===1
  return {
    async claimDue(input:ClaimDueReceiptsInput){
      return query<ReceiptClaimCandidate>(`
        WITH expired_max_polls AS (
          UPDATE social_notification_push_deliveries
             SET status='FAILED',lease_token=NULL,lease_expires_at=NULL,
                 last_error_code='RECEIPT_LEASE_EXPIRED_MAX_POLLS',updated_at=$3::timestamptz
           WHERE status='RECEIPT_LEASED' AND lease_expires_at IS NOT NULL
             AND lease_expires_at<=$3::timestamptz AND receipt_poll_count>=$2
          RETURNING delivery_id
        ),
        candidates AS MATERIALIZED (
          SELECT delivery.delivery_id
            FROM social_notification_push_deliveries delivery
           WHERE (
             (delivery.status='RECEIPT_PENDING' AND delivery.expo_ticket_id IS NOT NULL
               AND delivery.next_attempt_at<=$3::timestamptz AND delivery.receipt_poll_count<$2)
             OR
             (delivery.status='RECEIPT_LEASED' AND delivery.lease_expires_at IS NOT NULL
               AND delivery.lease_expires_at<=$3::timestamptz AND delivery.receipt_poll_count<$2)
           )
           ORDER BY delivery.next_attempt_at ASC,delivery.created_at ASC,delivery.delivery_id ASC
           LIMIT $1 FOR UPDATE OF delivery SKIP LOCKED
        ),
        claimed AS (
          UPDATE social_notification_push_deliveries delivery
             SET status='RECEIPT_LEASED',lease_token=gen_random_uuid()::text,
                 lease_expires_at=$4::timestamptz,
                 receipt_poll_count=delivery.receipt_poll_count+1,updated_at=$3::timestamptz
            FROM candidates
           WHERE delivery.delivery_id=candidates.delivery_id
          RETURNING delivery.delivery_id,delivery.notification_id,delivery.endpoint_id,
                    delivery.expo_ticket_id,delivery.lease_token,delivery.attempt_count,
                    delivery.receipt_poll_count,delivery.push_token_hash
        )
        SELECT claimed.delivery_id,claimed.notification_id,claimed.endpoint_id,claimed.expo_ticket_id,
               claimed.lease_token,claimed.attempt_count,claimed.receipt_poll_count,claimed.push_token_hash,
               outbox.recipient_user_id
          FROM claimed
          LEFT JOIN social_notification_push_outbox outbox
            ON outbox.notification_id=claimed.notification_id
         ORDER BY claimed.delivery_id
      `,[input.limit,input.maxReceiptPolls,input.now,input.leaseExpiresAt])
    },
    async cancelMissingOutbox(input:ReceiptLeaseInput){
      return update(`
        UPDATE social_notification_push_deliveries SET status='CANCELLED',lease_token=NULL,
          lease_expires_at=NULL,last_error_code='OUTBOX_NOT_FOUND',updated_at=$1::timestamptz
         WHERE delivery_id=$2 AND status='RECEIPT_LEASED' AND lease_token=$3 RETURNING delivery_id
      `,[input.now,input.deliveryId,input.leaseToken])
    },
    async deferReceipt(input:DeferReceiptInput){
      return update(`
        UPDATE social_notification_push_deliveries SET status='RECEIPT_PENDING',next_attempt_at=$1::timestamptz,
          lease_token=NULL,lease_expires_at=NULL,last_error_code='RECEIPT_NOT_READY',updated_at=$2::timestamptz
         WHERE delivery_id=$3 AND status='RECEIPT_LEASED' AND lease_token=$4 RETURNING delivery_id
      `,[input.nextAttemptAt,input.now,input.deliveryId,input.leaseToken])
    },
    async timeoutReceipt(input:ReceiptLeaseInput){
      return update(`
        UPDATE social_notification_push_deliveries SET status='FAILED',lease_token=NULL,lease_expires_at=NULL,
          last_error_code='RECEIPT_TIMEOUT',updated_at=$1::timestamptz
         WHERE delivery_id=$2 AND status='RECEIPT_LEASED' AND lease_token=$3 RETURNING delivery_id
      `,[input.now,input.deliveryId,input.leaseToken])
    },
    async acceptReceipt(input:ReceiptLeaseInput){
      return update(`
        UPDATE social_notification_push_deliveries SET status='PROVIDER_ACCEPTED',lease_token=NULL,
          lease_expires_at=NULL,last_error_code=NULL,updated_at=$1::timestamptz
         WHERE delivery_id=$2 AND status='RECEIPT_LEASED' AND lease_token=$3 RETURNING delivery_id
      `,[input.now,input.deliveryId,input.leaseToken])
    },
    async failReceipt(input:FailReceiptInput){
      return update(`
        UPDATE social_notification_push_deliveries SET status=$1,next_attempt_at=$2::timestamptz,expo_ticket_id=NULL,
          lease_token=NULL,lease_expires_at=NULL,last_error_code=$3,updated_at=$4::timestamptz
         WHERE delivery_id=$5 AND status='RECEIPT_LEASED' AND lease_token=$6 RETURNING delivery_id
      `,[input.status,input.nextAttemptAt,input.errorCode,input.now,input.deliveryId,input.leaseToken])
    },
  }
}
