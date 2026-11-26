import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const comments = readFileSync(
  new URL('../components/Comments.tsx', import.meta.url),
  'utf8',
);
const replyComposer = readFileSync(
  new URL('../components/ReplyComposerProvider.tsx', import.meta.url),
  'utf8',
);
const commentCreateApi = readFileSync(new URL('../lib/comment-create-api.ts', import.meta.url), 'utf8');
const commentDeleteApi = readFileSync(new URL('../lib/comment-delete-api.ts', import.meta.url), 'utf8');
const commentEditApi = readFileSync(new URL('../lib/comment-edit-api.ts', import.meta.url), 'utf8');
const commentLikesApi = readFileSync(new URL('../lib/comment-likes-api.ts', import.meta.url), 'utf8');
const commentReportApi = readFileSync(new URL('../lib/comment-report-api.ts', import.meta.url), 'utf8');

test('comment list requests and local interaction state reset on viewer changes', () => {
  expect(comments).toContain('const requestViewerId = currentUserId;');
  expect(comments).toContain('(useAuthStore.getState().user?.id ?? null) === requestViewerId');
  expect(comments).toContain('requestIdRef.current += 1;');
  expect(comments).toContain('pendingSubmissionRef.current = null;');
  expect(comments).toContain('pendingDeleteKeysRef.current = {};');
  expect(comments).toContain('setReportingCommentId(null);');
  expect(comments).toContain('React.useLayoutEffect(() => {');
  expect(comments).toContain('expectedAccountId: requestViewerId ?? undefined');
  expect(comments).toContain("{ method: 'GET', auth: false }");
  expect(comments).toContain('setDeletingIds(new Set());');
  expect(comments).toContain('setLikingCommentId(null);');
  expect(replyComposer).toContain('const viewerScopeRef = useRef<string | null>(currentUserId);');
  expect(replyComposer).toContain('expectedViewerId: viewerIdAtStart');
  expect(replyComposer).toContain('if (useAuthStore.getState().user?.id !== viewerIdAtStart) return;');
});

test('all comment mutations bind API credentials to the captured viewer', () => {
  expect(commentCreateApi).toContain('expectedAccountId: input.expectedViewerId');
  expect(commentDeleteApi).toContain('expectedAccountId: expectedViewerId');
  expect(commentEditApi).toContain('expectedAccountId: expectedViewerId');
  expect(commentLikesApi).toContain('expectedAccountId: expectedViewerId');
  expect(commentReportApi).toContain('expectedAccountId: input.expectedViewerId');
});

test('comment submit, delete, and like completions cannot update a different viewer UI', () => {
  expect(comments).toContain('if ((useAuthStore.getState().user?.id ?? null) !== viewerIdAtStart) return;');
  expect(comments).toContain('expectedViewerId: viewerIdAtStart');
  expect(comments).toContain('toggleCommentLikeRequest(comment.id, viewerIdAtStart)');
  expect(comments).toContain('if ((useAuthStore.getState().user?.id ?? null) === viewerIdAtStart) setLikingCommentId(null);');
  expect(comments).toContain('if (useAuthStore.getState().user?.id === viewerIdAtStart)');
});

test('comment author profile hydration is invalidated on account switch and after async token lookup', () => {
  expect(comments).toContain('const requestViewerId = currentUserId;');
  expect(comments).toContain('const isCurrentHydration = () =>');
  expect(comments).toContain('if (!isCurrentHydration()) return;');
  expect(comments).toContain('Object.keys(next).length > 0 && isCurrentHydration()');
  expect(comments).toContain('if (!isCurrentHydration()) return;');
  expect(comments).toContain('}, [comments, currentUserId]);');
});
