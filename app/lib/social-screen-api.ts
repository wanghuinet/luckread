import { apiRequest } from './api-client';

export type NotificationScreenFilter = 'all' | 'mentions';
export type UserRelationshipKind = 'followers' | 'following';

type PageRequestOptions = {
  cursor?: string | null;
  signal?: AbortSignal;
  limit?: number | string;
};

function pageQuery(limit: number | string = 20, cursor?: string | null): URLSearchParams {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return query;
}

/** Fetch a page of notifications through the shared API client. */
export function fetchNotificationsPage(options: PageRequestOptions & {
  filter?: NotificationScreenFilter;
} = {}) {
  const query = pageQuery(options.limit, options.cursor);
  if (options.filter === 'mentions') query.set('type', 'MENTION');
  return apiRequest<unknown>('/notifications?' + query.toString(), {
    method: 'GET',
    signal: options.signal,
  });
}

/** Mark one real notification as read. */
export function markNotificationRead(notificationId: string) {
  return apiRequest<unknown>(
    '/notifications/' + encodeURIComponent(notificationId) + '/read',
    { method: 'POST' },
  );
}

/** Mark all of the signed-in user's notifications as read. */
export function markAllNotificationsRead() {
  return apiRequest<unknown>('/notifications/read-all', { method: 'POST' });
}

/** Fetch the signed-in user's real saved content list. */
export function fetchBookmarksPage(options: PageRequestOptions = {}) {
  const query = new URLSearchParams({ list: 'true', limit: String(options.limit ?? 20) });
  if (options.cursor) query.set('cursor', options.cursor);
  return apiRequest<unknown>('/interactions/bookmarks?' + query.toString(), {
    method: 'GET',
    signal: options.signal,
  });
}

/** Fetch real follower or following relationships for the given profile ID. */
export function fetchUserRelationshipsPage(
  ownerId: string,
  relation: UserRelationshipKind,
  options: PageRequestOptions = {},
) {
  const query = pageQuery(options.limit, options.cursor);
  return apiRequest<unknown>(
    '/users/' + encodeURIComponent(ownerId) + '/' + relation + '?' + query.toString(),
    { method: 'GET', signal: options.signal },
  );
}

/** Look up one exact public username using the existing W01 route. */
export function findPublicUserByUsername(username: string, signal?: AbortSignal) {
  const normalizedUsername = username.trim().replace(/^@/, '');
  return apiRequest<unknown>(
    '/users/by-username/' + encodeURIComponent(normalizedUsername),
    { method: 'GET', signal },
  );
}

/** Load public discovery topics through the existing W01 endpoint. */
export function fetchDiscoveryTopics(signal?: AbortSignal) {
  return apiRequest<unknown>('/discovery/topics?limit=20', {
    method: 'GET',
    signal,
  });
}
