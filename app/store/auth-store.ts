import { create } from 'zustand';

import { apiRequest, clearPendingMutationKeys, getApiErrorMessage, registerUnauthorizedSessionHandler } from '../lib/api-client';
import {
  activateStoredAccount,
  assertStoredAccountCapacity,
  clearActiveAccountSelection,
  clearStoredSession,
  clearLegacySessionForSnapshot,
  getActiveStoredAccountId,
  listStoredAccounts,
  readCachedUser,
  readSessionToken,
  readSessionCredentialSnapshot,
  removeStoredAccount,
  saveAccountSession,
  saveCachedUser,
  type LuckReadUser,
  type StoredLuckReadAccount,
  type SessionCredentialSnapshot,
} from '../lib/secure-session';
import { syncPushEndpointForAuthenticatedUser, unregisterPushEndpointForUser } from '../lib/push-notifications';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export class AuthStoreError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AuthStoreError';
    this.status = status;
    this.code = code;
  }
}

const readAuthErrorCode = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || !('error' in value)) return undefined;
  const nested = (value as { error?: { code?: unknown } }).error;
  return typeof nested?.code === 'string' ? nested.code.toUpperCase() : undefined;
};

type AuthStore = {
  status: AuthStatus;
  user: LuckReadUser | null;
  accounts: StoredLuckReadAccount[];
  bootstrap: () => Promise<void>;
  login: (identity: string, credential: string) => Promise<void>;
  switchAccount: (userId: string) => Promise<void>;
  removeAccount: (userId: string) => Promise<void>;
  logout: () => Promise<void>;
  invalidateSession: (snapshot?: SessionCredentialSnapshot) => Promise<void>;
};

type LoginPayload = {
  data?: {
    user?: LuckReadUser;
  };
};

type SessionPayload = {
  data?: {
    session?: {
      id?: string;
      expiresAt?: string;
    };
    user?: LuckReadUser;
  };
};

let authLifecycleGeneration = 0;

const validUser = (value: unknown): value is LuckReadUser => {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<LuckReadUser>;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.emailVerified === 'boolean'
  );
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  status: 'loading',
  user: null,
  accounts: [],

  bootstrap: async () => {
    const generation = authLifecycleGeneration;
    let token: string | null = null;
    let cachedUser: LuckReadUser | null = null;
    let accounts: StoredLuckReadAccount[] = [];
    try {
      [token, cachedUser, accounts] = await Promise.all([
        readSessionToken(),
        readCachedUser(),
        listStoredAccounts(),
      ]);
    } catch {
      if (generation === authLifecycleGeneration) set({ status: 'anonymous', user: null, accounts: [] });
      return;
    }

    if (generation !== authLifecycleGeneration) return;

    if (!token) {
      clearPendingMutationKeys();
      set({ status: 'anonymous', user: null, accounts });
      return;
    }

    // Migrate installations that still have the former single-session keys.
    // The credential is moved into the account-specific SecureStore slot.
    const activeAccountId = await getActiveStoredAccountId();
    if (generation !== authLifecycleGeneration) return;
    if (cachedUser && (!activeAccountId || !accounts.some((account) => account.id === activeAccountId))) {
      try {
        await saveAccountSession(cachedUser, token);
        if (generation !== authLifecycleGeneration) return;
        accounts = await listStoredAccounts();
      } catch {
        if (generation === authLifecycleGeneration) set({ status: 'anonymous', user: null, accounts });
        return;
      }
    }

    if (generation !== authLifecycleGeneration) return;
    set({ status: 'authenticated', user: cachedUser, accounts });

    try {
      const { response, data } = await apiRequest<SessionPayload>('/auth/session', { method: 'GET' });
      if (generation !== authLifecycleGeneration) return;
      if (response.status === 401) {
        // apiRequest has already delivered this 401 with its initiating
        // credential snapshot. Do not inspect/remove the current account here:
        // the user may have switched accounts while bootstrap was in flight.
        return;
      }

      const user = (data as SessionPayload | null)?.data?.user;
      if (response.ok && validUser(user)) {
        if (cachedUser && cachedUser.id !== user.id) {
          throw new Error('The active session identity did not match its saved account.');
        }
        await saveCachedUser(user);
        if (generation !== authLifecycleGeneration) return;
        const refreshedAccounts = await listStoredAccounts();
        if (generation !== authLifecycleGeneration) return;
        set({ status: 'authenticated', user, accounts: refreshedAccounts });
      }
    } catch {
      // Keep the cached session candidate; protected APIs still enforce server authority.
      if (generation !== authLifecycleGeneration) return;
      const refreshedAccounts = await listStoredAccounts();
      if (generation !== authLifecycleGeneration) return;
      set({ status: 'authenticated', user: cachedUser, accounts: refreshedAccounts });
    }
  },

  login: async (identity, credential) => {
    authLifecycleGeneration += 1;
    const generation = authLifecycleGeneration;
    const normalizedIdentity = identity.trim().toLowerCase();
    if (!normalizedIdentity || !credential) {
      throw new Error('Enter your email and password.');
    }

    await assertStoredAccountCapacity(normalizedIdentity);
    if (generation !== authLifecycleGeneration) return;

    const { response, data } = await apiRequest<LoginPayload>('/auth/login', {
      method: 'POST',
      auth: false,
      idempotencyKey: false,
      // Assign the freshly-issued credential to its own account slot below.
      persistSessionCredential: false,
      body: JSON.stringify({ identity: normalizedIdentity, credential }),
    });
    if (generation !== authLifecycleGeneration) return;

    const payload = data as LoginPayload | null;
    const user = payload?.data?.user;
    if (!response.ok) {
      throw new AuthStoreError(
        getApiErrorMessage(data, '无法登录，请检查邮箱和密码后重试。', response.status),
        response.status,
        readAuthErrorCode(data),
      );
    }
    if (!validUser(user)) {
      throw new Error('The sign-in response was incomplete. Please try again.');
    }

    const token = response.headers.get('X-LuckRead-Session-Token');
    if (!token) {
      throw new Error('Sign-in succeeded without a native session credential.');
    }

    // Only the active account owns this device's Expo token. Release the old
    // endpoint while its credential is still active before activating a new account.
    const previousAccountId = await getActiveStoredAccountId();
    if (generation !== authLifecycleGeneration) return;
    if (previousAccountId && previousAccountId !== user.id) {
      await unregisterPushEndpointForUser(previousAccountId);
      if (generation !== authLifecycleGeneration) return;
    }

    await saveAccountSession(user, token);
    if (generation !== authLifecycleGeneration) return;
    clearPendingMutationKeys();
    const accounts = await listStoredAccounts();
    if (generation !== authLifecycleGeneration) return;
    set({ status: 'authenticated', user, accounts });
  },

  switchAccount: async (userId) => {
    authLifecycleGeneration += 1;
    const generation = authLifecycleGeneration;
    const previousAccountId = await getActiveStoredAccountId();
    if (generation !== authLifecycleGeneration) return;
    const previousUser = get().user;
    if (previousAccountId === userId && previousUser?.id === userId) return;

    // The endpoint registry has one row per Expo token. Remove the previous
    // account's endpoint before the next account registers the same device token.
    if (previousAccountId) {
      await unregisterPushEndpointForUser(previousAccountId);
      if (generation !== authLifecycleGeneration) return;
    }

    set({ status: 'loading', user: null });
    try {
      await activateStoredAccount(userId);
      if (generation !== authLifecycleGeneration) return;
      clearPendingMutationKeys();

      const { response, data } = await apiRequest<SessionPayload>('/auth/session', { method: 'GET' });
      if (generation !== authLifecycleGeneration) return;
      const user = (data as SessionPayload | null)?.data?.user;
      if (response.status === 401) {
        throw new AuthStoreError('这个账号的登录状态已失效，请重新登录。', 401, 'SESSION_EXPIRED');
      }
      if (!response.ok) {
        throw new AuthStoreError(
          getApiErrorMessage(data, '切换账号暂时无法完成，请稍后重试。', response.status),
          response.status,
          readAuthErrorCode(data),
        );
      }
      if (!validUser(user) || user.id !== userId) {
        throw new AuthStoreError('服务器返回的账号身份与所选账号不一致。', 401, 'SESSION_IDENTITY_MISMATCH');
      }

      await saveCachedUser(user);
      if (generation !== authLifecycleGeneration) return;
      const accounts = await listStoredAccounts();
      if (generation !== authLifecycleGeneration) return;
      set({ status: 'authenticated', user, accounts });
    } catch (cause) {
      if (generation !== authLifecycleGeneration) throw cause;
      let restoredUser: LuckReadUser | null = null;
      if (previousAccountId) {
        try {
          await activateStoredAccount(previousAccountId);
          restoredUser = await readCachedUser();
        } catch {
          await clearActiveAccountSelection().catch(() => undefined);
        }
      } else {
        await clearActiveAccountSelection().catch(() => undefined);
      }
      if (generation !== authLifecycleGeneration) throw cause;
      // Best-effort push endpoint recovery for the restored account. This reconciliation never prompts for permission.\n      if (restoredUser && previousAccountId) {\n        await syncPushEndpointForAuthenticatedUser(previousAccountId).catch(() => undefined);\n        if (generation !== authLifecycleGeneration) throw cause;\n      }\n      clearPendingMutationKeys();\n      set({\n        status: restoredUser ? 'authenticated' : 'anonymous',\n        user: restoredUser,\n        accounts: await listStoredAccounts().catch(() => []),\n      });\n      throw cause;
    }
  },

  removeAccount: async (userId) => {
    authLifecycleGeneration += 1;
    const generation = authLifecycleGeneration;
    const activeAccountId = await getActiveStoredAccountId();
    if (generation !== authLifecycleGeneration) return;
    if (activeAccountId === userId) {
      // Do not orphan a server-side endpoint after deleting its local session.
      await unregisterPushEndpointForUser(userId);
      if (generation !== authLifecycleGeneration) return;
    }
    await removeStoredAccount(userId);
    if (generation !== authLifecycleGeneration) return;
    const accounts = await listStoredAccounts();
    if (generation !== authLifecycleGeneration) return;
    if (activeAccountId === userId) {
      clearPendingMutationKeys();
      set({ status: 'anonymous', user: null, accounts });
    } else {
      set({ accounts });
    }
  },

  logout: async () => {
    authLifecycleGeneration += 1;
    const generation = authLifecycleGeneration;
    const currentUserId = get().user?.id;
    try {
      const token = await readSessionToken();
      if (generation !== authLifecycleGeneration) return;
      if (token) {
        if (currentUserId) {
          await unregisterPushEndpointForUser(currentUserId).catch(() => undefined);
          if (generation !== authLifecycleGeneration) return;
        }
        await apiRequest<unknown>('/auth/logout', { method: 'POST', idempotencyKey: false });
        if (generation !== authLifecycleGeneration) return;
      }
    } finally {
      // A newer login, switch or lifecycle action owns the store now.
      if (generation !== authLifecycleGeneration) return;
      if (currentUserId) await removeStoredAccount(currentUserId);
      else await clearStoredSession();
      if (generation !== authLifecycleGeneration) return;
      clearPendingMutationKeys();
      const accounts = await listStoredAccounts();
      if (generation !== authLifecycleGeneration) return;
      set({ status: 'anonymous', user: null, accounts });
    }
  },

  invalidateSession: async (snapshot?: SessionCredentialSnapshot) => {
    const generation = authLifecycleGeneration;
    if (snapshot) {
      // A delayed 401 may only invalidate the exact credential that initiated it.
      const current = await readSessionCredentialSnapshot();
      if (generation !== authLifecycleGeneration || current.accountId !== snapshot.accountId || current.token !== snapshot.token) return;
      if (snapshot.accountId) await removeStoredAccount(snapshot.accountId);
      else await clearLegacySessionForSnapshot(snapshot);
      const activeAccountId = await getActiveStoredAccountId();
      if (generation !== authLifecycleGeneration || (activeAccountId !== null && activeAccountId !== snapshot.accountId)) return;
    } else {
      const activeAccountId = await getActiveStoredAccountId();
      if (activeAccountId) await removeStoredAccount(activeAccountId);
      else await clearStoredSession();
    }
    clearPendingMutationKeys();
    set({ status: 'anonymous', user: null, accounts: await listStoredAccounts() });
  },
}));


// All authenticated native API calls share the same account-scoped 401 boundary.
const pendingSessionInvalidations = new Map<string, Promise<void>>();

registerUnauthorizedSessionHandler((snapshot) => {
  const key = (snapshot.accountId ?? 'legacy') + '\u0000' + (snapshot.token ?? '');
  const existing = pendingSessionInvalidations.get(key);
  if (existing) return existing;
  const pending = Promise.resolve().then(() => useAuthStore.getState().invalidateSession(snapshot));
  const tracked = pending.finally(() => {
    if (pendingSessionInvalidations.get(key) === tracked) pendingSessionInvalidations.delete(key);
  });
  pendingSessionInvalidations.set(key, tracked);
  return tracked;
});
