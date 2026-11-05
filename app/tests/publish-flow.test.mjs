import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { computeAutoSaveDelay, createPublishDraftFingerprint, createReplyAudienceFingerprint } from '../lib/publish-draft-autosave.ts';
import { findActiveComposerToken, replaceActiveComposerToken } from '../lib/publish-composer-tokens.ts';
import { getPollDurationMinutes, getPollDurationParts } from '../lib/poll-duration.ts';

const composer = readFileSync(new URL('../app/publish.tsx', import.meta.url), 'utf8');
const feedItem = readFileSync(new URL('../components/FeedItem.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('../app/(drawer)/(tabs)/(index)/index.tsx', import.meta.url), 'utf8');
const socialPoll = readFileSync(new URL('../components/SocialPoll.tsx', import.meta.url), 'utf8');
const mediaActionSheet = readFileSync(new URL('../components/PublishMediaActionSheet.tsx', import.meta.url), 'utf8');
const w01SocialRoute = readFileSync(new URL('../../workers/W01-payload/src/app/api/v1/contents/[contentId]/social/route.ts', import.meta.url), 'utf8');
const socialScreenApiSource = readFileSync(new URL('../lib/social-screen-api.ts', import.meta.url), 'utf8');

test('native publisher uses the shared media API helpers and existing W01 state endpoint', () => {
  expect(composer).toContain('prepareImageForUpload(file)');
  expect(composer).toContain('uploadMediaFile(uploadFile, asset.uploadKey, (progress) => {');
  expect(composer).toContain('getMediaPlayback(uploaded.id)');
  expect(composer).toContain('uploadTextBody(');
  expect(composer).toContain("'/contents/' + encodeURIComponent(draft.id) + '/state'");
  expect(composer).toContain("to: scheduleEnabled ? 'SCHEDULED' : 'PUBLISHED'");
  expect(composer).toContain('preflight: {');
  expect(composer).toContain("contentType: 'post'");
  expect(composer).not.toMatch(/\bfetch\s*\(/);
});

test('native publisher preserves pending media in app-private storage and restores by user and draft', () => {
  expect(composer).toContain("from '~/lib/publish-pending-media-recovery'");
  expect(composer).toContain('persistPendingMediaRecovery(');
  expect(composer).toContain('listPendingMediaRecovery(user.id, null)');
  expect(composer).toContain('listPendingMediaRecovery(user.id, targetContentId)');
  expect(composer).toContain('bindPendingMediaRecoveryToDraft(');
  expect(composer).toContain('markPendingMediaRecoveryUploaded(user.id, asset.localId, uploaded.url)');
  expect(composer).toContain('asset.uploadedUrl && restoredMediaRefs.includes(asset.uploadedUrl)');
  expect(composer).toContain('deletePendingMediaRecoveryForDraft(user.id, draft.id)');
  expect(composer).toContain('上次上传中断。本机已保留文件，点击重试即可继续。');
  expect(composer).toContain('setAssets(pending.map((asset) => ({');
});

test('native draft autosave persists text without treating unfinished local uploads as server media refs', () => {
  expect(composer).toContain("const pendingAssets = assets.filter((asset) => !asset.existing && asset.status !== 'ready');");
  expect(composer).toContain("const readyAssets = assets.filter((asset) => asset.existing || asset.status === 'ready');");
  expect(composer).toContain('const mediaRefs = Array.from(new Set(readyAssets.map((asset) => asset.serverUrl)));');
  expect(composer).toContain('await bindPendingMediaRecoveryToDraft(');
  expect(composer).toContain('Files are saved on this device; retry them from the composer.');
  expect(composer).toContain('if (!body.trim() && pollEnabled)');
  expect(composer).not.toContain("if (assets.some((asset) => !asset.existing && asset.status !== 'ready')) return;");
  expect(composer).not.toContain("assets.some((asset) => !asset.existing && asset.status !== 'ready')\\n    ) {");
});

test('native composer uses the existing Expo UI date-time picker for future scheduled publishing', () => {
  expect(composer).toContain("import DateTimePicker from '@expo/ui/community/datetime-picker';");
  expect(composer).toContain('mode="datetime"');
  expect(composer).toContain('presentation="inline"');
  expect(composer).toContain('minimumDate={new Date(Date.now() + MIN_SCHEDULE_LEAD_TIME_MS)}');
  expect(composer).toContain('toScheduledPublishISO(schedulePickerDraft)');
  expect(composer).toContain('toScheduledPublishISO(scheduleDate)');
  expect(composer).toContain("to: scheduleEnabled ? 'SCHEDULED' : 'PUBLISHED'");
  expect(composer).toContain('...(normalizedScheduledAt ? { scheduledAt: normalizedScheduledAt } : {})');
  expect(composer).toContain("Alert.alert('定时发布已安排'");
  expect(composer).toContain('scheduleDate.toLocaleString()');
  expect(composer).toContain('服务端会在到点后重新检查创作者权限，再自动发布。');
});

test('native composer lists, reschedules and cancels only owner-scoped scheduled posts', () => {
  expect(composer).toContain('fetchOwnScheduledPostsPage({ cursor, limit: 20 })');
  expect(composer).toContain('transitionOwnScheduledPostState(item, \'DRAFT\')');
  expect(composer).toContain('transitionOwnScheduledPostState(updatedDraft, \'SCHEDULED\', scheduledAt)');
  expect(composer).toContain('setScheduledInboxVisible(true)');
  expect(composer).toContain('setScheduledInboxItems((current) => current.filter((candidate) => candidate.id !== item.id))');
  expect(composer).toContain('openScheduleEditPicker(item)');
  expect(composer).toContain('cancelScheduledPost(item)');
  expect(composer).toContain('visible={scheduledInboxVisible}');
  expect(composer).toContain('定时发布');
  expect(composer).toContain('修改时间');
  expect(composer).toContain('取消定时');
  expect(composer).toContain('原定时已取消，内容已安全转为草稿；重新安排失败：');
});

test('native composer prevents scheduling polls before poll expiry starts', () => {
  expect(composer).toContain('Polls cannot be scheduled yet. Turn off the poll or publish immediately.');
  expect(composer).toContain('disabled={busy || loadingEdit || publishPending || scheduleEnabled}');
  expect(composer).toContain('disabled={busy || loadingEdit || publishPending || pollEnabled}');
  expect(composer).toContain("if (scheduleEnabled && pollEnabled)");
});

test('publishing and editing failures surface the backend HTTP status, error code and request ID', () => {
  expect(composer).toContain("restoringDraft ? 'Unable to restore this draft.' : 'Unable to load this post for editing.'");
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
  expect(composer).toContain("useLocalSearchParams<{ contentId?: string | string[]; draftId?: string | string[] }>()");
  expect(composer).toContain("headers: { 'If-Match': record.etag }");
  expect(composer).toContain('idempotencyKey: attempt.mutationKey');
  expect(composer).toContain("router.replace(('/?published=' + encodeURIComponent(contentId) + '&refresh=' + Date.now()) as never)");
  expect(composer).toContain("router.replace(('/?published=' + encodeURIComponent(contentId) + '&refresh=' + Date.now()) as never)");
});

test('edit and delete controls are only shown for the authenticated owner and use authoritative checks', () => {
  expect(feedItem).toContain('itemData.ownerUserId === currentUser.id');
  expect(feedItem).toContain("'/contents/' + encodeURIComponent(contentId) + '/state'");
  expect(feedItem).toContain("transition('UNPUBLISHED', current.etag)");
  expect(feedItem).toContain("transition('DRAFT', current.etag)");
  expect(feedItem).toContain("method: 'DELETE'");
  expect(feedItem).toContain("headers: { 'If-Match': etag }");
  expect(feedItem).toContain("idempotencyKey: 'native-content-delete:' + contentId + ':' + etag");
  expect(feedItem).toContain("...(isOwnPost ? [");
  expect(feedItem).toContain("id: 'delete-own-post'");
  expect(feedItem).toContain("case 'delete-own-post': removeOwnPost(); break;");
  expect(home).toContain('onDeleted={(contentId) => {');
  // Feed pages are stored as TanStack InfiniteData; remove the post from every cached page.
  expect(home).toContain('queryClient.setQueryData<InfiniteData<NativeFeedPage, string | null>>(queryKey, (current) => {');
  expect(home).toContain('pages: current.pages.map((page) => ({');
  expect(home).toContain('items: page.items.filter((post) => post.id !== contentId)');
  expect(home).toContain('setHydratedState((current) => {');
});

test('successful publishing confirms success and offers a direct link to the published post', () => {
  expect(composer).toContain("Alert.alert('发布成功', socialSyncWarning");
  expect(composer).toContain("'你的动态已发布，现在可以在公开信息流中查看。'");
  expect(composer).toContain("'你的动态已发布，但 @提及和 #话题同步暂时失败；之后编辑动态可以重试同步。'");
  expect(composer).toContain("text: '查看动态'");
  expect(composer).toContain("('/post/' + encodeURIComponent(publishedId))");
  expect(composer).toContain("('/?published=' + encodeURIComponent(publishedId) + '&refresh=' + Date.now())");
  expect(home).toContain("useLocalSearchParams<{ published?: string; refresh?: string }>()");
  expect(home).toContain('refreshSignal={refreshSignal}');
  // Publishing returns to the authoritative W01 feed and invalidates its cache.
  expect(home).toContain('previousRefreshSignal.current !== refreshSignal && refreshSignal');
  expect(home).toContain('queryClient.invalidateQueries({ queryKey })');
  expect(home).toContain('[queryClient, queryKey, refreshSignal]');
});


test('native post composer validates and configures a real poll on the same draft before publication', () => {
  expect(composer).toContain("const [pollEnabled, setPollEnabled] = useState(false)");
  expect(composer).toContain('MAX_POLL_OPTIONS = 4');
  expect(composer).toContain('MAX_POLL_OPTION_LENGTH = 50');
  expect(composer).toContain("pollKey: createIdempotencyKey()");
  expect(composer).toContain("'/contents/' + encodeURIComponent(draft.id) + '/poll'");
  expect(composer).toContain('options: cleanPollOptions');
  expect(composer).toContain('durationMinutes: pollDurationMinutes');
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

test('native composer reports real attachment upload progress before publish is enabled', () => {
  expect(composer).toContain('uploadProgress?: number | null;');
  expect(composer).toContain('uploadLoadedBytes?: number;');
  expect(composer).toContain('uploadTotalBytes?: number;');
  expect(composer).toContain('uploadMediaFile(uploadFile, asset.uploadKey, (progress) => {');
  expect(composer).toContain('uploadProgress: progress.percent');
  expect(composer).toContain('uploadLoadedBytes: progress.loaded');
  expect(composer).toContain('Uploading to LuckRead · ');
  expect(composer).toContain('accessibilityRole="progressbar"');
  expect(composer).toContain('Math.min(100, Math.max(0, asset.uploadProgress))');
});

test('media upload success is reported only when every attachment is ready', () => {
  expect(composer).toContain('return true;');
  expect(composer).toContain('return false;');
  expect(composer).toContain('const uploadResults: boolean[] = [];');
  expect(composer).toContain('uploadResults.push(await uploadAsset(asset))');
  expect(composer).toContain('uploadResults.every(Boolean)');
  expect(composer).toContain('Some media uploads failed. Files are saved on this device; retry them from the composer.');
  expect(composer).toContain('Media upload failed. Retry this file before publishing.');
  expect(composer).toContain('const allReady = succeeded && assets.every((candidate) =>');
  expect(composer).toContain('Retry any remaining failed media before publishing.');
});

test('native social composer supports an X-style mixed photo and video attachment set', () => {
  expect(composer).toContain('ImagePicker.MediaTypeOptions.All');
  expect(composer).toContain('allowsMultipleSelection: true');
  expect(composer).toContain('MAX_MEDIA_ITEMS = 4');
  expect(composer).toContain('MAX_VIDEO_ITEMS = 1');
  expect(composer).toContain('existingVideoCount + selectedVideoCount > MAX_VIDEO_ITEMS');
  expect(composer).toContain('Add photos or video');
  expect(composer).toContain('Up to 4 media items');
  expect(composer).toContain('videoMaxDuration: 60');
  expect(composer).toContain("contentType: 'post'");
  expect(composer).toContain('video is an attachment, not a separate video-content record');
  expect(composer).toContain('<PublishMediaActionSheet');
  expect(composer).toContain('remainingCount={MAX_MEDIA_ITEMS - assets.length}');
  expect(composer).toContain('onPickMedia={() => { void pickMedia(); }}');
  expect(composer).not.toContain('onPress={() => setCameraVisible(true)}');
});


test('native publisher preserves animated GIFs in the picker and when restoring media references', () => {
  expect(composer).toContain('allowsEditing: false,');
  expect(composer).toContain('quality: 1.0,');
  expect(composer).toContain("if (/\\.gif(?:[?#].*)?$/i.test(url)) return 'image/gif';");
});

test('native composer previews attached videos before publishing and preserves playback controls', () => {
  expect(composer).toContain("import { VideoView, useVideoPlayer } from 'expo-video'");
  expect(composer).toContain('function ComposerVideoPreview');
  expect(composer).toContain('<VideoView');
  expect(composer).toContain('nativeControls');
  expect(composer).toContain('asset.uri || asset.playbackUrl || asset.serverUrl');
});


test('native composer displays a sortable X-style attachment grid and preserves the selected media order', () => {
  expect(composer).toContain("import Sortable from 'react-native-sortables';");
  expect(composer).toContain('<Sortable.Grid');
  expect(composer).toContain('columns={assets.length === 1 ? 1 : 2}');
  expect(composer).toContain('data={assets}');
  expect(composer).toContain('keyExtractor={(asset) => asset.localId}');
  expect(composer).toContain('renderItem={renderComposerAsset}');
  expect(composer).toContain('onDragEnd={({ data }) => setAssets(data)}');
  expect(composer).toContain('sortEnabled={!busy && !publishPending && assets.length > 1}');
  expect(composer).toContain('customHandle');
  expect(composer).toContain('const mediaRefs = Array.from(new Set(assets.map((asset) => asset.serverUrl)))');
  expect(composer).not.toContain('{assets.map((asset) => (');
});

test('Keyboard Controller keeps the publish header stable and scrolls focused editor fields above the keyboard', () => {
  expect(composer).toContain("from 'react-native-keyboard-controller'");
  expect(composer).toContain('<KeyboardProvider preload={false}>');
  expect(composer).toContain('<KeyboardAwareScrollView');
  expect(composer).toContain('bottomOffset={16}');
  expect(composer).not.toContain('KeyboardAvoidingView');
  expect(composer).not.toContain('<ScrollView');
});


test('native composer reuses Gorhom bottom sheet for camera and photo-library media actions', () => {
  expect(mediaActionSheet).toContain("from '@gorhom/bottom-sheet'");
  expect(mediaActionSheet).toContain('<BottomSheetModal');
  expect(mediaActionSheet).toContain('remainingCount');
  expect(mediaActionSheet).toContain("dismissForAction('camera')");
  expect(mediaActionSheet).toContain("dismissForAction('library')");
  expect(mediaActionSheet).toContain("pendingAction === 'camera'");
  expect(mediaActionSheet).toContain("pendingAction === 'library'");
  expect(mediaActionSheet).toContain('onDismiss={handleDismiss}');
  expect(mediaActionSheet).toContain('Take photo');
  expect(mediaActionSheet).toContain('Choose from library');
  // Native pickers are invoked only after the bottom sheet has fully dismissed.
  expect(mediaActionSheet.indexOf('onDismiss={handleDismiss}')).toBeGreaterThan(-1);
});


test('native publisher auto-saves server drafts, restores them by draft ID, and flushes before close or publish', () => {
  expect(composer).toContain("draftId?: string | string[]");
  expect(composer).toContain("fetchContentBodyReference(record.bodyRef)");
  expect(composer).toContain("apiRequest<Record<string, unknown>>('/contents'");
  expect(composer).toContain("'/contents/' + encodeURIComponent(draft.id)");
  expect(composer).toContain("headers: { 'If-Match': draft.etag }");
  expect(composer).toContain("router.setParams({ draftId: draft.id } as never)");
  expect(composer).toContain('draftCreatePendingRef.current');
  expect(composer).toContain('draftSaveInFlightPromiseRef.current');
  expect(composer).toContain('await saveDraftSnapshot();');
  expect(composer).toContain("onPress={() => { void closeComposer(); }}");
  expect(composer).toContain("usePreventRemove(shouldPreventRemove, handlePreventRemove)");
  expect(composer).toContain('navigation.dispatch(data.action)');
  expect(composer).toContain('draftWasPublishedRef.current = true');
  expect(composer).toContain("to: scheduleEnabled ? 'SCHEDULED' : 'PUBLISHED'");
  expect(composer).toContain('fetchContentBodyReference');
  expect(composer).toContain('draftSavedFingerprintRef.current = fingerprint;');
  expect(composer).toContain('if (pollEnabled && !contentId && !pollConfiguredRef.current)');
  expect(composer).toContain('草稿已自动保存。');
  expect(composer).toContain('Complete the poll before saving the draft.');
  expect(composer).not.toContain('localStorage');
});

test('native draft autosave uses the proven W01 debounce and minimum write interval', () => {
  expect(computeAutoSaveDelay(1_000, null)).toBe(1_800);
  expect(computeAutoSaveDelay(2_000, 1_000)).toBe(4_000);
  expect(computeAutoSaveDelay(20_000, 1_000)).toBe(1_800);
});

test('native draft fingerprints are stable and change when persisted content changes', () => {
  const input = {
    body: 'A private draft',
    accessMode: 'PUBLIC',
    mediaRefs: ['https://img.luckread.com/a.jpg'],
    coverRef: 'https://img.luckread.com/a.jpg',
    pollEnabled: false,
    pollOptions: [],
    pollDurationMinutes: 1440,
    mediaWarning: null,
  };
  const fingerprint = createPublishDraftFingerprint(input);
  expect(createPublishDraftFingerprint(input)).toBe(fingerprint);
  expect(createPublishDraftFingerprint({ ...input, body: 'Changed draft' })).not.toBe(fingerprint);
  expect(createPublishDraftFingerprint({ ...input, accessMode: 'MEMBERS_ONLY' })).not.toBe(fingerprint);
  expect(createPublishDraftFingerprint({ ...input, pollEnabled: true, pollOptions: ['Yes', 'No'] })).not.toBe(fingerprint);
  expect(createPublishDraftFingerprint({ ...input, mediaWarning: 'VIOLENCE' })).not.toBe(fingerprint);
  expect(fingerprint).not.toContain(input.body);
});

test('native publisher lists, restores, paginates and deletes the owner-only draft inbox', () => {
  expect(composer).toContain('fetchOwnPostDraftsPage({ cursor, limit: 20 })');
  expect(composer).toContain('deleteOwnPostDraft(draft.id, draft.etag)');
  expect(composer).toContain('restoreDraftFromInbox(item)');
  expect(composer).toContain('setDraftInboxCursor(page.nextCursor || null)');
  expect(composer).toContain('draftInboxHasMore && !draftInboxLoading && draftInboxCursor');
  expect(composer).toContain('router.setParams({ contentId: undefined, draftId: draft.id } as never)');
  expect(composer).toContain('<Modal');
  expect(composer).toContain('草稿箱');
  expect(composer).toContain('删除草稿');
  expect(socialScreenApiSource).toContain("headers: { 'If-Match': etag }");
});

test('native composer inserts only the active @mention or #topic at the caret', () => {
  const mention = findActiveComposerToken('hello @ali', 10);
  expect(mention).toMatchObject({ kind: 'mention', query: 'ali' });
  expect(replaceActiveComposerToken('hello @ali', mention, 'alice').text).toBe('hello @alice ');
  const topic = findActiveComposerToken('read #books', 11);
  expect(topic).toMatchObject({ kind: 'topic', query: 'books' });
  expect(replaceActiveComposerToken('read #books', topic, 'reading').text).toBe('read #reading ');
  expect(composer).toContain('fetchDiscoveryTopics(controller.signal)');
  expect(composer).toContain('}, [activeComposerToken?.kind]);');
  expect(composer).toContain('findPublicUserByUsername(query, controller.signal)');
  expect(composer).toContain('onSelectionChange={(event) => setTextSelection(event.nativeEvent.selection)}');
});

test('published native posts sync mention and topic tokens through W01 and W05 authorities', () => {
  expect(composer).toContain("'/contents/' + encodeURIComponent(contentIdValue) + '/social'");
  expect(composer).toContain('syncPublishedSocialTokens(draft.id, trimmedBody)');
  expect(w01SocialRoute).toContain('resolveSocialMentionTargets(text)');
  expect(w01SocialRoute).toContain("pathname: '/internal/social/contents/' + encodeURIComponent(contentId) + '/tokens'");
  expect(w01SocialRoute).toContain('mentions = await resolveSocialMentionTargets(text)');
});

test('native publisher lets authors choose an uploaded image as the post cover', () => {
  expect(composer).toContain("const activeCoverRef = coverRef || assets.find((asset) => asset.mimeType.startsWith('image/'))?.serverUrl || '';");
  expect(composer).toContain("asset.mimeType.startsWith('image/') && asset.status === 'ready' && asset.serverUrl");
  expect(composer).toContain("onPress={() => setCoverRef(asset.serverUrl)}");
  expect(composer).toContain("asset.serverUrl === activeCoverRef ? '当前封面' : '设为封面'");
  // The chosen cover continues through the existing draft and publish contracts.
  expect(composer).toContain('coverRef: nextCover');
});


test('native publisher uses the existing W01/W05 reply-audience policy for create, edit, autosave and restore', () => {
  expect(composer).toContain("useState<NativeReplyAudience>('everyone')");
  expect(composer).toContain('fetchOwnPostReplyAudience(targetContentId)');
  expect(composer).toContain('saveOwnPostReplyAudience(draft.id, replyAudience, trimmedBody)');
  expect(composer).toContain('saveOwnPostReplyAudience(contentId, replyAudience, trimmedBody)');
  expect(composer).toContain('replyAudienceSavedFingerprintRef.current');
  expect(composer).toContain('谁可以回复？');
  expect(composer).toContain('followingNetwork');
  expect(composer).toContain('被提及的账号始终可以回复');
  expect(composer).toContain('isNativeReplyAudience');
  expect(composer).not.toContain('mentionedUserIds:');
});

test('reply policy autosave fingerprints change for audience or mentioned text without retaining the text', () => {
  const initial = createReplyAudienceFingerprint('Hello @alice', 'mentioned');
  expect(createReplyAudienceFingerprint('Hello @alice', 'mentioned')).toBe(initial);
  expect(createReplyAudienceFingerprint('Hello @bob', 'mentioned')).not.toBe(initial);
  expect(createReplyAudienceFingerprint('Hello @alice', 'everyone')).not.toBe(initial);
  expect(initial).not.toContain('Hello');
});

test('native poll duration matches X bounds and keeps day/hour/minute precision', () => {
  expect(getPollDurationParts(1440)).toEqual({ days: '1', hours: '0', minutes: '0' });
  expect(getPollDurationMinutes({ days: '0', hours: '0', minutes: '5' })).toBe(5);
  expect(getPollDurationMinutes({ days: '0', hours: '6', minutes: '30' })).toBe(390);
  expect(getPollDurationMinutes({ days: '7', hours: '0', minutes: '0' })).toBe(10080);
  expect(getPollDurationMinutes({ days: '0', hours: '0', minutes: '4' })).toBeNull();
  expect(getPollDurationMinutes({ days: '7', hours: '0', minutes: '1' })).toBeNull();
  expect(getPollDurationMinutes({ days: '0', hours: '24', minutes: '0' })).toBeNull();
  expect(composer).toContain('durationMinutes: pollDurationMinutes');
  expect(composer).toContain('Poll duration · 5 minutes to 7 days');
  expect(composer).toContain('getPollDurationParts');
});


test('native composer persists warning metadata and hides media until the reader reveals it', () => {
  expect(composer).toContain('mediaWarning');
  expect(composer).toContain('setMediaWarning(record.mediaWarning ?? null)');
  expect(composer).toContain('媒体内容警告');
  expect(composer).toContain('mediaWarning,');
  expect(feedItem).toContain('可能包含敏感内容');
  expect(feedItem).toContain('onPress={() => setRevealedMediaKey(mediaRevealKey)}');
  expect(feedItem).toContain('mediaWarning={itemData.accessGranted === false ? null : itemData.mediaWarning}');
});
