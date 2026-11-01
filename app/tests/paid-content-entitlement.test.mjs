import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const bodyFetches = [];

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async () => {
    throw new Error('Unexpected API request in paid-content entitlement test');
  },
  getApiBaseUrl: () => 'https://api.luckread.com',
  fetchContentBodyReference: async (url, options) => {
    bodyFetches.push({ url, options });
    return new Response('server-authorized member body', { status: 200 });
  },
}));

const { mapContentToFeedContent, readContentBody } = await import('../lib/content-adapter.ts');

beforeEach(() => {
  bodyFetches.length = 0;
});

test('does not read inline or referenced member-only body when W03 denies access', async () => {
  const item = {
    id: 'content_member_denied',
    title: 'Members-only title',
    excerpt: 'Public preview',
    accessMode: 'MEMBERS_ONLY',
    accessGranted: false,
    body: 'private inline body',
    bodyText: 'private bodyText',
    text: 'private text',
    bodyRef: 'https://img.luckread.com/private/member-body.json',
    coverRef: 'https://img.luckread.com/private/member-cover.webp',
    mediaRefs: ['https://img.luckread.com/private/member-video.mp4'],
  };

  const body = await readContentBody(item, undefined, 'session-secret');
  const mapped = mapContentToFeedContent(item, body);

  expect(body).toBe('Public preview');
  expect(bodyFetches).toHaveLength(0);
  expect(mapped.message).toBe('Members-only title\n\nPublic preview');
  expect(mapped.accessMode).toBe('MEMBERS_ONLY');
  expect(mapped.accessGranted).toBe(false);
  expect(mapped.media_items).toEqual([]);
  expect(mapped.media_url).toBeUndefined();
});

test('fails closed when a member-only record has no explicit W03 access decision', async () => {
  const item = {
    id: 'content_member_unknown',
    title: 'Locked preview title',
    accessMode: 'MEMBERS_ONLY',
    bodyText: 'private inline body',
    bodyRef: 'https://img.luckread.com/private/unknown-access.json',
  };

  const body = await readContentBody(item);
  const mapped = mapContentToFeedContent(item, body);

  expect(body).toBe('Locked preview title');
  expect(bodyFetches).toHaveLength(0);
  expect(mapped.accessGranted).toBe(false);
  expect(mapped.message).toBe('Locked preview title');
  expect(mapped.media_items).toEqual([]);
});

test('reads the member-only body reference only after W03 explicitly grants access', async () => {
  const item = {
    id: 'content_member_allowed',
    title: 'Members-only title',
    accessMode: 'MEMBERS_ONLY',
    accessGranted: true,
    bodyRef: 'https://img.luckread.com/private/authorized-member-body.json',
  };

  const body = await readContentBody(item, undefined, 'session-secret');

  expect(body).toBe('server-authorized member body');
  expect(bodyFetches).toHaveLength(1);
  expect(bodyFetches[0]?.url).toBe(item.bodyRef);
  expect(bodyFetches[0]?.options.sessionToken).toBe('session-secret');
});

test('connects the paywall detail CTA to creator plans and returns through W03 entitlement refresh', () => {
  const detail = readFileSync(
    new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id].tsx', import.meta.url),
    'utf8',
  );
  const plans = readFileSync(new URL('../app/(drawer)/membership-plans.tsx', import.meta.url), 'utf8');
  const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');

  expect(detail).toContain("hydratedRecord.accessMode === 'MEMBERS_ONLY'");
  expect(detail).toContain('hydratedRecord.accessGranted !== true');
  expect(detail).toContain('hasMembershipCreator');
  expect(detail).toContain('creatorId,');
  expect(detail).toContain("returnTo: '/post/' + postId");
  expect(detail).toContain('查看创作者会员方案');
  expect(detail).toContain('membershipRequired ? undefined : handleScrollToComments');

  expect(plans).toContain('useLocalSearchParams');
  expect(plans).toContain('creatorId,');
  expect(plans).toContain('router.replace(returnTo as never)');
  expect(plans).toContain('返回内容并重新检查权益');

  expect(feedItem).toContain("itemData.accessMode === 'MEMBERS_ONLY'");
  expect(feedItem).toContain('会员专享');
});
