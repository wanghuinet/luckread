import { create } from 'zustand';

import { apiRequest, getApiErrorMessage } from '../lib/api-client';
import {
  clearStoredSession,
  readCachedUser,
  readSessionToken,
  saveCachedUser,
  saveSessionToken,
  type LuckReadUser,
} from '../lib/secure-session';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

type AuthStore = {
  status: AuthStatus;
  user: LuckReadUser | null;
  bootstrap: () => Promise<void>;
  login: (identity: string, credential: string) => Promise<void>;
  logout: () => Promise<void>;
  invalidateSession: () => Promise<void>;
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

const validUser = (value: unknown): value is LuckReadUser => {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<LuckReadUser>;
  return (
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.emailVerified === 'boolean'
  );
};

export const useAuthStore = create<AuthStore>((set) => ({
  status: 'loading',
  user: null,

  bootstrap: async () => {
    let token: string | null = null;
    let cachedUser: LuckReadUser | null = null;
    try {
      [token, cachedUser] = await Promise.all([readSessionToken(), readCachedUser()]);
    } catch {
      set({ status: 'anonymous', user: null });
      return;
    }
    if (!token) {
      set({ status: 'anonymous', user: null });
      return;
    }

    // A cached identity keeps the app usable during a temporary network outage.
    // The server remains authoritative for every protected operation.
    set({ status: 'authenticated', user: cachedUser });

    try {
      const { response, data } = await apiRequest<SessionPayload>('/auth/session', { method: 'GET' });
      if (response.status === 401) {
        await clearStoredSession();
        set({ status: 'anonymous', user: null });
        return;
      }

      const user = (data as SessionPayload | null)?.data?.user;
      if (response.ok && validUser(user)) {
        await saveCachedUser(user);
        set({ status: 'authenticated', user });
      }
    } catch {
      // Keep the cached session candidate; protected APIs will reject stale credentials.
      set({ status: 'authenticated', user: cachedUser });
    }
  },

  login: async (identity, credential) => {
    const normalizedIdentity = identity.trim().toLowerCase();
    if (!normalizedIdentity || !credential) {
      throw new Error('Enter your email and password.');
    }

    const { response, data } = await apiRequest<LoginPayload>('/auth/login', {
      method: 'POST',
      auth: false,
      idempotencyKey: false,
      body: JSON.stringify({ identity: normalizedIdentity, credential }),
    });

    const payload = data as LoginPayload | null;
    const user = payload?.data?.user;
    if (!response.ok) {
      throw new Error(getApiErrorMessage(data, 'Unable to sign in. Please try again.', response.status));
    }
    if (!validUser(user)) {
      throw new Error('The sign-in response was incomplete. Please try again.');
    }

    // W01 delivers the opaque native credential in a response header, not JSON.
    const token = await readSessionToken();
    if (!token) {
      throw new Error('Sign-in succeeded without a native session credential.');
    }
    await saveCachedUser(user);
    set({ status: 'authenticated', user });
  },

  logout: async () => {
    try {
      const token = await readSessionToken();
      if (token) {
        await apiRequest<unknown>('/auth/logout', { method: 'POST', idempotencyKey: false });
      }
    } finally {
      await clearStoredSession();
      set({ status: 'anonymous', user: null });
    }
  },

  invalidateSession: async () => {
    await clearStoredSession();
    set({ status: 'anonymous', user: null });
  },
}));
