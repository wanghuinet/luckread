import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const calls = [];
let apiResult = {
  response: new Response(null, { status: 200 }),
  data: null,
  error: null,
};

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options) => {
    calls.push({ path, options });
    return apiResult;
  },
}));

const {
  SESSION_PAGE_SIZE,
  fetchSessionListPage,
  parseSessionListPage,
  revokeSession,
} = await import('../lib/session-management-api.ts');

const sessionPage = {
  items: [{
    sessionId: 'session-current',
    createdAt: '2026-11-05T10:00:00.000Z',
    expiresAt: '2026-11-12T10:00:00.000Z',
    lastSeenAt: null,
  }],
  currentSessionId: 'session-current',
  nextCursor: null,
};

beforeEach(() => {
  calls.splice(0, calls.length);
  apiResult = {
    response: new Response(null, { status: 200 }),
    data: sessionPage,
    error: null,
  };
});

test('uses the canonical W01 session-list endpoint with bounded pagination', async () => {
  const controller = new AbortController();
  await fetchSessionListPage({ cursor: 's1.next-page', signal: controller.signal });

  expect(SESSION_PAGE_SIZE).toBe(20);
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/auth/sessions?limit=20&cursor=s1.next-page');
  expect(calls[0].options.method).toBe('GET');
  expect(calls[0].options.signal).toBe(controller.signal);
});

test('does not send an invalid or oversized cursor to the API', async () => {
  await expect(fetchSessionListPage({ cursor: ' ' })).rejects.toThrow('valid session cursor');
  await expect(fetchSessionListPage({ cursor: 'x'.repeat(257) })).rejects.toThrow('valid session cursor');
  expect(calls).toHaveLength(0);
});

test('validates the server-owned session envelope and optional metadata', () => {
  expect(parseSessionListPage(sessionPage)).toEqual(sessionPage);
  expect(parseSessionListPage({
    ...sessionPage,
    items: [{
      sessionId: 'session-other',
      createdAt: 'not-a-date',
      expiresAt: '2026-11-12T10:00:00.000Z',
      lastSeenAt: null,
    }],
  })).toBeNull();
  expect(parseSessionListPage({ ...sessionPage, currentSessionId: '' })).toBeNull();
  expect(parseSessionListPage({ ...sessionPage, nextCursor: 42 })).toBeNull();
});

test('revokes a session through W01 DELETE and lets the shared API client supply idempotency', async () => {
  await revokeSession('session/other');

  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/auth/sessions/session%2Fother');
  expect(calls[0].options.method).toBe('DELETE');
  expect(calls[0].options.idempotencyKey).toBeUndefined();
});

test('rejects an empty or oversized session id before making a request', async () => {
  await expect(revokeSession(' ')).rejects.toThrow('valid session identifier');
  await expect(revokeSession('x'.repeat(129))).rejects.toThrow('valid session identifier');
  expect(calls).toHaveLength(0);
});

test('wires session management into Settings and keeps the active session protected', () => {
  const screen = readFileSync(resolve(process.cwd(), 'app/(drawer)/sessions.tsx'), 'utf8');
  const settings = readFileSync(resolve(process.cwd(), 'app/(drawer)/settings.tsx'), 'utf8');
  const drawer = readFileSync(resolve(process.cwd(), 'app/(drawer)/_layout.tsx'), 'utf8');

  expect(settings).toContain("router.push('/sessions' as never)");
  expect(drawer).toContain('name="sessions"');
  expect(screen).toContain('fetchSessionListPage(');
  expect(screen).toContain('Alert.alert(');
  expect(screen).toContain('sessionId === currentSessionId');
  expect(screen).toContain('revokeSession(sessionId)');
  expect(screen).toContain("method: 'DELETE'");
  expect(screen).toContain("'/login?returnTo='");
  expect(screen).not.toContain('session.deviceId}</Text>');
});
