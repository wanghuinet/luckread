import { apiRequest, getApiErrorMessage } from './api-client';

export class CommentEditApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CommentEditApiError';
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
 * Update one comment through W01's existing PATCH route.
 * If-Match uses the server version so stale edits cannot overwrite newer text.
 */
export async function updateComment(
  commentId: string,
  body: string,
  updatedAt: string,
  idempotencyKey: string,
): Promise<void> {
  const normalizedId = commentId.trim();
  const normalizedBody = body.trim();
  const normalizedVersion = updatedAt.trim();
  const normalizedKey = idempotencyKey.trim();

  if (!normalizedId) throw new TypeError('Comment ID is required.');
  if (!normalizedBody || normalizedBody.length > 10000) {
    throw new TypeError('Comment text must contain 1–10,000 characters.');
  }
  if (!normalizedVersion) {
    throw new TypeError('The current comment version is unavailable. Refresh replies and try again.');
  }
  if (!normalizedKey || normalizedKey.length > 256) {
    throw new TypeError('A valid idempotency key is required.');
  }

  const result = await apiRequest<unknown>(
    '/comments/' + encodeURIComponent(normalizedId),
    {
      method: 'PATCH',
      idempotencyKey: normalizedKey,
      headers: { 'If-Match': '"' + normalizedVersion + '"' },
      body: JSON.stringify({ body: normalizedBody }),
    },
  );

  if (!result.response.ok) {
    throw new CommentEditApiError(
      result.error?.message || getApiErrorMessage(
        result.data,
        'Could not update this comment. Please try again.',
        result.response.status,
      ),
      result.response.status,
      result.error?.code || readErrorCode(result.data),
    );
  }
}
