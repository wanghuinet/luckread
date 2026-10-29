import { afterEach, expect, mock, test } from 'bun:test';

let bodyReadCalls = [];
let bodyResponseText = 'Authorized body text';
const originalFetch = globalThis.fetch;

mock.module('../lib/api-client.ts', () => ({
  getApiBaseUrl: () => 'https://api.luckread.com',
  apiRequest: async () => {
    throw new Error('Unexpected JSON API request in body authorization test');
  },
  fetchContentBodyById: async (contentId, options) => {
    bodyReadCalls.push({ contentId, options });
    return new Response(bodyResponseText, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
}));

const { readContentBody } = await import('../lib/content-adapter.ts');

afterEach(() => {
  globalThis.fetch = originalFetch;
  bodyReadCalls = [];
  bodyResponseText = 'Authorized body text';
});

test('never reads body bytes for a denied member-only record, even if body fields are present', async () => {
  bodyReadCalls = [];
  const result = await readContentBody({
    id: 'content_member_1',
    accessMode: 'MEMBERS_ONLY',
    accessGranted: false,
    title: 'Members-only article',
    bodyText: 'private data accidentally included by an upstream projection',
    bodyRef: 'https://img.luckread.com/users/owner/luckread-article-11111111-2222-4333-8444-555555555555.json',
  });

  expect(result).toBe('');
  expect(bodyReadCalls).toEqual([]);
});

test('loads allowed member body by canonical content ID, never by client-provided bodyRef', async () => {
  bodyReadCalls = [];
  const result = await readContentBody({
    id: 'content_member_2',
    accessMode: 'MEMBERS_ONLY',
    accessGranted: true,
    title: 'Members-only article',
    bodyRef: 'https://img.luckread.com/users/owner/luckread-article-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json',
  }, undefined, 'session-secret');

  expect(result).toBe('Authorized body text');
  expect(bodyReadCalls).toHaveLength(1);
  expect(bodyReadCalls[0].contentId).toBe('content_member_2');
  expect(bodyReadCalls[0].options.sessionToken).toBe('session-secret');
});

test('does not use a raw R2 URL when the canonical ID is missing', async () => {
  bodyReadCalls = [];
  const result = await readContentBody({
    id: '',
    accessMode: 'PUBLIC',
    accessGranted: true,
    title: 'Public article',
    bodyRef: 'https://img.luckread.com/users/owner/luckread-article-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json',
  });

  expect(result).toBe('Public article');
  expect(bodyReadCalls).toEqual([]);
});
