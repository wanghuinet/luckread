export type ReceiptClaimCandidate = Readonly<{
  delivery_id:string; notification_id:string; endpoint_id:string; expo_ticket_id:string;
  lease_token:string; attempt_count:number; receipt_poll_count:number;
  push_token_hash:string|null; recipient_user_id:string|null;
}>
export type ClaimDueReceiptsInput = Readonly<{
  now:string; leaseExpiresAt:string; limit:number; maxReceiptPolls:number;
}>
export type ReceiptLeaseInput = Readonly<{deliveryId:string;leaseToken:string;now:string}>
export type DeferReceiptInput = ReceiptLeaseInput & Readonly<{nextAttemptAt:string}>
export type FailReceiptInput = ReceiptLeaseInput & Readonly<{
  status:'RETRY'|'FAILED'; nextAttemptAt:string; errorCode:string;
}>
export type NotificationPushReceiptStore = Readonly<{
  claimDue(input:ClaimDueReceiptsInput):Promise<readonly ReceiptClaimCandidate[]>
  cancelMissingOutbox(input:ReceiptLeaseInput):Promise<boolean>
  deferReceipt(input:DeferReceiptInput):Promise<boolean>
  timeoutReceipt(input:ReceiptLeaseInput):Promise<boolean>
  acceptReceipt(input:ReceiptLeaseInput):Promise<boolean>
  failReceipt(input:FailReceiptInput):Promise<boolean>
}>
export class NotificationPushReceiptStoreError extends Error {
  readonly code='SERVICE_UNAVAILABLE'
  readonly status=503
  constructor(){super('NOTIFICATION_PUSH_RECEIPT_STORE_UNAVAILABLE');this.name='NotificationPushReceiptStoreError'}
}
