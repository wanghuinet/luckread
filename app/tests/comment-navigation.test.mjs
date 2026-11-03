import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

const actions = read('components/EngagementActions.tsx');
const feedItem = read('components/FeedItem.tsx');
const postDetail = read('app/(drawer)/(tabs)/(index,search,messages,grok,video,notifications)/post/[id].tsx');
const comments = read('components/Comments.tsx');
const composer = read('components/ReplyComposerProvider.tsx');
const rootLayout = read('app/_layout.tsx');
const contentAdapter = read('lib/content-adapter.ts');

test('feed reply action opens the global composer without leaving the feed', () => {
  expect(actions).toContain('accessibilityLabel="Reply to post"');
  expect(actions).toContain('accessibilityHint="Opens the floating reply composer"');
  expect(actions).toContain('openReplyComposer({');
  expect(actions).toContain('parentId: null');
  expect(actions).not.toContain("router.push(('/post/' + encodeURIComponent(itemData.contentId)) as never)");
  expect(actions).toContain('event?.stopPropagation?.()');
});

test('post cards keep their optional comment callback contract', () => {
  expect(feedItem).toContain('onCommentPress?: () => void');
  expect(feedItem).toContain('onCommentPress={onCommentPress}');
  expect(feedItem).toContain('detailView={Boolean(detailView)}');
  expect(feedItem).toContain('replyDisabled={replyDisabled}');
  expect(actions).toContain('replyDisabled || !itemData?.contentId?.trim()');
  expect(actions).toContain('onSubmitted: () => onReplySubmitted?.(contentId)');
  expect(feedItem).toContain('onReplySubmitted?: (contentId: string) => void');
});

test('post detail uses the shared floating composer and still renders the authoritative comments list', () => {
  expect(postDetail).not.toContain('handleScrollToComments');
  expect(postDetail).not.toContain('onCommentPress=');
  expect(postDetail).toContain('replyDisabled={membershipRequired}');
  expect(postDetail).toContain('onReplySubmitted={() => setFindPost');
  expect(postDetail).toContain('<Comments');
  expect(postDetail).toContain('contentId={postId}');
  expect(postDetail).toContain('sort={selectedSort}');
});

test('replying to a nested comment preserves parent ID and author context', () => {
  expect(comments).toContain('openReplyComposer({');
  expect(comments).toContain('parentId: comment.id');
  expect(comments).toContain('authorHandle: author?.username || comment.authorUserId');
  expect(comments).toContain('contentText: comment.body');
  expect(comments).toContain('onSubmitted: () => {');
  expect(comments).toContain('void loadComments();');
  expect(comments).toContain('onReplySubmitted?.();');
  expect(composer).toContain('activeTarget.onSubmitted?.()');
  expect(comments).toContain('onReplySubmitted?.()');
});

test('the global composer uses the installed Gorhom modal and keyboard-aware input', () => {
  expect(rootLayout).toContain('<ReplyComposerProvider>');
  expect(composer).toContain('<BottomSheetModal');
  expect(composer).toContain('<BottomSheetTextInput');
  expect(composer).toContain('keyboardBehavior="interactive"');
  expect(composer).toContain('keyboardBlurBehavior="restore"');
  expect(composer).toContain('android_keyboardInputMode="adjustResize"');
  expect(composer).toContain("pressBehavior={submitting ? 'none' : 'close'}");
});

test('comment author cards use W01 batched author projections and only look up unhydrated authors', () => {
  expect(comments).toContain('author?: PublicUser | null');
  expect(comments).toContain('const embeddedComments = comments.filter(hasEmbeddedProfile)');
  expect(comments).toContain('.filter((comment) => !hasEmbeddedProfile(comment))');
  expect(comments).toContain('profiles[comment.authorUserId] ?? comment.author ?? undefined');
});

test('feed reuses complete author projections instead of issuing per-item profile requests', () => {
  expect(contentAdapter).toContain("['username', 'displayName', 'avatar'].every");
  expect(contentAdapter).toContain("Object.prototype.hasOwnProperty.call(embedded, key)");
});

test('reply sort selection is forwarded to the real paginated API request', () => {
  expect(postDetail).toContain('<Comments');
  expect(postDetail).toContain('contentId={postId}');
  expect(postDetail).toContain('sort={selectedSort}');
  expect(comments).toContain("params.set('sort', sort)");
  expect(comments).toContain('}, [contentId, sort]);');
});

test('post menus do not advertise unfinished community note, offline, or list actions', () => {
  for (const source of [feedItem, postDetail]) {
    expect(source).not.toContain('key="community-note"');
    expect(source).not.toContain('key="offline"');
    expect(source).not.toContain('key="add-remove"');
  }
});
