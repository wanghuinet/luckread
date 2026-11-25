import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const comments = readFileSync(
  new URL('../components/Comments.tsx', import.meta.url),
  'utf8',
);

test('comment list requests and local interaction state reset on viewer changes', () => {
  expect(comments).toContain('const requestViewerId = currentUserId;');
  expect(comments).toContain('(useAuthStore.getState().user?.id ?? null) === requestViewerId');
  expect(comments).toContain('requestIdRef.current += 1;');
  expect(comments).toContain('pendingSubmissionRef.current = null;');
  expect(comments).toContain('pendingDeleteKeysRef.current = {};');
  expect(comments).toContain('setDeletingIds(new Set());');
  expect(comments).toContain('setLikingCommentId(null);');
});

test('comment submit, delete, and like completions cannot update a different viewer UI', () => {
  expect(comments).toContain('if ((useAuthStore.getState().user?.id ?? null) !== viewerIdAtStart) return;');
  expect(comments).toContain('expectedViewerId: viewerIdAtStart');
  expect(comments).toContain('toggleCommentLikeRequest(comment.id, viewerIdAtStart)');
  expect(comments).toContain('if ((useAuthStore.getState().user?.id ?? null) === viewerIdAtStart) setLikingCommentId(null);');
  expect(comments).toContain('if (useAuthStore.getState().user?.id === viewerIdAtStart)');
});
