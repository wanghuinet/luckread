export type DeliveryClaimNotificationType = 'FOLLOW' | 'LIKE' | 'COMMENT' | 'REPLY' | 'MENTION'
export type DeliveryClaimTargetType = 'user' | 'content' | 'comment'
export type DeliveryClaimCancelReason = 'NOTIFICATION_NOT_FOUND' | 'ENDPOINT_NOT_ACTIVE'

export type ClaimedNotificationDeliveryCandidate = Readonly<{
  delivery_id: string
  notification_id: string
  endpoint_id: string
  lease_token: string
  attempt_count: number
  recipient_user_id: string | null
  notification_type: DeliveryClaimNotificationType | null
  target_type: DeliveryClaimTargetType | null
  target_id: string | null
}>
export type ClaimDueNotificationDeliveriesInput = Readonly<{
  now: string
  leaseExpiresAt: string
  limit: number
  maxAttempts: number
}>
export type CancelClaimedNotificationDeliveryInput = Readonly<{
  deliveryId: string
  leaseToken: string
  reason: DeliveryClaimCancelReason
  now: string
}>
export type SaveNotificationPushTokenHashInput = Readonly<{
  deliveryId: string
  leaseToken: string
  pushTokenHash: string
  now: string
}>
export type NotificationPushDeliveryClaimStore = Readonly<{
  claimDue(input: ClaimDueNotificationDeliveriesInput): Promise<readonly ClaimedNotificationDeliveryCandidate[]>
  cancel(input: CancelClaimedNotificationDeliveryInput): Promise<boolean>
  savePushTokenHash(input: SaveNotificationPushTokenHashInput): Promise<boolean>
}>
export class NotificationPushDeliveryClaimStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503
  constructor() {
    super('NOTIFICATION_PUSH_DELIVERY_CLAIM_UNAVAILABLE')
    this.name = 'NotificationPushDeliveryClaimStoreError'
  }
}
