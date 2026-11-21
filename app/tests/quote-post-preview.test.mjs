import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const preview = readFileSync(new URL('../components/QuotePostPreview.tsx', import.meta.url), 'utf8');
const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');

test('native post detail reads the authoritative outgoing quote-post relationship', () => {
  expect(preview).toContain("'/contents/' + encodeURIComponent(contentId) + '/relationships?direction=out&limit=20'");
  expect(preview).toContain("item.relationType === 'quote-post' && item.direction === 'out'");
  expect(preview).toContain('quoteRelationship?.relatedContent?.id');
  expect(preview).toContain("'/contents/' + encodeURIComponent(targetId)");
});

test('quoted source is shown only while it remains a published public post', () => {
  expect(preview).toContain("target.contentType !== 'post'");
  expect(preview).toContain("target.state !== 'PUBLISHED'");
  expect(preview).toContain("target.accessMode !== 'PUBLIC'");
  expect(preview).toContain('mapContentToFeedContent(target)');
});

test('quoted source navigation uses the canonical relationship target ID, never push-supplied URLs', () => {
  expect(preview).toContain("('/post/' + encodeURIComponent(state.contentId))");
  expect(preview).not.toMatch(/payload\?\.url|targetUrl|deepLinkUrl/);
});

test('quote preview cancels stale reads and offers a retry for transient failures', () => {
  expect(preview).toContain('const controller = new AbortController()');
  expect(preview).toContain('signal: controller.signal');
  expect(preview).toContain('controller.abort()');
  expect(preview).toContain('setRetryNonce((value) => value + 1)');
});

test('quote source preview is limited to post detail and does not add one request per feed card', () => {
  expect(feedItem).toContain("import QuotePostPreview from './QuotePostPreview';");
  expect(feedItem).toContain('{detailView && itemData.contentType === \'post\' && itemData.contentId ? (');
  expect(feedItem).toContain('<QuotePostPreview contentId={itemData.contentId} />');
});
