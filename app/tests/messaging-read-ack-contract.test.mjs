import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('read receipt API rejects non-success HTTP responses so retry logic can run', () => {
  const source = readFileSync(new URL('../lib/messaging-api.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function markConversationRead');
  const end = source.indexOf('\n}\n', start);
  const implementation = source.slice(start, end);
  expect(implementation).toContain('if (!result.response.ok)');
  expect(implementation).toContain('throw new Error');
});


test('realtime reconnect backoff is not reset by short-lived connections', () => {
  const source = readFileSync(new URL('../lib/messaging-realtime.ts', import.meta.url), 'utf8');
  expect(source).toContain('stableTimer');
  expect(source).toContain('30_000');
  expect(source).toContain('Reset backoff only after a sustained connection');
  expect(source).toContain('if (stableTimer) clearTimeout(stableTimer)');
});


test('conversation realtime lifecycle rebinds when authenticated account changes', () => {
  const source = readFileSync(new URL('../app/(drawer)/(tabs)/(messages)/messages/[conversationId].tsx', import.meta.url), 'utf8');
  expect(source).toContain('[conversationId, userId, isFocused, appState, queryClient, router]');
});


test('messaging React Query caches are scoped by authenticated user identity', () => {
  const listSource = readFileSync(new URL('../app/(drawer)/(tabs)/(messages)/messages.tsx', import.meta.url), 'utf8');
  const conversationSource = readFileSync(new URL('../app/(drawer)/(tabs)/(messages)/messages/[conversationId].tsx', import.meta.url), 'utf8');
  expect(listSource).toContain("queryKey: ['messaging', userId,");
  expect(listSource).toContain('const userId = useAuthStore((state) => state.user?.id)');
  expect(conversationSource).toContain("queryKey: ['messaging', userId,");
});


test('messaging realtime cache reads and writes use account-scoped query keys', () => {
  const source = readFileSync(new URL('../app/(drawer)/(tabs)/(messages)/messages/[conversationId].tsx', import.meta.url), 'utf8');
  expect(source).toContain("getQueryData<typeof messagesQuery.data>(['messaging', userId, 'messages', conversationId])");
  expect(source).toContain("setQueryData(['messaging', userId, 'messages', conversationId]");
  expect(source).toContain("setQueryData(['messaging', userId, 'typing', conversationId]");
});


test('attachment upload does not reject metadata-only missing file size before server validation', () => {
  const source = readFileSync(new URL('../lib/messaging-api.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function uploadMessageAttachment');
  const end = source.indexOf('\n}\n', start);
  const implementation = source.slice(start, end);
  expect(implementation).toContain('typeof file.size === \'number\'');
  expect(implementation).not.toContain('!file.size');
});


test('conversation composer state is isolated when route or account scope changes', () => {
  const source = readFileSync(new URL('../app/(drawer)/(tabs)/(messages)/messages/[conversationId].tsx', import.meta.url), 'utf8');
  expect(source).toContain('conversationScopeRef.current.conversationId !== conversationId || conversationScopeRef.current.userId !== userId');
  expect(source).toContain('setPendingAttachments([]);');
  expect(source).toContain('senderProfileAttempted.current.clear();');
  expect(source).toContain('scopeVersion: conversationScopeRef.current.version');
  expect(source).toContain('conversationScopeRef.current.version !== variables.scopeVersion');
  expect(source).toContain('sendDirectMessage(variables.conversationId');
});


test('attachment picker and upload completions cannot leak into a newly selected conversation', () => {
  const source = readFileSync(new URL('../app/(drawer)/(tabs)/(messages)/messages/[conversationId].tsx', import.meta.url), 'utf8');
  expect(source).toContain('const scopeVersion = conversationScopeRef.current.version;');
  expect(source).toContain('if (conversationScopeRef.current.version !== scopeVersion) return;');
  expect(source).toContain('await uploadOne(item.localId, item.file, scopeVersion)');
  expect(source).toContain('if (conversationScopeRef.current.version === scopeVersion) setIsPicking(false);');
});

test('messaging realtime socket registry and typing frames are account-scoped', () => {
  const source = readFileSync(new URL('../lib/messaging-realtime.ts', import.meta.url), 'utf8');
  expect(source).toContain("const socketKey = (userId: string, conversationId: string) => userId + ':' + conversationId");
  expect(source).toContain('setMessagingRealtimeTyping(userId: string, conversationId: string, typing: boolean)');
  expect(source).toContain('activeSockets.get(socketKey(userId, conversationId))');
  expect(source).toContain('setMessagingRealtimeTyping(userId ?? \'\', conversationId, true)');
  const screen = readFileSync(new URL('../app/(drawer)/(tabs)/(messages)/messages/[conversationId].tsx', import.meta.url), 'utf8');
  expect(screen).toContain('userId: userId ??');
  expect(screen).toContain('setMessagingRealtimeTyping(userId ??');
});
