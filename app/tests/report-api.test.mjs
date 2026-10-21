import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const calls = [];
let responseStatus = 201;
let responseData = { data: { status: 'CREATED', reportId: 'report-test' } };

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return {
      response: new Response(null, { status: responseStatus }),
      data: responseData,
      error: responseStatus >= 400 ? { message: 'mock report failure' } : null,
    };
  },
  createIdempotencyKey: () => 'report-idempotency-test',
  getApiErrorMessage: (_data, fallback) => fallback,
}));

const { submitContentReport } = await import('../lib/report-api.ts');

beforeEach(() => {
  calls.length = 0;
  responseStatus = 201;
  responseData = { data: { status: 'CREATED', reportId: 'report-test' } };
});

test('submits a post report through W01 with the validated target and optional description', async () => {
  const result = await submitContentReport('post-123', 'ABUSE', ' Targeted harassment ');
  expect(result).toMatchObject({ ok: true, status: 201, deduplicated: false });
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/reports');
  expect(calls[0].options.method).toBe('POST');
  expect(calls[0].options.idempotencyKey).toBe('native-content-report:post-123:report-idempotency-test');
  expect(JSON.parse(calls[0].options.body)).toEqual({
    targetType: 'content',
    targetId: 'post-123',
    reasonCode: 'ABUSE',
    description: 'Targeted harassment',
  });
});

test('omits blank optional descriptions and recognizes moderation deduplication', async () => {
  responseData = { data: { status: 'DEDUPLICATED', reportId: 'report-existing' } };
  const result = await submitContentReport('post-123', 'SPAM', '  ');
  expect(result).toMatchObject({ ok: true, deduplicated: true });
  expect(JSON.parse(calls[0].options.body)).toEqual({
    targetType: 'content',
    targetId: 'post-123',
    reasonCode: 'SPAM',
  });
});

test('rejects invalid IDs and unsupported reasons before making a request', async () => {
  expect((await submitContentReport('', 'SPAM')).ok).toBe(false);
  expect((await submitContentReport('post-123', 'FAKE_REASON')).ok).toBe(false);
  expect(calls).toHaveLength(0);
});

test('returns the canonical API error without falsely reporting success', async () => {
  responseStatus = 403;
  const result = await submitContentReport('post-123', 'OTHER');
  expect(result).toMatchObject({ ok: false, status: 403, message: 'mock report failure' });
});

test('wires the feed and post-detail report menu entries to the shared dialog', () => {
  const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
  const postDetail = readFileSync(new URL('../app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id].tsx', import.meta.url), 'utf8');
  const dialog = readFileSync(new URL('../components/ReportPostDialog.tsx', import.meta.url), 'utf8');

  expect(feedItem).toContain('key="report" onSelect={() => setReportDialogOpen(true)}');
  expect(feedItem).toContain('<ReportPostDialog');
  expect(postDetail).toContain('key="report" onSelect={() => setReportDialogOpen(true)}');
  expect(postDetail).toContain('<ReportPostDialog');
  expect(postDetail).toContain('contentId={postId}');
  expect(dialog).toContain('Submit report');
  expect(dialog).toContain("submitContentReport(contentId, reasonCode, description)");
  expect(dialog).toContain('Additional details (optional)');
});
