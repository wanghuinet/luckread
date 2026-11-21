import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const comments = readFileSync(new URL('../components/Comments.tsx', import.meta.url), 'utf8');

test('reply actions expose accessible labels, hints, and state', () => {
  expect(comments).toContain('accessibilityLabel={refreshing || loading ? "Refreshing replies" : "Refresh replies"}');
  expect(comments).toContain('accessibilityLabel={submitting ? "Posting comment" : "Post comment"}');
  expect(comments).toContain('accessibilityLabel="Retry loading replies"');
  expect(comments).toContain('accessibilityLabel={`Reply to ${authorName}`}');
  expect(comments).toContain('selected: likedComments[comment.id] === true');
  expect(comments).toContain('accessibilityLabel={loadingMore ? "Loading more replies" : "Load more replies"}');
});
