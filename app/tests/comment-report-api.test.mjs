import { readFileSync } from 'node:fs';
import { beforeEach, expect, mock, test } from 'bun:test';

const calls = [];
let respond = async () => ({
  response: { ok: true, status: 201 },
  data: { data: { status: 'SUBMITTED' } },
  error: null,
});

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return respond(path, options);
  },
  getApiErrorMessage: (data, fallback) => data?.error?.message || fallback,
}));

const { COMMENT_REPORT_REASONS, reportComment } =
  await import('../lib/comment-report-api.ts');

beforeEach(() => {
  calls.length = 0;
  respond = async () => ({
    response: { ok: true, status: 201 },
    data: { data: { status: 'SUBMITTED' } },
    error: null,
  });
});

test('submits a comment report through W01 with an idempotency key', async () => {
  await expect(reportComment({
    commentId: 'comment/id',
    reasonCode: 'SPAM',
    description: '  spam link  ',
    idempotencyKey: 'report-comment-test-key',
  })).resolves.toEqual({ status: 'SUBMITTED' });

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/reports');
  expect(calls[0].options.method).toBe('POST');
  expect(calls[0].options.idempotencyKey).toBe('report-comment-test-key');
  expect(JSON.parse(calls[0].options.body)).toEqual({
    targetType: 'comment',
    targetId: 'comment/id',
    reasonCode: 'SPAM',
    description: 'spam link',
  });
});

test('omits an empty description and reports deduplicated responses', async () => {
  respond = async () => ({
    response: { ok: true, status: 200 },
    data: { data: { status: 'DEDUPLICATED' } },
    error: null,
  });

  await expect(reportComment({
    commentId: 'comment-1',
    reasonCode: 'ABUSE',
    description: '   ',
    idempotencyKey: 'same-logical-report',
  })).resolves.toEqual({ status: 'DEDUPLICATED' });

  expect(JSON.parse(calls[0].options.body)).toEqual({
    targetType: 'comment',
    targetId: 'comment-1',
    reasonCode: 'ABUSE',
  });
});

test('rejects unknown report reasons and invalid IDs before requesting the API', async () => {
  await expect(reportComment({
    commentId: 'comment-1',
    reasonCode: 'NOT_A_REASON',
    idempotencyKey: 'key',
  })).rejects.toThrow('Choose a valid report reason.');

  await expect(reportComment({
    commentId: '  ',
    reasonCode: 'SPAM',
    idempotencyKey: 'key',
  })).rejects.toThrow('A valid comment ID is required.');

  expect(calls).toHaveLength(0);
  expect(COMMENT_REPORT_REASONS.map((item) => item.code)).toEqual([
    'ABUSE', 'SPAM', 'IMPERSONATION', 'COPYRIGHT', 'OTHER',
  ]);
});

test('surfaces API failures without claiming the report succeeded', async () => {
  respond = async () => ({
    response: { ok: false, status: 429 },
    data: { error: { code: 'RATE_LIMITED', message: 'Please try again later.' } },
    error: { status: 429, code: 'RATE_LIMITED', message: 'Please try again later.' },
  });

  await expect(reportComment({
    commentId: 'comment-1',
    reasonCode: 'OTHER',
    idempotencyKey: 'retry-key',
  })).rejects.toMatchObject({
    name: 'CommentReportApiError',
    status: 429,
    code: 'RATE_LIMITED',
    message: 'Please try again later.',
  });
});

test('validates report description and idempotency key bounds', async () => {
  await expect(reportComment({
    commentId: 'comment-1',
    reasonCode: 'OTHER',
    description: 'x'.repeat(4001),
    idempotencyKey: 'key',
  })).rejects.toThrow('4,000 characters or fewer.');

  await expect(reportComment({
    commentId: 'comment-1',
    reasonCode: 'OTHER',
    idempotencyKey: '',
  })).rejects.toThrow('A valid idempotency key is required.');

  expect(calls).toHaveLength(0);
});

test('wires the report dialog only for comments authored by another user', () => {
  const comments = readFileSync(new URL('../components/Comments.tsx', import.meta.url), 'utf8');
  const dialog = readFileSync(new URL('../components/ReportCommentDialog.tsx', import.meta.url), 'utf8');
  expect(comments).toContain('comment.authorUserId !== viewer?.id');
  expect(comments).toContain('onPress={() => setReportingCommentId(comment.id)}');
  expect(comments).toContain('<ReportCommentDialog');
  expect(dialog).toContain('reportComment({');
  expect(dialog).toContain("result === 'DEDUPLICATED'");
  expect(dialog).toContain("router.push('/login'");
});
