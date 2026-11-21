export type CommentNotificationContextRow = Readonly<{
  comment_id: string
  content_id: string
  author_user_id: string | null
}>

export interface CommentNotificationContextStore {
  getPublishedContext(commentId: string): Promise<CommentNotificationContextRow | null>
}

export class CommentNotificationContextStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('COMMENT_NOTIFICATION_CONTEXT_STORE_UNAVAILABLE')
    this.name = 'CommentNotificationContextStoreError'
  }
}

