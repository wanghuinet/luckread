import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const followButton = readFileSync(new URL('../components/FollowButton.tsx', import.meta.url), 'utf8');

test('Follow action exposes an accessible action label, hint, and selected state', () => {
  expect(followButton).toContain('accessibilityRole="button"');
  expect(followButton).toContain('"Unfollow"');
  expect(followButton).toContain('"Follow"');
  expect(followButton).toContain('"Retry follow status"');
  expect(followButton).toContain('accessibilityHint={');
  expect(followButton).toContain('selected: loaded && following');
  expect(followButton).toContain('accessibilityState={{ disabled, selected: loaded && following }}');
});
