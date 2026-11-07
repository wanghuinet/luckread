import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bookmarkScreenSource = readFileSync(resolve(process.cwd(), 'app/(drawer)/bookmarks.tsx'), 'utf8');
const feedItemSource = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
const postDetailSource = readFileSync(new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id].tsx', import.meta.url), 'utf8');
const profileScreenSource = readFileSync(resolve(process.cwd(), 'app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/[id].tsx'), 'utf8');
const rootLayoutSource = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const notificationsScreenSource = readFileSync(new URL('../app/(drawer)/(tabs)/(notifications)/notifications.tsx', import.meta.url), 'utf8');
const searchScreenSource = readFileSync(new URL('../app/(drawer)/(tabs)/(search)/search.tsx', import.meta.url), 'utf8');

const calls = [];
let keyCounter = 0;
mock.module('../lib/api-client.ts', () => ({
  createIdempotencyKey: () => 'test-key-' + ++keyCounter,
  apiRequest: async (path, options) => {
    const call = { path, options };
    calls.push(call);
    return { response: { ok: true, status: 200 }, data: { data: { items: [] } }, error: null };
  },
}));

const {
  fetchBookmarksPage,
  fetchDiscoveryTopics,
  fetchOwnPostDraftsPage,
  fetchOwnPostReplyAudience,
  saveOwnPostReplyAudience,
  fetchOwnScheduledPostsPage,
  transitionOwnScheduledPostState,
  deleteOwnPostDraft,
  fetchNotificationsPage,
  fetchNotificationById,
  fetchUserRelationshipsPage,
  fetchUserLikedContentsPage,
  fetchUserRepliesPage,
  fetchUserProfileContentPage,
  fetchContentSearchPage,
  findPublicUserByUsername,
  markAllNotificationsRead,
  markNotificationRead,
  blockUser,
  unblockUser,
  muteUser,
  unmuteUser,
} = await import('../lib/social-screen-api.ts');

beforeEach(() => {
  calls.length = 0;
  keyCounter = 0;
});

test('notification inbox data, actor cache, and pending reads are isolated when the authenticated account changes', () => {
  expect(notificationsScreenSource).toContain("const viewerId = useAuthStore((state) => state.user?.id ?? null);");
  expect(notificationsScreenSource).toContain('const currentItems = isCurrentViewerData ? items : EMPTY_NOTIFICATIONS;');
  expect(notificationsScreenSource).toContain('const currentActorProfiles = isCurrentViewerData ? actorProfiles : EMPTY_PUBLIC_PROFILES;');
  expect(notificationsScreenSource).toContain('useLayoutEffect(() => {\n    viewerIdRef.current = viewerId;\n  }, [viewerId]);');
  expect(notificationsScreenSource).toContain('previousViewerIdRef.current = viewerId;');
  expect(notificationsScreenSource).toContain('requestedActorsRef.current.clear();');
  expect(notificationsScreenSource).toContain('handledDeepLinkIdRef.current = null;');
  expect(notificationsScreenSource).toContain('setItems([]);');
  expect(notificationsScreenSource).toContain('setActorProfiles({});');
  expect(notificationsScreenSource).toContain('viewerIdRef.current !== requestViewerId');
  expect(notificationsScreenSource).toContain('if (viewerIdRef.current !== requestViewerId) return;');
  expect(notificationsScreenSource).toContain('}, [authStatus, filter, loadActorProfiles, viewerId]);');
  expect(notificationsScreenSource).toContain('}, [authStatus, viewerId]);');
  expect(notificationsScreenSource).toContain('if (!viewerId || viewerIdRef.current !== viewerId) return;');
  expect(notificationsScreenSource).toContain('const currentHasMore = isCurrentViewerData && hasMore;');
  expect(notificationsScreenSource).toContain('const currentReadAllBusy = isCurrentViewerData && readAllBusy;');
});


test('search screens cancel stale requests and ignore out-of-order responses', () => {
  expect(searchScreenSource).toContain('const contentRequestIdRef = useRef(0);');
  expect(searchScreenSource).toContain('const userRequestIdRef = useRef(0);');
  expect(searchScreenSource).toContain('const topicsRequestIdRef = useRef(0);');
  expect(searchScreenSource).toContain('contentAbortRef.current?.abort();');
  expect(searchScreenSource).toContain('userAbortRef.current?.abort();');
  expect(searchScreenSource).toContain('topicsAbortRef.current?.abort();');
  expect(searchScreenSource).toContain('signal: controller.signal,');
  expect(searchScreenSource).toContain('findPublicUserByUsername(username, controller.signal)');
  expect(searchScreenSource).toContain('fetchDiscoveryTopics(controller.signal)');
  expect(searchScreenSource).toContain('if (!isCurrent()) return;');
  expect(searchScreenSource).toContain('contentRequestIdRef.current += 1;');
  expect(searchScreenSource).toContain('userRequestIdRef.current += 1;');
  expect(searchScreenSource).toContain('topicsRequestIdRef.current += 1;');
});

test('loads the first notification page through the shared client', async () => {
  await fetchNotificationsPage();

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/notifications?limit=20');
  expect(calls[0].options.method).toBe('GET');
});

test('uses the existing mention filter and cursor for notification pagination', async () => {
  const controller = new AbortController();
  await fetchNotificationsPage({
    cursor: 'next page/2',
    filter: 'mentions',
    signal: controller.signal,
  });

  expect(calls[0].path).toBe('/notifications?limit=20&cursor=next+page%2F2&type=MENTION');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('loads one exact notification through the existing recipient-scoped notifications query', async () => {
  const controller = new AbortController();
  await fetchNotificationById('notification_123', controller.signal);

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/notifications?limit=1&notificationId=notification_123');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('rejects malformed notification IDs before making an API request', () => {
  expect(() => fetchNotificationById('../someone-elses-notification')).toThrow('A valid notification ID is required.');
  expect(calls).toHaveLength(0);
});

test('notification taps resolve by server-owned notification ID and never trust payload target URLs', () => {
  expect(rootLayoutSource).toContain('payload?.notificationId');
  expect(rootLayoutSource).toContain("pathname: '/notifications', params: { notificationId }");
  expect(rootLayoutSource).not.toContain('payload?.url');
  expect(notificationsScreenSource).toContain('fetchNotificationById(notificationId, controller.signal)');
  expect(notificationsScreenSource).toContain('candidate.id === notificationId');
  expect(notificationsScreenSource).toContain('const actorRoute = actor?.username || actor?.id || item.actorUserId');
});

test('retries the exact deep-linked notification lookup after a transient fetch failure', () => {
  expect(notificationsScreenSource).toContain('handledDeepLinkIdRef.current = null;');
  expect(notificationsScreenSource).toContain('setDeepLinkRetryNonce((current) => current + 1)');
  expect(notificationsScreenSource).toContain('deepLinkRetryNonce');
  expect(notificationsScreenSource).toContain('const retryNotificationLoad = useCallback(() => {');
  expect(notificationsScreenSource).toContain('onPress={retryNotificationLoad}');
});

test('marks an individual notification as read with an encoded ID', async () => {
  await markNotificationRead('notification/with space');

  expect(calls[0].path).toBe('/notifications/notification%2Fwith%20space/read');
  expect(calls[0].options.method).toBe('POST');
});

test('marks all notifications as read using the existing endpoint', async () => {
  await markAllNotificationsRead();

  expect(calls[0]).toEqual({
    path: '/notifications/read-all',
    options: { method: 'POST' },
  });
});

test('loads the real bookmark list with cursor pagination', async () => {
  await fetchBookmarksPage({ cursor: 'bookmark cursor/1' });

  expect(calls[0].path).toBe('/interactions/bookmarks?list=true&limit=20&cursor=bookmark+cursor%2F1');
  expect(calls[0].options.method).toBe('GET');
});

test('loads all content types for the native profile Media tab with creator filtering and pagination', async () => {
  const controller = new AbortController();
  await fetchUserProfileContentPage('profile/id', { cursor: 'media-next', limit: 15, signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents?creatorId=profile%2Fid&limit=15&cursor=media-next');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('rejects a missing profile ID before requesting profile media', () => {
  expect(() => fetchUserProfileContentPage('   ')).toThrow('A valid profile user ID is required.');
  expect(calls).toHaveLength(0);
});

test('loads a real profile Replies page with cursor pagination through the existing route', async () => {
  const controller = new AbortController();
  await fetchUserRepliesPage('profile/id', { cursor: 'reply-next', signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/users/profile%2Fid/replies?limit=20&cursor=reply-next');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('rejects a missing profile ID before requesting its Replies page', () => {
  expect(() => fetchUserRepliesPage('   ')).toThrow('A valid profile user ID is required.');
  expect(calls).toHaveLength(0);
});

test('loads a real profile Likes page with cursor pagination through the existing route', async () => {
  const controller = new AbortController();
  await fetchUserLikedContentsPage('profile/id', { cursor: 'liked-next', signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/users/profile%2Fid/likes?limit=20&cursor=liked-next');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('rejects a missing profile ID before requesting its Likes page', () => {
  expect(() => fetchUserLikedContentsPage('   ')).toThrow('A valid profile user ID is required.');
  expect(calls).toHaveLength(0);
});

test('uses canonical identity IDs for native profile content, ownership checks, and self detection', () => {
  expect(profileScreenSource).toContain('identityId?: string | null; username?: string;');
  expect(profileScreenSource).toContain('const canonicalProfileId = typeof profile.identityId === \'string\' && profile.identityId.trim()');
  expect(profileScreenSource).toContain('new URLSearchParams({ creatorId: canonicalProfileId, type: \'post\', limit: \'20\' })');
  expect(profileScreenSource).toContain("'/users/' + encodeURIComponent(canonicalProfileId) + '/pinned-content'");
  expect(profileScreenSource).toContain('pinnedRecord.ownerUserId === canonicalProfileId');
  expect(profileScreenSource).toContain('pinnedRecord.creatorId === canonicalProfileId');
  expect(profileScreenSource).toContain("'/users/' + encodeURIComponent(canonicalProfileId) + '/followers?limit=1'");
  expect(profileScreenSource).toContain("'/users/' + encodeURIComponent(canonicalProfileId) + '/following?limit=1'");
  expect(profileScreenSource).toContain('id: canonicalProfileId,');
  expect(profileScreenSource).not.toContain("new URLSearchParams({ creatorId: profile.id, type: 'post', limit: '20' })");
  expect(profileScreenSource).not.toContain('pinnedRecord.ownerUserId === profile.id');
});

test('post detail content and member entitlement are isolated by authenticated viewer', () => {
  expect(postDetailSource).toContain("const viewerId = useAuthStore((state) => state.user?.id ?? null);");
  expect(postDetailSource).toContain('const viewerIdRef = useRef<string | null>(viewerId);');
  expect(postDetailSource).toContain('const hasCurrentViewerData = dataViewerId === viewerId;');
  expect(postDetailSource).toContain('viewerIdRef.current = viewerId;');
  expect(postDetailSource).toContain('viewerIdRef.current === requestViewerId');
  expect(postDetailSource).toContain('setDataViewerId(requestViewerId);');
  expect(postDetailSource).toContain('if (!hasCurrentViewerData || loading)');
  expect(postDetailSource).toContain('controller.abort();');
  expect(postDetailSource).toContain('}, [postId, retryKey, viewerId]);');
});

test('wires public profile Replies and Media plus own-profile Likes to real channel endpoints', () => {
  expect(profileScreenSource).toContain("const profileTabs = isOwnProfile\n    ? ['Posts', 'Replies', 'Media', 'Likes']\n    : ['Posts', 'Replies', 'Media'];");
  expect(profileScreenSource).toContain("title: showingReplies ? 'Replies' : showingMedia ? 'Media' : showingLikes ? 'Likes' : 'Feed'");
  expect(profileScreenSource).toContain('fetchUserRepliesPage(');
  expect(profileScreenSource).toContain("'/contents/' + encodeURIComponent(contentId)");
  expect(profileScreenSource).toContain('profileReply: {');
  expect(profileScreenSource).toContain('Replying to @');
  expect(profileScreenSource).toContain('Load more replies');
  expect(profileScreenSource).toContain('fetchUserProfileContentPage(');
  expect(profileScreenSource).toContain('Load more media');
  expect(profileScreenSource).toContain('mapped.media_items?.length');
  expect(profileScreenSource).toContain('fetchUserLikedContentsPage(');
  expect(profileScreenSource).toContain("'/contents/' + encodeURIComponent(likedItem.contentId)");
  expect(profileScreenSource).toContain('Load more liked posts');
});

test('loads follower and following lists with encoded profile IDs', async () => {
  await fetchUserRelationshipsPage('profile/id', 'followers', { cursor: 'follower-next' });
  await fetchUserRelationshipsPage('profile/id', 'following');

  expect(calls[0].path).toBe('/users/profile%2Fid/followers?limit=20&cursor=follower-next');
  expect(calls[1].path).toBe('/users/profile%2Fid/following?limit=20');
  expect(calls.every((call) => call.options.method === 'GET')).toBe(true);
});

test('normalizes @-prefixed usernames and encodes exact username lookup', async () => {
  await findPublicUserByUsername('  @Alice Smith  ');

  expect(calls[0].path).toBe('/users/by-username/Alice%20Smith');
  expect(calls[0].options.method).toBe('GET');
});

test('supports abortable content search with cursor pagination', async () => {
  const controller = new AbortController();
  await fetchContentSearchPage('  reading query  ', {
    cursor: 'search-next',
    limit: 12,
    signal: controller.signal,
  });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/search?q=reading+query&limit=12&cursor=search-next');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.auth).toBe(false);
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('loads recent public discovery topics with the existing limit', async () => {
  const controller = new AbortController();
  await fetchDiscoveryTopics(controller.signal);

  expect(calls[0].path).toBe('/discovery/topics?limit=20');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});


test('saved list removes an item only after shared bookmark status confirms it is no longer saved', () => {
  expect(bookmarkScreenSource).toContain("import { useContentBookmark } from '~/lib/content-bookmark-state';");
  expect(bookmarkScreenSource).toContain('function BookmarkFeedRow(');
  expect(bookmarkScreenSource).toContain('if (!contentId || !bookmark.loaded || bookmark.loading || bookmark.pending || bookmark.bookmarked) return;');
  expect(bookmarkScreenSource).toContain('onRemoved(contentId);');
  expect(bookmarkScreenSource).toContain('onRemoved={removeUnbookmarkedItem}');
});


test('block and mute actions use authenticated canonical endpoints and supported target IDs', async () => {
  await blockUser(' user-id_123 ');
  await muteUser(' user-id_123 ');
  await unblockUser('user-id_123');
  await unmuteUser('user-id_123');

  expect(calls).toHaveLength(4);
  expect(calls[0].path).toBe('/interactions/blocks');
  expect(calls[0].options.method).toBe('POST');
  expect(JSON.parse(calls[0].options.body)).toEqual({ targetUserId: 'user-id_123' });
  expect(calls[0].options.idempotencyKey).toMatch(/^native-block-user:user-id_123:/);
  expect(calls[1].path).toBe('/interactions/mutes');
  expect(calls[1].options.method).toBe('POST');
  expect(JSON.parse(calls[1].options.body)).toEqual({ targetUserId: 'user-id_123' });
  expect(calls[1].options.idempotencyKey).toMatch(/^native-mute-user:user-id_123:/);
  expect(calls[2].path).toBe('/interactions/blocks/user-id_123');
  expect(calls[2].options.method).toBe('DELETE');
  expect(calls[3].path).toBe('/interactions/mutes/user-id_123');
  expect(calls[3].options.method).toBe('DELETE');
});

test('block and mute menu items invoke real actions in feed and post detail', () => {
  expect(feedItemSource).toContain("id: 'mute'");
  expect(feedItemSource).toContain("id: 'block'");
  expect(feedItemSource).toContain("case 'mute': muteAuthor(); break;");
  expect(feedItemSource).toContain("case 'block': confirmBlockAuthor(); break;");
  expect(feedItemSource).toContain("itemData.creatorId || itemData.ownerUserId || ''");
  expect(postDetailSource).toContain("id: 'mute'");
  expect(postDetailSource).toContain("id: 'block'");
  expect(postDetailSource).toContain("case 'mute': muteTarget(); break;");
  expect(postDetailSource).toContain("case 'block': confirmBlockTarget(); break;");
  expect(postDetailSource).toContain('targetUserId === currentUserId');
  expect(postDetailSource).toContain('attributes: { disabled: !targetUserId || isOwnTarget');
  expect(feedItemSource).toContain('itemData.ownerUserId === currentUser.id || itemData.creatorId === currentUser.id');
});

test('block and mute mutations reject missing target identities before sending requests', async () => {
  expect(() => blockUser('   ')).toThrow('A target user ID is required.');
  expect(() => muteUser('   ')).toThrow('A target user ID is required.');
  expect(() => unblockUser('')).toThrow('A target user ID is required.');
  expect(() => unmuteUser('')).toThrow('A target user ID is required.');
  expect(calls).toHaveLength(0);
});

const feedQuerySource = readFileSync(new URL('../lib/feed-query.ts', import.meta.url), 'utf8');

test('keeps the public For You feed independent of stale native session credentials', () => {
  // The endpoint and authentication policy now live in the dedicated query fetcher.
  expect(feedQuerySource).toContain("const endpoint = input.kind === 'following' ? '/feed/following' : '/contents';");
  expect(feedQuerySource).toContain("auth: input.kind === 'following',");
  expect(feedQuerySource).toContain("if (input.kind === 'for-you') params.set('type', 'post');");
  expect(feedQuerySource).toContain("if (response.status === 401 && input.kind === 'following')");
});

test('lists only the authenticated account draft posts through W01 with cursor pagination', async () => {
  const controller = new AbortController();
  await fetchOwnPostDraftsPage({ cursor: 'draft-next', limit: 15, signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents?status=DRAFT&type=post&limit=15&cursor=draft-next');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('lists only the authenticated Creator\'s scheduled social posts with cursor pagination', async () => {
  const controller = new AbortController();
  await fetchOwnScheduledPostsPage({ cursor: 'scheduled-next', limit: 15, signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents?status=SCHEDULED&type=post&limit=15&cursor=scheduled-next');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('cancels an owned scheduled post through the existing ETag-guarded state operation', async () => {
  const item = {
    id: 'scheduled_123', contentType: 'post', state: 'SCHEDULED', version: 4,
    revision: 2, etag: 'W/"4"', title: 'Queued post', accessMode: 'PUBLIC',
    bodyRef: 'https://img.luckread.com/body.txt', mediaRefs: ['https://img.luckread.com/photo.jpg'],
    coverRef: 'https://img.luckread.com/photo.jpg', scheduledAt: '2026-11-08T18:30:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
  };
  await transitionOwnScheduledPostState(item, 'DRAFT');

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents/scheduled_123/state');
  expect(calls[0].options.method).toBe('POST');
  expect(calls[0].options.headers).toEqual({ 'If-Match': 'W/"4"' });
  expect(JSON.parse(calls[0].options.body)).toEqual({ to: 'DRAFT' });
  expect(calls[0].options.idempotencyKey).toMatch(/^native-scheduled-post-draft:scheduled_123:/);
});

test('reschedules through the existing draft-to-scheduled transition with stored-post preflight', async () => {
  const item = {
    id: 'scheduled_123', contentType: 'post', state: 'SCHEDULED', version: 4,
    revision: 2, etag: 'W/"4"', title: 'Queued post', accessMode: 'PUBLIC',
    bodyRef: 'https://img.luckread.com/body.txt', mediaRefs: ['https://img.luckread.com/photo.jpg'],
    coverRef: 'https://img.luckread.com/photo.jpg', scheduledAt: '2026-11-08T18:30:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
  };
  const nextDate = new Date(Date.now() + 5 * 60_000).toISOString();
  await transitionOwnScheduledPostState(item, 'SCHEDULED', nextDate);

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents/scheduled_123/state');
  expect(calls[0].options.method).toBe('POST');
  expect(calls[0].options.headers).toEqual({ 'If-Match': 'W/"4"' });
  expect(JSON.parse(calls[0].options.body)).toMatchObject({
    to: 'SCHEDULED',
    scheduledAt: nextDate,
    preflight: {
      contentType: 'post',
      title: 'Queued post',
      body: 'Queued post',
      mediaRefs: ['https://img.luckread.com/photo.jpg'],
      coverRef: 'https://img.luckread.com/photo.jpg',
    },
  });
  expect(calls[0].options.idempotencyKey).toMatch(/^native-scheduled-post-scheduled:scheduled_123:/);
});

test('rejects malformed scheduled-post IDs, stale ETags and non-future reschedule times', () => {
  const item = {
    id: '../other-user', contentType: 'post', state: 'SCHEDULED', version: 4,
    revision: 2, etag: 'W/"4"', title: 'Queued post', accessMode: 'PUBLIC',
    bodyRef: 'https://img.luckread.com/body.txt', mediaRefs: [], coverRef: null,
    scheduledAt: '2026-11-08T18:30:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z',
  };
  expect(() => transitionOwnScheduledPostState(item, 'DRAFT')).toThrow('A valid scheduled post ID is required.');
  expect(() => transitionOwnScheduledPostState({ ...item, id: 'scheduled_123', etag: '*' }, 'DRAFT'))
    .toThrow('A current scheduled post version is required.');
  expect(() => transitionOwnScheduledPostState({ ...item, id: 'scheduled_123' }, 'SCHEDULED', new Date(Date.now() + 30_000).toISOString()))
    .toThrow('A future scheduled publish time is required.');
  expect(calls).toHaveLength(0);
});

test('rejects invalid draft delete preconditions before calling the API', () => {
  expect(() => deleteOwnPostDraft('../other-user-draft', 'W/"1"')).toThrow('A valid draft ID is required.');
  expect(() => deleteOwnPostDraft('draft_123', '*')).toThrow('A current draft version is required.');
  expect(calls).toHaveLength(0);
});

test('deletes a selected own draft with the W03 ETag and unique idempotency key', async () => {
  await deleteOwnPostDraft('draft_123', 'W/"4"');
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents/draft_123');
  expect(calls[0].options.method).toBe('DELETE');
  expect(calls[0].options.headers).toEqual({ 'If-Match': 'W/"4"' });
  expect(calls[0].options.idempotencyKey).toBe('native-draft-delete:draft_123:test-key-1');
});


test('reads the signed-in owner post reply policy through the existing W01 route', async () => {
  const controller = new AbortController();
  await fetchOwnPostReplyAudience('post_123', controller.signal);

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents/post_123/reply-audience');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('saves reply audience with post text so W01 resolves mention identities server-side', async () => {
  await saveOwnPostReplyAudience('post_123', 'mentioned', 'Hello @alice');

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/contents/post_123/reply-audience');
  expect(calls[0].options.method).toBe('PUT');
  expect(JSON.parse(calls[0].options.body)).toEqual({
    replyAudience: 'mentioned',
    text: 'Hello @alice',
  });
  expect(calls[0].options.idempotencyKey).toMatch(/^native-reply-audience:post_123:/);
});

test('rejects invalid post IDs, reply audiences and oversized text before calling the API', () => {
  expect(() => fetchOwnPostReplyAudience('../other')).toThrow('A valid post ID is required to read reply permissions.');
  expect(() => saveOwnPostReplyAudience('post_123', 'everyone; DROP TABLE', 'hello')).toThrow('A supported reply permission is required.');
  expect(() => saveOwnPostReplyAudience('post_123', 'everyone', 'x'.repeat(10_001))).toThrow('Post text is invalid for reply permission resolution.');
  expect(calls).toHaveLength(0);
});
