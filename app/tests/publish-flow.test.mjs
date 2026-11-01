import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const composer = readFileSync(new URL('../app/publish.tsx', import.meta.url), 'utf8');
const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url), 'utf8');
const socialPoll = readFileSync(new URL('../components/SocialPoll.tsx', import.meta.url), 'utf8');

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

test('publishing and editing failures surface the backend HTTP status, error code and request ID', () => {
  expect(composer).toContain('apiFailureDiagnostic(result, \'Unable to load this post for editing.\')');
  expect(composer).toContain('apiFailureDiagnostic(result, \'Unable to save post changes.\')');
  expect(composer).toContain('apiFailureDiagnostic(created, \'Unable to create the post.\')');
  expect(composer).toMatch(/apiFailureDiagnostic\(\s*pollResult\s*,/);
  expect(composer).toMatch(/apiFailureDiagnostic\(\s*transitioned\s*,/);
  expect(composer).not.toContain('getApiErrorMessage');
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

test('successful publishing confirms success and offers a direct link to the published post', () => {
  expect(composer).toContain("Alert.alert('发布成功', '你的动态已发布，现在可以在公开信息流中查看。'");
  expect(composer).toContain("text: '查看动态'");
  expect(composer).toContain("('/post/' + encodeURIComponent(publishedId))");
  expect(composer).toContain("('/?published=' + encodeURIComponent(publishedId) + '&refresh=' + Date.now())");
  expect(home).toContain("useLocalSearchParams<{ published?: string; refresh?: string }>()");
  expect(home).toContain('refreshSignal={refreshSignal}');
  expect(home).toContain('[loadPage, refreshKey, refreshSignal]');
});


test('native post composer validates and configures a real poll on the same draft before publication', () => {
  expect(composer).toContain("const [pollEnabled, setPollEnabled] = useState(false)");
  expect(composer).toContain('MAX_POLL_OPTIONS = 4');
  expect(composer).toContain('MAX_POLL_OPTION_LENGTH = 50');
  expect(composer).toContain("pollKey: createIdempotencyKey()");
  expect(composer).toContain("'/contents/' + encodeURIComponent(draft.id) + '/poll'");
  expect(composer).toContain('options: cleanPollOptions');
  expect(composer).toContain('durationHours: pollDurationHours');
  expect(composer).toContain('idempotencyKey: attempt.pollKey');
  expect(composer).toContain("setPublishPending(true)");
  expect(composer.indexOf("'/contents/' + encodeURIComponent(draft.id) + '/poll'"))
    .toBeLessThan(composer.indexOf("'/contents/' + encodeURIComponent(draft.id) + '/state'"));
  expect(composer).toContain('Published poll options cannot be changed.');
});

test('native post detail reads poll state and submits votes through existing W01/W05 routes', () => {
  expect(feedItem).toContain("import SocialPoll from './SocialPoll';");
  expect(feedItem).toContain("itemData.contentType === 'post'");
  expect(socialPoll).toContain("'/contents/' + encodeURIComponent(contentId) + '/poll'");
  expect(socialPoll).toContain("'/contents/' + encodeURIComponent(contentId) + '/poll/votes'");
  expect(socialPoll).toContain('idempotencyKey: createIdempotencyKey()');
  expect(socialPoll).toContain('viewerOptionId');
  expect(socialPoll).toContain('option.votes / poll.totalVotes');
  expect(socialPoll).toContain('poll.closed');
});

test('media upload success is reported only when every attachment is ready', () => {
  expect(composer).toContain('return true;');
  expect(composer).toContain('return false;');
  expect(composer).toContain('const uploadResults: boolean[] = [];');
  expect(composer).toContain('uploadResults.push(await uploadAsset(asset))');
  expect(composer).toContain('uploadResults.every(Boolean)');
  expect(composer).toContain('Some media uploads failed. Retry failed files before publishing.');
  expect(composer).toContain('Media upload failed. Retry this file before publishing.');
  expect(composer).toContain('const allReady = succeeded && assets.every((candidate) =>');
  expect(composer).toContain('Retry any remaining failed media before publishing.');
});
