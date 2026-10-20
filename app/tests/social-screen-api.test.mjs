import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
mock.module('../lib/api-client.ts', () => ({
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
  fetchUserRelationshipsPage,
  findPublicUserByUsername,
  markAllNotificationsRead,
  markNotificationRead,
} = await import('../lib/social-screen-api.ts');

beforeEach(() => {
  calls.length = 0;
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
