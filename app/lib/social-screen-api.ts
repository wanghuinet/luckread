import { apiRequest, createIdempotencyKey } from './api-client';

export type NotificationScreenFilter = 'all' | 'mentions';
export type UserRelationshipKind = 'followers' | 'following';

type PageRequestOptions = {
  cursor?: string | null;
  signal?: AbortSignal;
  limit?: number | string;
  notificationId?: string | null;
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
  if (options.notificationId) query.set('notificationId', options.notificationId);
  return apiRequest<unknown>('/notifications?' + query.toString(), {
    method: 'GET',
    signal: options.signal,
  });
}

/** Fetch one notification by its server-owned ID, scoped to the current account. */
export function fetchNotificationById(notificationIdValue: string, signal?: AbortSignal) {
  const notificationId = notificationIdValue.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(notificationId)) {
    throw new TypeError('A valid notification ID is required.');
  }
  return fetchNotificationsPage({ limit: 1, notificationId, signal });
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


export type NativePostDraft = {
  id: string;
  contentType: 'post';
  state: 'DRAFT';
  version: number;
  revision: number;
  etag: string;
  title: string;
  accessMode: 'PUBLIC' | 'MEMBERS_ONLY';
  bodyRef: string;
  mediaRefs: string[];
  coverRef: string | null;
  updatedAt: string;
};

export type NativePostDraftPage = {
  items: NativePostDraft[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** List only the signed-in owner's social post drafts; W01 routes status=DRAFT through W03 owner scoping. */
export function fetchOwnPostDraftsPage(options: PageRequestOptions = {}) {
  const query = new URLSearchParams({ status: 'DRAFT', type: 'post', limit: String(options.limit ?? 20) });
  if (options.cursor) query.set('cursor', options.cursor);
  return apiRequest<{ data?: NativePostDraftPage; error?: { code?: string; message?: string } }>(
    '/contents?' + query.toString(),
    { method: 'GET', signal: options.signal },
  );
}

export type NativeScheduledPost = {
  id: string;
  contentType: 'post';
  state: 'SCHEDULED';
  version: number;
  revision: number;
  etag: string;
  title: string;
  accessMode: 'PUBLIC' | 'MEMBERS_ONLY';
  bodyRef: string;
  mediaRefs: string[];
  coverRef: string | null;
  scheduledAt: string;
  updatedAt: string;
};

export type NativeScheduledPostPage = {
  items: NativeScheduledPost[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** List only the signed-in Creator's scheduled social posts; W03 enforces L3/L4 and owner scope. */
export function fetchOwnScheduledPostsPage(options: PageRequestOptions = {}) {
  const query = new URLSearchParams({ status: 'SCHEDULED', type: 'post', limit: String(options.limit ?? 20) });
  if (options.cursor) query.set('cursor', options.cursor);
  return apiRequest<{ data?: NativeScheduledPostPage; error?: { code?: string; message?: string } }>(
    '/contents?' + query.toString(),
    { method: 'GET', signal: options.signal },
  );
}

/**
 * Reuse the existing W01/W03 lifecycle state operation. Rescheduling is modeled
 * as SCHEDULED -> DRAFT -> SCHEDULED, so every write has its own fresh ETag and
 * W08 Creator re-check instead of introducing a second scheduled-time mutation API.
 */
export function transitionOwnScheduledPostState(
  item: NativeScheduledPost,
  to: 'DRAFT' | 'SCHEDULED',
  scheduledAt?: string,
) {
  const contentId = item.id.trim();
  const etag = item.etag.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contentId)) {
    throw new TypeError('A valid scheduled post ID is required.');
  }
  if (!etag || etag === '*' || etag.length > 256) {
    throw new TypeError('A current scheduled post version is required.');
  }

  let body: Record<string, unknown> = { to: 'DRAFT' };
  if (to === 'SCHEDULED') {
    const timestamp = typeof scheduledAt === 'string' ? Date.parse(scheduledAt) : Number.NaN;
    if (!Number.isFinite(timestamp) || timestamp <= Date.now() + 60_000) {
      throw new TypeError('A future scheduled publish time is required.');
    }
    if (!item.title.trim() || !item.bodyRef || !Array.isArray(item.mediaRefs)) {
      throw new TypeError('The scheduled post is missing its publish metadata.');
    }
    body = {
      to: 'SCHEDULED',
      scheduledAt: new Date(timestamp).toISOString(),
      preflight: {
        contentType: 'post',
        title: item.title,
        body: item.title,
        mediaRefs: item.mediaRefs,
        coverRef: item.coverRef,
      },
    };
  }

  return apiRequest<unknown>('/contents/' + encodeURIComponent(contentId) + '/state', {
    method: 'POST',
    headers: { 'If-Match': etag },
    body: JSON.stringify(body),
    idempotencyKey: 'native-scheduled-post-' + to.toLowerCase() + ':' + contentId + ':' + createIdempotencyKey(),
  });
}

/** Soft-delete an owner draft with the current W03 ETag and a unique operation key. */
export function deleteOwnPostDraft(contentIdValue: string, etagValue: string) {
  const contentId = contentIdValue.trim();
  const etag = etagValue.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(contentId)) {
    throw new TypeError('A valid draft ID is required.');
  }
  if (!etag || etag === '*' || etag.length > 256) {
    throw new TypeError('A current draft version is required.');
  }
  return apiRequest<unknown>('/contents/' + encodeURIComponent(contentId), {
    method: 'DELETE',
    headers: { 'If-Match': etag },
    idempotencyKey: 'native-draft-delete:' + contentId + ':' + createIdempotencyKey(),
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
