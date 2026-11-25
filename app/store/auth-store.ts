import { create } from 'zustand';

import { apiRequest, clearPendingMutationKeys, getApiErrorMessage, registerUnauthorizedSessionHandler } from '../lib/api-client';
import {
  activateStoredAccount,
  assertStoredAccountCapacity,
  clearActiveAccountSelection,
  clearStoredSession,
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
import { unregisterPushEndpointForUser } from '../lib/push-notifications';

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
      set({ status: 'anonymous', user: null, accounts: [] });
      return;
    }

    if (!token) {
      clearPendingMutationKeys();
      set({ status: 'anonymous', user: null, accounts });
      return;
    }

    // Migrate installations that still have the former single-session keys.
    // The credential is moved into the account-specific SecureStore slot.
    const activeAccountId = await getActiveStoredAccountId();
    if (cachedUser && (!activeAccountId || !accounts.some((account) => account.id === activeAccountId))) {
      try {
        await saveAccountSession(cachedUser, token);
        accounts = await listStoredAccounts();
      } catch {
        set({ status: 'anonymous', user: null, accounts });
        return;
      }
    }

    set({ status: 'authenticated', user: cachedUser, accounts });

    try {
      const { response, data } = await apiRequest<SessionPayload>('/auth/session', { method: 'GET' });
      if (response.status === 401) {
        const currentAccountId = await getActiveStoredAccountId();
        if (currentAccountId) await removeStoredAccount(currentAccountId);
        else await clearStoredSession();
        clearPendingMutationKeys();
        set({ status: 'anonymous', user: null, accounts: await listStoredAccounts() });
        return;
      }

      const user = (data as SessionPayload | null)?.data?.user;
      if (response.ok && validUser(user)) {
        if (cachedUser && cachedUser.id !== user.id) {
          throw new Error('The active session identity did not match its saved account.');
        }
        await saveCachedUser(user);
        set({ status: 'authenticated', user, accounts: await listStoredAccounts() });
      }
    } catch {
      // Keep the cached session candidate; protected APIs still enforce server authority.
      set({ status: 'authenticated', user: cachedUser, accounts: await listStoredAccounts() });
    }
  },

  login: async (identity, credential) => {
    authLifecycleGeneration += 1;
    const normalizedIdentity = identity.trim().toLowerCase();
    if (!normalizedIdentity || !credential) {
      throw new Error('Enter your email and password.');
    }

    await assertStoredAccountCapacity(normalizedIdentity);

    const { response, data } = await apiRequest<LoginPayload>('/auth/login', {
      method: 'POST',
      auth: false,
      idempotencyKey: false,
      // Assign the freshly-issued credential to its own account slot below.
      persistSessionCredential: false,
      body: JSON.stringify({ identity: normalizedIdentity, credential }),
    });

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
    if (previousAccountId && previousAccountId !== user.id) {
      await unregisterPushEndpointForUser(previousAccountId);
    }

    await saveAccountSession(user, token);
    clearPendingMutationKeys();
    set({ status: 'authenticated', user, accounts: await listStoredAccounts() });
  },

  switchAccount: async (userId) => {
    authLifecycleGeneration += 1;
    const previousAccountId = await getActiveStoredAccountId();
    const previousUser = get().user;
    if (previousAccountId === userId && previousUser?.id === userId) return;

    // The endpoint registry has one row per Expo token. Remove the previous
    // account's endpoint before the next account registers the same device token.
    if (previousAccountId) {
      await unregisterPushEndpointForUser(previousAccountId);
    }

    set({ status: 'loading', user: null });
    try {
      await activateStoredAccount(userId);
      clearPendingMutationKeys();

      const { response, data } = await apiRequest<SessionPayload>('/auth/session', { method: 'GET' });
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
      set({ status: 'authenticated', user, accounts: await listStoredAccounts() });
    } catch (cause) {
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
      clearPendingMutationKeys();
      set({
        status: restoredUser ? 'authenticated' : 'anonymous',
        user: restoredUser,
        accounts: await listStoredAccounts().catch(() => []),
      });
      throw cause;
    }
  },

  removeAccount: async (userId) => {
    const activeAccountId = await getActiveStoredAccountId();
    if (activeAccountId === userId) {
      // Do not orphan a server-side endpoint after deleting its local session.
      await unregisterPushEndpointForUser(userId);
    }
    await removeStoredAccount(userId);
    const accounts = await listStoredAccounts();
    if (activeAccountId === userId) {
      clearPendingMutationKeys();
      set({ status: 'anonymous', user: null, accounts });
    } else {
      set({ accounts });
    }
  },

  logout: async () => {
    authLifecycleGeneration += 1;
    const currentUserId = get().user?.id;
    try {
      const token = await readSessionToken();
      if (token) {
        if (currentUserId) {
          await unregisterPushEndpointForUser(currentUserId).catch(() => undefined);
        }
        await apiRequest<unknown>('/auth/logout', { method: 'POST', idempotencyKey: false });
      }
    } finally {
      if (currentUserId) await removeStoredAccount(currentUserId);
      else await clearStoredSession();
      clearPendingMutationKeys();
      set({ status: 'anonymous', user: null, accounts: await listStoredAccounts() });
    }
  },

  invalidateSession: async (snapshot?: SessionCredentialSnapshot) => {
    const generation = authLifecycleGeneration;
    if (snapshot) {
      // A delayed 401 may only invalidate the exact credential that initiated it.
      const current = await readSessionCredentialSnapshot();
      if (generation !== authLifecycleGeneration || current.accountId !== snapshot.accountId || current.token !== snapshot.token) return;
      if (snapshot.accountId) await removeStoredAccount(snapshot.accountId);
      else await clearStoredSession();
      const activeAccountId = await getActiveStoredAccountId();
      if (generation !== authLifecycleGeneration || activeAccountId !== snapshot.accountId) return;
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
registerUnauthorizedSessionHandler((snapshot) => useAuthStore.getState().invalidateSession(snapshot));
