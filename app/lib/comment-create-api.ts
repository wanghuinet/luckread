import { apiRequest, createIdempotencyKey, type ApiResult } from './api-client';

export type CreateCommentInput = {
  contentId: string;
  body: string;
  parentId?: string | null;
  idempotencyKey?: string;
};

/** Create a top-level comment or nested reply through W01's existing W05-owned route. */
export async function createComment<T = unknown>(
  input: CreateCommentInput,
): Promise<ApiResult<T>> {
  const contentId = input.contentId.trim();
  const body = input.body.trim();
  const parentId = input.parentId?.trim() || null;
  const idempotencyKey = input.idempotencyKey === undefined
    ? createIdempotencyKey()
    : input.idempotencyKey.trim();

  if (!contentId) throw new TypeError('Content ID is required.');
  if (!body || body.length > 10000) {
    throw new TypeError('Comment text must contain 1 to 10000 characters.');
  }
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw new TypeError('A valid idempotency key is required.');
  }

  return apiRequest<T>(
    '/contents/' + encodeURIComponent(contentId) + '/comments',
    {
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify({ body, parentId }),
    },
  );
}
