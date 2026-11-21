export type NotificationPushSendRetryStatus = 'RETRY' | 'FAILED'

export type RecordNotificationPushTicketInput = Readonly<{
  deliveryId: string
  leaseToken: string
  ticketId: string
  nextAttemptAt: string
  now: string
}>

export type ScheduleNotificationPushRetryInput = Readonly<{
  deliveryId: string
  leaseToken: string
  status: NotificationPushSendRetryStatus
  nextAttemptAt: string
  errorCode: string
  now: string
}>

export type NotificationPushSendResultStore = Readonly<{
  /** Lease-token compare-and-set. False means the claim has already expired or been superseded. */
  recordTicket(input: RecordNotificationPushTicketInput): Promise<boolean>
  /** Lease-token compare-and-set. False means the claim has already expired or been superseded. */
  scheduleRetry(input: ScheduleNotificationPushRetryInput): Promise<boolean>
}>

export class NotificationPushSendResultStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('NOTIFICATION_PUSH_SEND_RESULT_UNAVAILABLE')
    this.name = 'NotificationPushSendResultStoreError'
  }
}

