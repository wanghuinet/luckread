import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const composer = readFileSync(new URL('../app/publish.tsx', import.meta.url), 'utf8');
const feed = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
const reader = readFileSync(new URL('../lib/media-alt-text.ts', import.meta.url), 'utf8');
const mediaApi = readFileSync(new URL('../lib/publish-api.ts', import.meta.url), 'utf8');

test('composer edits owned image metadata through the existing W01 media PATCH route', () => {
  expect(composer).toContain('getOwnedMediaMetadata(restoredMediaRefs)');
  expect(composer).toContain("'/media/' + encodeURIComponent(media.id)");
  expect(composer).toContain('body: JSON.stringify({ alt })');
  expect(composer).toContain('await savePendingAssetAltText()');
  expect(composer).toContain('图片替代文本');
  expect(composer).toContain('maxLength={1000}');
  expect(mediaApi).toContain("'/media?' + query.toString()");
});

test('published image descriptions are resolved through the W01 API before setting image accessibility labels', () => {
  expect(reader).toContain("'/media/metadata?' + query.toString()");
  expect(reader).toContain('apiRequest<unknown>');
  expect(reader).toContain('.slice(0, 4)');
  expect(reader).not.toContain('fetch(');
  expect(feed).toContain('fetchPublishedMediaAltText(urls, controller.signal)');
  expect(feed).toContain('accessibilityLabel={media.alt}');
  expect(feed).toContain('accessibilityLabel={item.alt}');
});

test('media lookup remains bounded to four unique URLs per post', () => {
  expect(reader).toContain('[...new Set(urls.filter');
  expect(reader).toContain('.slice(0, 4)');
  expect(composer).toContain('new Map(ownedMedia.map((media) => [media.url, media]))');
});
