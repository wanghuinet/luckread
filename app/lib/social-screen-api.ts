import { apiRequest, createIdempotencyKey } from './api-client';

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

/** Fetch one profile's content across existing content types for its native Media tab. */
export function fetchUserProfileContentPage(userIdValue: string, options: PageRequestOptions = {}) {
  const userId = userIdValue.trim();
  if (!userId || userId.length > 128) throw new TypeError('A valid profile user ID is required.');
  const query = new URLSearchParams({
    creatorId: userId,
    limit: String(options.limit ?? 20),
  });
  if (options.cursor) query.set('cursor', options.cursor);
  return apiRequest<unknown>('/contents?' + query.toString(), {
    method: 'GET',
    signal: options.signal,
  });
}

/** Fetch one profile's public replies using the existing W01/W05 read route. */
export function fetchUserRepliesPage(userIdValue: string, options: PageRequestOptions = {}) {
  const userId = userIdValue.trim();
  if (!userId || userId.length > 128) throw new TypeError('A valid profile user ID is required.');
  const query = pageQuery(options.limit, options.cursor);
  return apiRequest<unknown>(
    '/users/' + encodeURIComponent(userId) + '/replies?' + query.toString(),
    { method: 'GET', signal: options.signal },
  );
}

/** Fetch one profile's liked-content references using the existing W01/W05 read route. */
export function fetchUserLikedContentsPage(userIdValue: string, options: PageRequestOptions = {}) {
  const userId = userIdValue.trim();
  if (!userId || userId.length > 128) throw new TypeError('A valid profile user ID is required.');
  const query = pageQuery(options.limit, options.cursor);
  return apiRequest<unknown>(
    '/users/' + encodeURIComponent(userId) + '/likes?' + query.toString(),
    { method: 'GET', signal: options.signal },
  );
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


/** Search public LuckRead content through the canonical W01 -> W04 -> W03 route. */
export function fetchContentSearchPage(queryValue: string, options: PageRequestOptions = {}) {
  const query = queryValue.trim()
  const params = new URLSearchParams({
    q: query,
    limit: String(options.limit ?? 20),
  })
  if (options.cursor) params.set('cursor', options.cursor)
  return apiRequest<unknown>('/search?' + params.toString(), {
    method: 'GET',
    auth: false,
    signal: options.signal,
  })
}


/** Block a target user through the canonical W01 → W05 relationship authority. */
export function blockUser(targetUserId: string) {
  const target = targetUserId.trim();
  if (!target) throw new TypeError('A target user ID is required.');
  return apiRequest<unknown>('/interactions/blocks', {
    method: 'POST',
    body: JSON.stringify({ targetUserId: target }),
    idempotencyKey: 'native-block-user:' + target + ':' + createIdempotencyKey(),
  });
}

/** Remove an existing block through the canonical W01 → W05 relationship authority. */
export function unblockUser(targetUserId: string) {
  const target = targetUserId.trim();
  if (!target) throw new TypeError('A target user ID is required.');
  return apiRequest<unknown>('/interactions/blocks/' + encodeURIComponent(target), {
    method: 'DELETE',
    idempotencyKey: 'native-unblock-user:' + target + ':' + createIdempotencyKey(),
  });
}

/** Mute a target user without treating mute as block. */
export function muteUser(targetUserId: string) {
  const target = targetUserId.trim();
  if (!target) throw new TypeError('A target user ID is required.');
  return apiRequest<unknown>('/interactions/mutes', {
    method: 'POST',
    body: JSON.stringify({ targetUserId: target }),
    idempotencyKey: 'native-mute-user:' + target + ':' + createIdempotencyKey(),
  });
}

/** Remove an existing mute through the canonical W01 → W05 relationship authority. */
export function unmuteUser(targetUserId: string) {
  const target = targetUserId.trim();
  if (!target) throw new TypeError('A target user ID is required.');
  return apiRequest<unknown>('/interactions/mutes/' + encodeURIComponent(target), {
    method: 'DELETE',
    idempotencyKey: 'native-unmute-user:' + target + ':' + createIdempotencyKey(),
  });
}
