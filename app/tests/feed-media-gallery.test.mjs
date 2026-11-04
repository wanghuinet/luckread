import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');

test('public post photos share one Galeria root and stable indexes for swipe navigation', () => {
  expect(feedItem).toContain('const imageItems = accessibleItems.filter((media) => media.kind === \'image\')');
  expect(feedItem).toContain('<Galeria urls={imageItems.map((media) => media.src)}>');
  expect(feedItem).toContain('<Galeria.Image index={currentImageIndex}>');
  expect(feedItem).toContain('!requiresAuthenticatedViewer && imageItems.length > 0');
});

test('member-only image preview uses authenticated image sources in a paged native modal', () => {
  expect(feedItem).toContain('requiresAuthentication: itemData.accessMode === \'MEMBERS_ONLY\'');
  expect(feedItem).toContain('source={{ uri: media.src, headers: media.headers }}');
  expect(feedItem).toContain('source={{ uri: item.src, headers: item.headers }}');
  expect(feedItem).toContain('initialScrollIndex={viewerStartIndex}');
  expect(feedItem).toContain('pagingEnabled');
  expect(feedItem).toContain('accessibilityLabel="Close image viewer"');
});

test('member-only images are not passed to Galeria as unauthenticated remote URLs', () => {
  expect(feedItem).toContain('const requiresAuthenticatedViewer = imageItems.some(');
  expect(feedItem).toContain('!requiresAuthenticatedViewer && imageItems.length > 0 ?');
  expect(feedItem).toContain('requiresAuthenticatedViewer && viewerStartIndex !== null ?');
});
