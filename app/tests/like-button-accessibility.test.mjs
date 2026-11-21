import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const likeButton = readFileSync(new URL('../components/LikeButton.tsx', import.meta.url), 'utf8');

test('Like action exposes an accessible role, state, and context-sensitive label', () => {
  expect(likeButton).toContain('accessibilityRole="button"');
  expect(likeButton).toContain('accessibilityLabel={isLiked ? "Unlike" : "Like"}');
  expect(likeButton).toContain('accessibilityHint={isLiked ? "Removes your like from this post" : "Likes this post"}');
  expect(likeButton).toContain('selected: isLiked');
  expect(likeButton).toContain('disabled: !contentId?.trim() || isLoadingLike || isSavingLike');
  expect(likeButton).toContain('disabled={!contentId?.trim() || isLoadingLike || isSavingLike}');
});
