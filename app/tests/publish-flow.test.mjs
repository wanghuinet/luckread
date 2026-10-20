import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const composer = readFileSync(new URL('../app/publish.tsx', import.meta.url), 'utf8');
const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url), 'utf8');

test('native publisher uses the shared media API helpers and existing W01 state endpoint', () => {
  expect(composer).toContain('uploadMediaFile(file, asset.uploadKey)');
  expect(composer).toContain('getMediaPlayback(uploaded.id)');
  expect(composer).toContain('uploadTextBody(');
  expect(composer).toContain("'/contents/' + encodeURIComponent(draft.id) + '/state'");
  expect(composer).toContain("to: 'PUBLISHED'");
  expect(composer).toContain('preflight: {');
  expect(composer).toContain("contentType: 'post'");
  expect(composer).not.toMatch(/\bfetch\s*\(/);
});

test('publisher uses permanent server media references and stable per-operation idempotency keys', () => {
  expect(composer).toContain('uploadKey: createIdempotencyKey()');
  expect(composer).toContain('mediaRefs,');
  expect(composer).toContain('coverRef: nextCover');
  expect(composer).toContain('bodyRef');
  expect(composer).toContain('serverUrl');
  expect(composer).toContain('publishPending');
});

test('editing is ETag guarded and returns to a refreshed authoritative timeline', () => {
  expect(composer).toContain("useLocalSearchParams<{ contentId?: string | string[] }>()");
  expect(composer).toContain("headers: { 'If-Match': record.etag }");
  expect(composer).toContain('idempotencyKey: attempt.mutationKey');
  expect(composer).toContain("router.replace(('/?published=' + encodeURIComponent(contentId) + '&refresh=' + Date.now()) as never)");
  expect(composer).toContain("router.replace(('/?published=' + encodeURIComponent(draft.id) + '&refresh=' + Date.now()) as never)");
});

test('edit and delete controls are only shown for the authenticated owner and use authoritative checks', () => {
  expect(feedItem).toContain('itemData.ownerUserId === currentUser.id');
  expect(feedItem).toContain("'/contents/' + encodeURIComponent(contentId) + '/state'");
  expect(feedItem).toContain("transition('UNPUBLISHED', current.etag)");
  expect(feedItem).toContain("transition('DRAFT', current.etag)");
  expect(feedItem).toContain("method: 'DELETE'");
  expect(feedItem).toContain("headers: { 'If-Match': etag }");
  expect(feedItem).toContain("idempotencyKey: 'native-content-delete:' + contentId + ':' + etag");
  expect(feedItem).toContain('key="delete-own-post"');
  expect(home).toContain('onDeleted={(contentId) => {');
  expect(home).toContain('current.filter((post) => post.contentId !== contentId)');
});

test('successful publishing requests a fresh page rather than mutating a sample feed locally', () => {
  expect(home).toContain("useLocalSearchParams<{ published?: string; refresh?: string }>()");
  expect(home).toContain('refreshSignal={refreshSignal}');
  expect(home).toContain('[loadPage, refreshKey, refreshSignal]');
});
