import { apiRequest } from './api-client';

export type ManagedRelationshipKind = 'blocks' | 'mutes';

export type ManagedRelationshipPageRequest = {
  cursor?: string | null;
  signal?: AbortSignal;
  limit?: number;
};

/** Read the signed-in user's authoritative W05 block or mute list through W01. */
export function fetchManagedRelationshipsPage(
  kind: ManagedRelationshipKind,
  options: ManagedRelationshipPageRequest = {},
) {
  if (kind !== 'blocks' && kind !== 'mutes') {
    throw new TypeError('A valid relationship list type is required.');
  }
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new TypeError('Relationship list limit must be between 1 and 50.');
  }

  const params = new URLSearchParams({ limit: String(limit) });
  const cursor = options.cursor?.trim();
  if (cursor) {
    if (cursor.length > 2048) throw new TypeError('Relationship list cursor is too long.');
    params.set('cursor', cursor);
  }

  return apiRequest<unknown>(
    '/interactions/' + kind + '?' + params.toString(),
    { method: 'GET', signal: options.signal },
  );
}
