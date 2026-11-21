import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const preview = readFileSync(new URL('../components/PostThreadPreview.tsx', import.meta.url), 'utf8');
const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');

test('native post thread preview reads the canonical W01 thread endpoint', () => {
  expect(preview).toContain("'/contents/' + encodeURIComponent(contentId) + '/thread'");
  expect(preview).toContain("method: 'GET'");
  expect(preview).toContain('unwrapApiData<ThreadPayload>');
  expect(preview).toContain('rootContentId');
});

test('thread preview only renders a bounded window around the current post', () => {
  expect(preview).toContain('const VISIBLE_THREAD_ITEMS = 5');
  expect(preview).toContain('currentIndex - 2');
  expect(preview).toContain('ordered.slice(start, start + VISIBLE_THREAD_ITEMS)');
  expect(preview).toContain('hiddenBefore');
  expect(preview).toContain('hiddenAfter');
});

test('thread body resolution uses the trusted content adapter and aborts stale requests', () => {
  expect(preview).toContain("import { readContentBody, unwrapApiData, type ApiContentRecord } from '~/lib/content-adapter'");
  expect(preview).toContain('await readContentBody(record, controller.signal)');
  expect(preview).toContain('controller.abort()');
  expect(preview).toContain('controller.signal.aborted');
});

test('thread items navigate by canonical content ID and current item is not redundantly navigated', () => {
  expect(preview).toContain("('/post/' + encodeURIComponent(item.id))");
  expect(preview).toContain('disabled={isCurrent}');
  expect(preview).toContain("('/post/' + encodeURIComponent(state.rootContentId))");
});

test('thread preview is only mounted in native post detail view, not each feed card', () => {
  expect(feedItem).toContain("import PostThreadPreview from './PostThreadPreview'");
  expect(feedItem).toContain('{detailView && itemData.contentType === \'post\' && itemData.contentId ? (');
  expect(feedItem).toContain('<PostThreadPreview contentId={itemData.contentId} />');
});
