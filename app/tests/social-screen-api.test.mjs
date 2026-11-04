import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bookmarkScreenSource = readFileSync(resolve(process.cwd(), 'app/(drawer)/bookmarks.tsx'), 'utf8');
const feedItemSource = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
const postDetailSource = readFileSync(new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id].tsx', import.meta.url), 'utf8');
const profileScreenSource = readFileSync(resolve(process.cwd(), 'app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/profile/[id].tsx'), 'utf8');
const rootLayoutSource = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const notificationsScreenSource = readFileSync(new URL('../app/(drawer)/(tabs)/(notifications)/notifications.tsx', import.meta.url), 'utf8');

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
  fetchNotificationsPage,
  fetchNotificationById,
  fetchUserRelationshipsPage,
  fetchUserLikedContentsPage,
  fetchUserRepliesPage,
  fetchUserProfileContentPage,
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
