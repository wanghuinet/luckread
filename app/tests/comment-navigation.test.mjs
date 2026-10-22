import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const actions = read('components/EngagementActions.tsx');
const feedItem = read('components/FeedItem.tsx');
const postDetail = read('app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id].tsx');
const contentAdapter = read('lib/content-adapter.ts');

test('feed comment action has an accessible, enabled press handler and opens the canonical post route', () => {
  expect(actions).toContain('accessibilityLabel="Open comments"');
  expect(actions).toContain('onPress={handleCommentPress}');
  expect(actions).toContain("router.push(('/post/' + encodeURIComponent(itemData.contentId)) as never)");
  expect(actions).toContain('event?.stopPropagation?.()');
});

test('post cards preserve comment navigation and pass detail-screen comment callback through', () => {
  expect(feedItem).toContain('onCommentPress?: () => void');
  expect(feedItem).toContain('onCommentPress={onCommentPress}');
  expect(feedItem).toContain('detailView={Boolean(detailView)}');
});

test('post detail comment action scrolls to the real comments section instead of pushing the same route', () => {
  expect(postDetail).toContain('const handleScrollToComments = useCallback');
  expect(postDetail).toContain('scrollViewRef.current?.scrollTo({ y: commentsOffsetRef.current, animated: true })');
  expect(postDetail).toContain('onCommentPress={handleScrollToComments}');
  expect(postDetail).toContain('commentsOffsetRef.current = event.nativeEvent.layout.y');
});


test('comment author cards use W01 batched author projections and only look up unhydrated authors', () => {
  const comments = read('components/Comments.tsx');
  expect(comments).toContain('author?: PublicUser | null');
  expect(comments).toContain('const embeddedComments = comments.filter(hasEmbeddedProfile)');
  expect(comments).toContain('.filter((comment) => !hasEmbeddedProfile(comment))');
  expect(comments).toContain('profiles[comment.authorUserId] ?? comment.author ?? undefined');
});


test('feed reuses complete author projections instead of issuing per-item profile requests', () => {
  expect(contentAdapter).toContain("['username', 'displayName', 'avatar'].every");
  expect(contentAdapter).toContain("Object.prototype.hasOwnProperty.call(embedded, key)");
});
