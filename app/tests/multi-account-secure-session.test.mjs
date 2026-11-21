import { beforeEach, expect, mock, test } from 'bun:test';

const secureValues = new Map();

mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  getItemAsync: async (key) => secureValues.has(key) ? secureValues.get(key) : null,
  setItemAsync: async (key, value) => { secureValues.set(key, value); },
  deleteItemAsync: async (key) => { secureValues.delete(key); },
}));

const {
  MAX_STORED_ACCOUNTS,
  activateStoredAccount,
  assertStoredAccountCapacity,
  getActiveStoredAccountId,
  listStoredAccounts,
  readCachedUser,
  readSessionToken,
  removeStoredAccount,
  saveAccountSession,
  saveCachedUser,
  saveSessionToken,
} = await import('../lib/secure-session.ts');

const user = (id) => ({
  id,
  email: id + '@example.com',
  name: id,
  emailVerified: true,
  image: null,
});

beforeEach(() => {
  secureValues.clear();
});

test('stores up to five independent account credentials and activates only the selected one', async () => {
  expect(MAX_STORED_ACCOUNTS).toBe(5);
  for (let index = 1; index <= 5; index += 1) {
    await saveAccountSession(user('account-' + index), 'token-' + index);
  }

  expect((await listStoredAccounts()).map((account) => account.id)).toHaveLength(5);
  expect(await getActiveStoredAccountId()).toBe('account-5');
  expect(await readSessionToken()).toBe('token-5');

  await activateStoredAccount('account-2');
  expect(await readSessionToken()).toBe('token-2');
  expect((await readCachedUser()).id).toBe('account-2');
});

test('prevents adding a sixth distinct account before login and permits an existing account', async () => {
  for (let index = 1; index <= 5; index += 1) {
    await saveAccountSession(user('account-' + index), 'token-' + index);
  }

  await expect(assertStoredAccountCapacity('new-account@example.com')).rejects.toThrow('最多保存 5 个');
  await expect(saveAccountSession(user('account-6'), 'token-6')).rejects.toThrow('最多保存 5 个');
  await expect(assertStoredAccountCapacity('ACCOUNT-3@EXAMPLE.COM')).resolves.toBeUndefined();
  expect(await listStoredAccounts()).toHaveLength(5);
});

test('renews only the active account token and preserves the other account session', async () => {
  await saveAccountSession(user('first'), 'first-token');
  await saveAccountSession(user('second'), 'second-token');

  await activateStoredAccount('first');
  await saveSessionToken('first-renewed-token');
  await activateStoredAccount('second');

  expect(await readSessionToken()).toBe('second-token');
  await activateStoredAccount('first');
  expect(await readSessionToken()).toBe('first-renewed-token');
});

test('updates the active cached profile without crossing into another account', async () => {
  await saveAccountSession(user('first'), 'first-token');
  await saveAccountSession(user('second'), 'second-token');

  await activateStoredAccount('first');
  await saveCachedUser({ ...user('first'), name: 'Updated first' });
  await activateStoredAccount('second');

  expect((await readCachedUser()).name).toBe('second');
  await activateStoredAccount('first');
  expect((await readCachedUser()).name).toBe('Updated first');
});

test('removing the active account deletes only its credential and leaves other accounts recoverable', async () => {
  await saveAccountSession(user('first'), 'first-token');
  await saveAccountSession(user('second'), 'second-token');
  await activateStoredAccount('first');

  await removeStoredAccount('first');

  expect(await getActiveStoredAccountId()).toBeNull();
  expect(await readSessionToken()).toBeNull();
  expect((await listStoredAccounts()).map((account) => account.id)).toEqual(['second']);
  await activateStoredAccount('second');
  expect(await readSessionToken()).toBe('second-token');
});
