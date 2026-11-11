/// <reference types="@cloudflare/workers-types" />

import {
  createD1CommentNotificationContextStore,
  CommentNotificationContextStoreError,
  type CommentNotificationContextRow,
  type CommentNotificationContextStore,
} from './comment-notification-context-store.js'

export class CommentNotificationContextRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}

type CommentNotificationContextDataSource = D1Database | CommentNotificationContextStore

function resolveCommentNotificationContextStore(
  source: CommentNotificationContextDataSource,
): CommentNotificationContextStore {
  if (typeof (source as CommentNotificationContextStore).getPublishedContext === 'function') {
    return source as CommentNotificationContextStore
  }
  return createD1CommentNotificationContextStore(source as D1Database)
}

/** Reads only W05-owned comment metadata; W03 remains canonical for content state. */
export async function getPublishedCommentNotificationContext(
  source: CommentNotificationContextDataSource,
  commentId: string,
): Promise<CommentNotificationContextRow | null> {
  try {
    return await resolveCommentNotificationContextStore(source).getPublishedContext(commentId)
  } catch (error) {
    if (error instanceof CommentNotificationContextStoreError) {
      throw new CommentNotificationContextRuntimeError(error.code, error.status)
    }
    throw error
  }
}
