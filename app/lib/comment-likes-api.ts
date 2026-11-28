import { apiRequest, createIdempotencyKey, getApiErrorMessage } from './api-client';
import { useAuthStore } from '../store/auth-store';

export class CommentLikeApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CommentLikeApiError';
  }
}

type LikeStatus = {
  liked: boolean;
};

function normalizeCommentId(value: string): string {
  const id = value.trim();
  if (!id || id.length > 128) {
    throw new TypeError('A valid comment ID is required.');
  }
  return id;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readLikeStatus(value: unknown): LikeStatus | null {
  const envelope = asRecord(value);
  const data = envelope && Object.prototype.hasOwnProperty.call(envelope, 'data')
    ? asRecord(envelope.data)
    : envelope;
  if (typeof data?.liked !== 'boolean') return null;
  return { liked: data.liked };
}

function viewerChangedError(): CommentLikeApiError {
  return new CommentLikeApiError(
    'Your account changed before the reply like could be updated.',
    undefined,
    'VIEWER_CHANGED',
  );
}

async function readAuthoritativeLikeStatus(
  encodedId: string,
  expectedViewerId: string,
): Promise<LikeStatus> {
  const result = await apiRequest<unknown>(
    '/interactions/likes?targetType=comment&targetId=' + encodedId,
    { method: 'GET', expectedAccountId: expectedViewerId },
  );
  if (!result.response.ok) {
    throw new CommentLikeApiError(
      result.error?.message || getApiErrorMessage(
        result.data,
        'Could not read comment like status. Please try again.',
        result.response.status,
      ),
      result.response.status,
      result.error?.code,
    );
  }
  const status = readLikeStatus(result.data);
  if (!status) throw new CommentLikeApiError('The comment like status response was invalid.');
  return status;
}

/** Toggle a comment like through W01/W05 and reconcile ambiguous writes from authoritative state. */
export async function toggleCommentLike(
  commentIdValue: string,
  expectedViewerId: string | null,
): Promise<LikeStatus> {
  const commentId = normalizeCommentId(commentIdValue);
  if (!expectedViewerId) {
    throw new CommentLikeApiError('Sign in to like replies.', 401, 'UNAUTHENTICATED');
  }
  const isCurrentViewer = () =>
    useAuthStore.getState().user?.id === expectedViewerId;
  if (!isCurrentViewer()) throw viewerChangedError();

  const encodedId = encodeURIComponent(commentId);
  const status = await readAuthoritativeLikeStatus(encodedId, expectedViewerId);
  if (!isCurrentViewer()) throw viewerChangedError();

  const nextLiked = !status.liked;
  const method = nextLiked ? 'POST' : 'DELETE';
  const idempotencyKey = 'native-comment-like:' + commentId + ':' +
    (nextLiked ? 'like' : 'unlike') + ':' + createIdempotencyKey();

  let mutationResult;
  try {
    mutationResult = await apiRequest<unknown>(
      '/comments/' + encodedId + '/likes',
      { method, idempotencyKey, expectedAccountId: expectedViewerId },
    );
  } catch (cause) {
    if (!isCurrentViewer()) throw viewerChangedError();
    // A lost response does not prove that W05 rejected the write. Re-read the
    // relationship before exposing an error or allowing the user to toggle again.
    try {
      const reconciled = await readAuthoritativeLikeStatus(encodedId, expectedViewerId);
      if (!isCurrentViewer()) throw viewerChangedError();
      if (reconciled.liked === nextLiked) return reconciled;
    } catch (readError) {
      if (readError instanceof CommentLikeApiError && readError.code === 'VIEWER_CHANGED') throw readError;
      // Preserve the original mutation failure; the UI can retry from a fresh read.
    }
    throw cause;
  }

  if (!mutationResult.response.ok && mutationResult.response.status !== 204) {
    const statusCode = mutationResult.response.status;
    const message = mutationResult.error?.message || getApiErrorMessage(
      mutationResult.data,
      nextLiked ? 'Could not like this reply. Please try again.' : 'Could not remove this like. Please try again.',
      statusCode,
    );
    // Server/timeout responses can be ambiguous too; reconcile only statuses
    // that may follow a committed write. Definitive authorization/input errors
    // remain errors and are never converted into success.
    if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
      if (!isCurrentViewer()) throw viewerChangedError();
      try {
        const reconciled = await readAuthoritativeLikeStatus(encodedId, expectedViewerId);
        if (!isCurrentViewer()) throw viewerChangedError();
        if (reconciled.liked === nextLiked) return reconciled;
      } catch (readError) {
        if (readError instanceof CommentLikeApiError && readError.code === 'VIEWER_CHANGED') throw readError;
      }
    }
    throw new CommentLikeApiError(message, statusCode, mutationResult.error?.code);
  }

  if (!isCurrentViewer()) throw viewerChangedError();
  return { liked: nextLiked };
}
