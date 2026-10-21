import { apiRequest, createIdempotencyKey, getApiErrorMessage } from './api-client';

export class CommentDeleteApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CommentDeleteApiError';
  }
}

function readErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Delete one comment through W01's existing author-checked W05 route.
 * The caller must keep the idempotency key stable while retrying this same delete.
 */
export async function deleteComment(
  commentId: string,
  idempotencyKey = createIdempotencyKey(),
): Promise<void> {
  const normalizedId = commentId.trim();
  const normalizedKey = idempotencyKey.trim();
  if (!normalizedId) throw new TypeError('Comment ID is required.');
  if (!normalizedKey || normalizedKey.length > 256) {
    throw new TypeError('A valid idempotency key is required.');
  }

  const result = await apiRequest<unknown>(
    '/comments/' + encodeURIComponent(normalizedId),
    {
      method: 'DELETE',
      idempotencyKey: normalizedKey,
    },
  );

  if (!result.response.ok) {
    throw new CommentDeleteApiError(
      result.error?.message || getApiErrorMessage(
        result.data,
        'Could not delete this reply. Please try again.',
        result.response.status,
      ),
      result.response.status,
      result.error?.code || readErrorCode(result.data),
    );
  }
}
