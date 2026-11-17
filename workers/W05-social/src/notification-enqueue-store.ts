export type NotificationEnqueueType = 'FOLLOW' | 'LIKE' | 'COMMENT' | 'REPLY' | 'MENTION'
export type NotificationEnqueueTargetType = 'user' | 'content' | 'comment'

export type NotificationEnqueueInput = Readonly<{
  notificationId: string
  recipientUserId: string
  actorUserId: string
  notificationType: NotificationEnqueueType
  targetType: NotificationEnqueueTargetType
  targetId: string
  dedupeKey: string
  payloadJson: string
  createdAt: string
}>

export interface NotificationEnqueueStore {
  enqueue(input: NotificationEnqueueInput): Promise<void>
}

/** Provider failures are sanitized before crossing the W05 runtime boundary. */
export class NotificationEnqueueStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor(readonly retryable: boolean) {
    super('NOTIFICATION_ENQUEUE_STORE_UNAVAILABLE')
    this.name = 'NotificationEnqueueStoreError'
  }
}
