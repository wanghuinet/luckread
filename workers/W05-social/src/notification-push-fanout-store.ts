export type PendingPushOutboxRow = Readonly<{
  notification_id: string
  recipient_user_id: string
}>

export type PushFanoutDeliveryInput = Readonly<{
  delivery_id: string
  endpoint_id: string
}>

export type NotificationPushFanoutStore = Readonly<{
  listPending(limit: number): Promise<readonly PendingPushOutboxRow[]>
  markNoEndpoint(notificationId: string, now: string): Promise<void>
  fanOut(input: Readonly<{
    notificationId: string
    deliveries: readonly PushFanoutDeliveryInput[]
    endpointCount: number
    now: string
  }>): Promise<void>
}>

export class NotificationPushFanoutStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('NOTIFICATION_PUSH_FANOUT_UNAVAILABLE')
    this.name = 'NotificationPushFanoutStoreError'
  }
}

