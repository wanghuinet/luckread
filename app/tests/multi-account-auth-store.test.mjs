import { beforeEach, expect, mock, test } from 'bun:test';

const storedAccounts = new Map();
const storedTokens = new Map();
let activeAccountId = null;
let rejectSessionFor = null;
const sessionRequests = [];
const loginRequests = [];
const pushUnregisterCalls = [];
let failPushUnregisterFor = null;
let unauthorizedHandler = null;

const userFromEmail = (email) => ({
  id: 'user-' + email.toLowerCase(),
  email: email.toLowerCase(),
  name: email.split('@')[0],
  emailVerified: true,
  image: null,
});

const secureSessionMock = {
  MAX_STORED_ACCOUNTS: 5,
  listStoredAccounts: async () => [...storedAccounts.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt),
  getActiveStoredAccountId: async () => activeAccountId,
  readSessionCredentialSnapshot: async () => ({ accountId: activeAccountId, token: activeAccountId ? storedTokens.get(activeAccountId) ?? null : null }),
  readSessionToken: async () => activeAccountId ? storedTokens.get(activeAccountId) ?? null : null,
  readCachedUser: async () => activeAccountId ? storedAccounts.get(activeAccountId) ?? null : null,
  assertStoredAccountCapacity: async (identity) => {
    const existing = [...storedAccounts.values()].some((account) => account.email === identity.toLowerCase());
    if (storedAccounts.size >= 5 && !existing) throw new Error('此设备最多保存 5 个 LuckRead 账号。');
  },
  saveAccountSession: async (user, token) => {
    const existing = [...storedAccounts.values()].find((account) =>
      account.id === user.id || account.email === user.email
    );
    if (!existing && storedAccounts.size >= 5) throw new Error('此设备最多保存 5 个 LuckRead 账号。');
    if (existing && existing.id !== user.id) {
      storedAccounts.delete(existing.id);
      storedTokens.delete(existing.id);
    }
    storedAccounts.set(user.id, { ...user, lastUsedAt: Date.now() });
    storedTokens.set(user.id, token);
    activeAccountId = user.id;
  },
  activateStoredAccount: async (userId) => {
    if (!storedAccounts.has(userId) || !storedTokens.has(userId)) throw new Error('Account not available');
    const account = { ...storedAccounts.get(userId), lastUsedAt: Date.now() };
    storedAccounts.set(userId, account);
    activeAccountId = userId;
    return account;
  },
  removeStoredAccount: async (userId) => {
    storedAccounts.delete(userId);
    storedTokens.delete(userId);
    if (activeAccountId === userId) activeAccountId = null;
  },
  clearActiveAccountSelection: async () => { activeAccountId = null; },
  clearLegacySessionForSnapshot: async (snapshot) => {
    if (snapshot.accountId === null && activeAccountId === null && storedTokens.get('legacy') === snapshot.token) storedTokens.delete('legacy');
  },
  clearStoredSession: async () => {
    if (activeAccountId) {
      storedAccounts.delete(activeAccountId);
      storedTokens.delete(activeAccountId);
      activeAccountId = null;
    }
  },
  saveCachedUser: async (user) => {
    storedAccounts.set(user.id, { ...user, lastUsedAt: storedAccounts.get(user.id)?.lastUsedAt ?? Date.now() });
  },
};

mock.module('../lib/secure-session.ts', () => secureSessionMock);
mock.module('../lib/api-client.ts', () => ({
  clearPendingMutationKeys: () => undefined,
  registerUnauthorizedSessionHandler: (handler) => { unauthorizedHandler = handler; },
  getApiErrorMessage: (data, fallback) => data?.error?.message || fallback,
  apiRequest: async (path, options = {}) => {
    if (path === '/auth/login') {
      const email = JSON.parse(options.body).identity.toLowerCase();
      loginRequests.push(email);
      const user = userFromEmail(email);
      return {
        response: new Response(null, {
          status: 200,
          headers: { 'X-LuckRead-Session-Token': 'token-' + email },
        }),
        data: { data: { user } },
        error: null,
      };
    }
    if (path === '/auth/session') {
      sessionRequests.push({ accountId: activeAccountId, token: storedTokens.get(activeAccountId) });
      if (activeAccountId === rejectSessionFor) {
        const data = { error: { code: 'SESSION_EXPIRED', message: 'Session expired' } };
        return { response: new Response(JSON.stringify(data), { status: 401 }), data, error: { status: 401 } };
      }
      const user = storedAccounts.get(activeAccountId);
      const data = { data: { user } };
      return { response: new Response(JSON.stringify(data), { status: 200 }), data, error: null };
    }
    if (path === '/auth/logout') {
      return { response: new Response(null, { status: 204 }), data: null, error: null };
    }
    throw new Error('Unexpected API request: ' + path);
  },
}));
mock.module('../lib/push-notifications.ts', () => ({
  unregisterPushEndpointForUser: async (userId) => {
    pushUnregisterCalls.push({ userId, activeAccountId });
    if (failPushUnregisterFor === userId) {
      throw new Error('Push endpoint could not be unregistered');
    }
  },
}));

const { useAuthStore } = await import('../store/auth-store.ts');

beforeEach(() => {
  storedAccounts.clear();
  storedTokens.clear();
  activeAccountId = null;
  rejectSessionFor = null;
  sessionRequests.length = 0;
  loginRequests.length = 0;
  pushUnregisterCalls.length = 0;
  failPushUnregisterFor = null;
  useAuthStore.setState({ status: 'anonymous', user: null, accounts: [] });
});

test('login stores each new session separately and switching validates the selected server identity', async () => {
  await useAuthStore.getState().login('first@example.com', 'password-one');
  await useAuthStore.getState().login('second@example.com', 'password-two');

  expect(useAuthStore.getState().user?.email).toBe('second@example.com');
  expect(useAuthStore.getState().accounts).toHaveLength(2);
  expect(storedTokens.get('user-first@example.com')).toBe('token-first@example.com');
  expect(storedTokens.get('user-second@example.com')).toBe('token-second@example.com');
  expect(pushUnregisterCalls).toEqual([{
    userId: 'user-first@example.com',
    activeAccountId: 'user-first@example.com',
  }]);

  await useAuthStore.getState().switchAccount('user-first@example.com');
  expect(pushUnregisterCalls.at(-1)).toEqual({
    userId: 'user-second@example.com',
    activeAccountId: 'user-second@example.com',
  });
  expect(activeAccountId).toBe('user-first@example.com');
  expect(useAuthStore.getState().user?.email).toBe('first@example.com');
  expect(sessionRequests.at(-1)).toEqual({
    accountId: 'user-first@example.com',
    token: 'token-first@example.com',
  });
});

test('does not switch accounts when the current push endpoint cannot be released', async () => {
  await useAuthStore.getState().login('first@example.com', 'password-one');
  await useAuthStore.getState().login('second@example.com', 'password-two');
  failPushUnregisterFor = 'user-second@example.com';
  const previousSessionRequestCount = sessionRequests.length;

  await expect(
    useAuthStore.getState().switchAccount('user-first@example.com'),
  ).rejects.toThrow('Push endpoint could not be unregistered');

  expect(activeAccountId).toBe('user-second@example.com');
  expect(useAuthStore.getState().status).toBe('authenticated');
  expect(useAuthStore.getState().user?.id).toBe('user-second@example.com');
  expect(sessionRequests).toHaveLength(previousSessionRequestCount);
});

test('refuses a sixth distinct account before making a login request', async () => {
  for (let index = 1; index <= 5; index += 1) {
    await useAuthStore.getState().login('reader' + index + '@example.com', 'password-' + index);
  }

  await expect(
    useAuthStore.getState().login('reader6@example.com', 'password-six'),
  ).rejects.toThrow('最多保存 5 个');
  expect(loginRequests).toHaveLength(5);
  expect(useAuthStore.getState().accounts).toHaveLength(5);
});

test('failed account validation restores the previously active account and its credential', async () => {
  await useAuthStore.getState().login('first@example.com', 'password-one');
  await useAuthStore.getState().login('second@example.com', 'password-two');
  await useAuthStore.getState().switchAccount('user-first@example.com');
  rejectSessionFor = 'user-second@example.com';

  await expect(
    useAuthStore.getState().switchAccount('user-second@example.com'),
  ).rejects.toMatchObject({ status: 401 });

  expect(activeAccountId).toBe('user-first@example.com');
  expect(useAuthStore.getState().status).toBe('authenticated');
  expect(useAuthStore.getState().user?.email).toBe('first@example.com');
  expect(storedTokens.get('user-first@example.com')).toBe('token-first@example.com');
});

test('late 401 from a previous account cannot invalidate the newly active account', async () => {
  await useAuthStore.getState().login('first@example.com', 'password-one');
  const staleSnapshot = { accountId: activeAccountId, token: storedTokens.get(activeAccountId) };
  await useAuthStore.getState().login('second@example.com', 'password-two');
  await unauthorizedHandler(staleSnapshot);
  expect(activeAccountId).toBe('user-second@example.com');
  expect(useAuthStore.getState().status).toBe('authenticated');
  expect(useAuthStore.getState().user?.id).toBe('user-second@example.com');
  expect(storedTokens.has('user-first@example.com')).toBe(true);
  expect(storedTokens.has('user-second@example.com')).toBe(true);
});

test('401 for the currently active credential invalidates only that account', async () => {
  await useAuthStore.getState().login('first@example.com', 'password-one');
  const snapshot = { accountId: activeAccountId, token: storedTokens.get(activeAccountId) };
  await unauthorizedHandler(snapshot);
  expect(activeAccountId).toBeNull();
  expect(useAuthStore.getState().status).toBe('anonymous');
  expect(storedTokens.has('user-first@example.com')).toBe(false);
});

test('removing the active account leaves other saved accounts intact and signs out only the active slot', async () => {
  await useAuthStore.getState().login('first@example.com', 'password-one');
  await useAuthStore.getState().login('second@example.com', 'password-two');

  await useAuthStore.getState().removeAccount('user-second@example.com');

  expect(pushUnregisterCalls.at(-1)).toEqual({
    userId: 'user-second@example.com',
    activeAccountId: 'user-second@example.com',
  });
  expect(activeAccountId).toBeNull();
  expect(useAuthStore.getState().status).toBe('anonymous');
  expect(useAuthStore.getState().user).toBeNull();
  expect(useAuthStore.getState().accounts.map((account) => account.id)).toEqual(['user-first@example.com']);
  expect(storedTokens.has('user-first@example.com')).toBe(true);
  expect(storedTokens.has('user-second@example.com')).toBe(false);
});
