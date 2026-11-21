import {
  CommentNotificationContextStoreError,
  type CommentNotificationContextRow,
  type CommentNotificationContextStore,
} from './comment-notification-context-store.js'

export class CommentNotificationContextRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}

/** Reads only W05-owned comment metadata; W03 remains canonical for content state. */
export async function getPublishedCommentNotificationContext(
  store: CommentNotificationContextStore,
  commentId: string,
): Promise<CommentNotificationContextRow | null> {
  try {
    return await store.getPublishedContext(commentId)
  } catch (error) {
    if (error instanceof CommentNotificationContextStoreError) {
      throw new CommentNotificationContextRuntimeError(error.code, error.status)
    }
    throw error
  }
}
