import { apiRequest } from './api-client';

export type VideoFeedPageOptions = {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
};

/**
 * Read real video content through W01's existing content-list contract.
 * The screen maps records and resolves media with the shared content/media adapters.
 */
export function fetchVideoFeedPage(options: VideoFeedPageOptions = {}) {
  const requestedLimit = options.limit ?? 12;
  const limit = Number.isSafeInteger(requestedLimit)
    ? Math.min(50, Math.max(1, requestedLimit))
    : 12;
  const query = new URLSearchParams({ type: 'video', limit: String(limit) });
  if (options.cursor?.trim()) query.set('cursor', options.cursor.trim());

  return apiRequest<unknown>('/contents?' + query.toString(), {
    method: 'GET',
    signal: options.signal,
  });
}
