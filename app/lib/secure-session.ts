import * as SecureStore from 'expo-secure-store';

export type LuckReadUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
};

export type StoredLuckReadAccount = LuckReadUser & {
  lastUsedAt: number;
};

export const MAX_STORED_ACCOUNTS = 5;

const LEGACY_TOKEN_KEY = 'luckread.native.session-token';
const LEGACY_USER_KEY = 'luckread.native.public-user';
const ACCOUNTS_KEY = 'luckread.native.accounts.v1';
const ACTIVE_ACCOUNT_KEY = 'luckread.native.active-account-id';
const ACCOUNT_TOKEN_PREFIX = 'luckread.native.account-session-token.';

function accountTokenKey(userId: string): string {
  return ACCOUNT_TOKEN_PREFIX + encodeURIComponent(userId);
}

function normalizeUser(value: unknown): LuckReadUser | null {
  if (!value || typeof value !== 'object') return null;
  const user = value as Partial<LuckReadUser>;
  if (
    typeof user.id !== 'string' ||
    !user.id.trim() ||
    typeof user.email !== 'string' ||
    !user.email.trim() ||
    typeof user.emailVerified !== 'boolean'
  ) return null;

  return {
    id: user.id,
    email: user.email,
    name: typeof user.name === 'string' ? user.name : null,
    emailVerified: user.emailVerified,
    image: typeof user.image === 'string' ? user.image : null,
  };
}

async function readAccountIndex(): Promise<StoredLuckReadAccount[]> {
  const raw = await SecureStore.getItemAsync(ACCOUNTS_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    const records = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { accounts?: unknown }).accounts)
        ? (parsed as { accounts: unknown[] }).accounts
        : [];
    const deduplicated = new Map<string, StoredLuckReadAccount>();

    for (const record of records) {
      const user = normalizeUser(record);
      if (!user) continue;
      const lastUsedAt = record && typeof record === 'object' &&
        typeof (record as { lastUsedAt?: unknown }).lastUsedAt === 'number' &&
        Number.isFinite((record as { lastUsedAt: number }).lastUsedAt)
        ? (record as { lastUsedAt: number }).lastUsedAt
        : 0;
      deduplicated.set(user.id, { ...user, lastUsedAt });
    }

    return [...deduplicated.values()]
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      .slice(0, MAX_STORED_ACCOUNTS);
  } catch {
    return [];
  }
}

async function writeAccountIndex(accounts: StoredLuckReadAccount[]): Promise<void> {
  await SecureStore.setItemAsync(
    ACCOUNTS_KEY,
    JSON.stringify(accounts.slice(0, MAX_STORED_ACCOUNTS)),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED },
  );
}


let secureSessionMutationQueue: Promise<void> = Promise.resolve();
function runSecureSessionMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = secureSessionMutationQueue.then(operation, operation);
  secureSessionMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase();
}

export async function listStoredAccounts(): Promise<StoredLuckReadAccount[]> {
  return readAccountIndex();
}

export async function getActiveStoredAccountId(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTIVE_ACCOUNT_KEY);
}

/**
 * Fail before contacting the login endpoint when a sixth, distinct account
 * cannot be stored. Existing accounts can always refresh their own session.
 */
export async function assertStoredAccountCapacity(identity: string): Promise<void> {
  const accounts = await readAccountIndex();
  if (accounts.length < MAX_STORED_ACCOUNTS) return;

  const candidate = normalizedIdentity(identity);
  if (accounts.some((account) => normalizedIdentity(account.email) === candidate)) return;

  throw new Error('此设备最多保存 5 个 LuckRead 账号。请先移除一个账号，再添加新账号。');
}

/**
 * Store each opaque session token under its own platform-protected key.
 * The index contains public profile data only and never contains credentials.
 */
async function saveAccountSessionUnlocked(userValue: LuckReadUser, token: string): Promise<void> {
  const user = normalizeUser(userValue);
  if (!user) throw new Error('The sign-in response did not contain a valid user.');
  if (!token || !token.trim()) throw new Error('The session response did not contain a usable credential.');

  const accounts = await readAccountIndex();
  const existing = accounts.find((account =>
    account.id === user.id || normalizedIdentity(account.email) === normalizedIdentity(user.email)
  ));
  if (!existing && accounts.length >= MAX_STORED_ACCOUNTS) {
    throw new Error('此设备最多保存 5 个 LuckRead 账号。请先移除一个账号，再添加新账号。');
  }

  const nextAccount: StoredLuckReadAccount = { ...user, lastUsedAt: Date.now() };
  const nextAccounts = [
    nextAccount,
    ...accounts.filter((account) =>
      account.id !== user.id &&
      normalizedIdentity(account.email) !== normalizedIdentity(user.email)
    ),
  ].slice(0, MAX_STORED_ACCOUNTS);

  await SecureStore.setItemAsync(accountTokenKey(user.id), token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
  await writeAccountIndex(nextAccounts);
  await SecureStore.setItemAsync(ACTIVE_ACCOUNT_KEY, user.id, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });

  if (existing && existing.id !== user.id) {
    await SecureStore.deleteItemAsync(accountTokenKey(existing.id));
  }
  await Promise.all([
    SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
    SecureStore.deleteItemAsync(LEGACY_USER_KEY),
  ]);
}

/** Activate a saved account only after confirming its credential still exists. */
async function activateStoredAccountUnlocked(userId: string): Promise<StoredLuckReadAccount> {
  const accounts = await readAccountIndex();
  const account = accounts.find((item) => item.id === userId);
  if (!account) throw new Error('这个账号已从此设备移除，请重新登录。');

  const token = await SecureStore.getItemAsync(accountTokenKey(userId));
  if (!token) throw new Error('这个账号的登录凭证已失效，请重新登录。');

  const activated = { ...account, lastUsedAt: Date.now() };
  await writeAccountIndex([
    activated,
    ...accounts.filter((item) => item.id !== userId),
  ]);
  await SecureStore.setItemAsync(ACTIVE_ACCOUNT_KEY, userId, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
  await Promise.all([
    SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
    SecureStore.deleteItemAsync(LEGACY_USER_KEY),
  ]);
  return activated;
}

/** Remove only the selected account from this device; other credentials remain intact. */
async function removeStoredAccountUnlocked(userId: string): Promise<void> {
  const accounts = await readAccountIndex();
  await SecureStore.deleteItemAsync(accountTokenKey(userId));
  await writeAccountIndex(accounts.filter((account) => account.id !== userId));

  if (await getActiveStoredAccountId() === userId) {
    await SecureStore.deleteItemAsync(ACTIVE_ACCOUNT_KEY);
  }
}

async function clearActiveAccountSelectionUnlocked(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_ACCOUNT_KEY);
  await Promise.all([
    SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
    SecureStore.deleteItemAsync(LEGACY_USER_KEY),
  ]);
}

export type SessionCredentialSnapshot = {
  accountId: string | null;
  token: string | null;
};

/** Capture account identity and credential together so in-flight responses cannot cross account slots. */
export async function readSessionCredentialSnapshot(): Promise<SessionCredentialSnapshot> {
  const accountId = await getActiveStoredAccountId();
  const token = accountId
    ? await SecureStore.getItemAsync(accountTokenKey(accountId))
    : await SecureStore.getItemAsync(LEGACY_TOKEN_KEY);
  return { accountId, token };
}

export async function readSessionToken(): Promise<string | null> {
  const activeAccountId = await getActiveStoredAccountId();
  if (activeAccountId) {
    return SecureStore.getItemAsync(accountTokenKey(activeAccountId));
  }
  return SecureStore.getItemAsync(LEGACY_TOKEN_KEY);
}

export async function readCachedUser(): Promise<LuckReadUser | null> {
  const activeAccountId = await getActiveStoredAccountId();
  if (activeAccountId) {
    const account = (await readAccountIndex()).find((item) => item.id === activeAccountId);
    return account ? normalizeUser(account) : null;
  }

  const value = await SecureStore.getItemAsync(LEGACY_USER_KEY);
  if (!value) return null;
  try {
    return normalizeUser(JSON.parse(value));
  } catch {
    return null;
  }
}

/** Persist a renewal to the account that initiated the request, never the newly active account. */
async function saveSessionTokenForSnapshotUnlocked(
  token: string,
  snapshot: SessionCredentialSnapshot,
): Promise<void> {
  if (!token.trim()) throw new Error('The session response did not contain a usable credential.');
  const currentActiveId = await getActiveStoredAccountId();
  if (currentActiveId !== snapshot.accountId) return;

  if (snapshot.accountId) {
    const accounts = await readAccountIndex();
    if (!accounts.some((account) => account.id === snapshot.accountId)) return;
    await SecureStore.setItemAsync(accountTokenKey(snapshot.accountId), token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
    return;
  }
  await SecureStore.setItemAsync(LEGACY_TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

/** API session-renewal responses update only the currently active account. */
async function saveSessionTokenUnlocked(token: string): Promise<void> {
  if (!token.trim()) throw new Error('The session response did not contain a usable credential.');
  const activeAccountId = await getActiveStoredAccountId();
  await SecureStore.setItemAsync(
    activeAccountId ? accountTokenKey(activeAccountId) : LEGACY_TOKEN_KEY,
    token,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED },
  );
}

async function saveCachedUserUnlocked(userValue: LuckReadUser): Promise<void> {
  const user = normalizeUser(userValue);
  if (!user) throw new Error('Cannot cache an invalid LuckRead user.');

  const activeAccountId = await getActiveStoredAccountId();
  if (!activeAccountId) {
    await SecureStore.setItemAsync(LEGACY_USER_KEY, JSON.stringify(user), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED,
    });
    return;
  }

  const accounts = await readAccountIndex();
  const existing = accounts.find((account) => account.id === activeAccountId);
  const nextAccount: StoredLuckReadAccount = {
    ...user,
    lastUsedAt: existing?.lastUsedAt ?? Date.now(),
  };
  await writeAccountIndex([
    nextAccount,
    ...accounts.filter((account) => account.id !== activeAccountId),
  ]);
}

/** Backward-compatible cleanup for the legacy single-session auth store. */
async function clearLegacySessionForSnapshotUnlocked(snapshot: SessionCredentialSnapshot): Promise<void> {
  if (snapshot.accountId !== null || await getActiveStoredAccountId() !== null) return;
  if (await SecureStore.getItemAsync(LEGACY_TOKEN_KEY) !== snapshot.token) return;
  // Delete only legacy slots; never clear ACTIVE_ACCOUNT_KEY, which may now
  // belong to an account activated while this old request was in flight.
  await Promise.all([
    SecureStore.deleteItemAsync(LEGACY_TOKEN_KEY),
    SecureStore.deleteItemAsync(LEGACY_USER_KEY),
  ]);
}


export async function saveAccountSession(userValue: LuckReadUser, token: string): Promise<void> { return runSecureSessionMutation(() => saveAccountSessionUnlocked(userValue, token)); }
export async function activateStoredAccount(userId: string): Promise<StoredLuckReadAccount> { return runSecureSessionMutation(() => activateStoredAccountUnlocked(userId)); }
export async function removeStoredAccount(userId: string): Promise<void> { return runSecureSessionMutation(() => removeStoredAccountUnlocked(userId)); }
export async function clearActiveAccountSelection(): Promise<void> { return runSecureSessionMutation(() => clearActiveAccountSelectionUnlocked()); }
export async function saveSessionTokenForSnapshot(token: string, snapshot: SessionCredentialSnapshot): Promise<void> { return runSecureSessionMutation(() => saveSessionTokenForSnapshotUnlocked(token, snapshot)); }
export async function saveSessionToken(token: string): Promise<void> { return runSecureSessionMutation(() => saveSessionTokenUnlocked(token)); }
export async function saveCachedUser(userValue: LuckReadUser): Promise<void> { return runSecureSessionMutation(() => saveCachedUserUnlocked(userValue)); }

async function clearStoredSessionUnlocked(): Promise<void> {
  const activeAccountId = await getActiveStoredAccountId();
  if (activeAccountId) await removeStoredAccountUnlocked(activeAccountId);
  await clearActiveAccountSelectionUnlocked();
}
export async function clearStoredSession(): Promise<void> { return runSecureSessionMutation(() => clearStoredSessionUnlocked()); }
export async function clearLegacySessionForSnapshot(snapshot: SessionCredentialSnapshot): Promise<void> { return runSecureSessionMutation(() => clearLegacySessionForSnapshotUnlocked(snapshot)); }
