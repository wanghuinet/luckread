import { apiRequest, createIdempotencyKey, getApiErrorMessage } from './api-client';

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

/** Toggle a comment like using W01/W05 as the authority instead of guessing from UI state. */
export async function toggleCommentLike(commentIdValue: string): Promise<LikeStatus> {
  const commentId = normalizeCommentId(commentIdValue);
  const encodedId = encodeURIComponent(commentId);
  const statusResult = await apiRequest<unknown>(
    '/interactions/likes?targetType=comment&targetId=' + encodedId,
    { method: 'GET' },
  );

  if (!statusResult.response.ok) {
    throw new CommentLikeApiError(
      statusResult.error?.message || getApiErrorMessage(
        statusResult.data,
        'Could not read comment like status. Please try again.',
        statusResult.response.status,
      ),
      statusResult.response.status,
      statusResult.error?.code,
    );
  }

  const status = readLikeStatus(statusResult.data);
  if (!status) {
    throw new CommentLikeApiError('The comment like status response was invalid.');
  }

  const nextLiked = !status.liked;
  const method = nextLiked ? 'POST' : 'DELETE';
  const mutationResult = await apiRequest<unknown>(
    '/comments/' + encodedId + '/likes',
    {
      method,
      idempotencyKey: 'native-comment-like:' + commentId + ':' +
        (nextLiked ? 'like' : 'unlike') + ':' + createIdempotencyKey(),
    },
  );

  if (!mutationResult.response.ok && mutationResult.response.status !== 204) {
    throw new CommentLikeApiError(
      mutationResult.error?.message || getApiErrorMessage(
        mutationResult.data,
        nextLiked ? 'Could not like this reply. Please try again.' : 'Could not remove this like. Please try again.',
        mutationResult.response.status,
      ),
      mutationResult.response.status,
      mutationResult.error?.code,
    );
  }

  return { liked: nextLiked };
}
