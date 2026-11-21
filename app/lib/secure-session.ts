import * as SecureStore from 'expo-secure-store';

export type LuckReadUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
};

const TOKEN_KEY = 'luckread.native.session-token';
const USER_KEY = 'luckread.native.public-user';

export async function readSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function readCachedUser(): Promise<LuckReadUser | null> {
  const value = await SecureStore.getItemAsync(USER_KEY);
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<LuckReadUser>;
    if (typeof parsed.id !== 'string' || typeof parsed.email !== 'string') return null;
    return {
      id: parsed.id,
      email: parsed.email,
      name: typeof parsed.name === 'string' ? parsed.name : null,
      emailVerified: parsed.emailVerified === true,
      image: typeof parsed.image === 'string' ? parsed.image : null,
    };
  } catch {
    return null;
  }
}

export async function saveSessionToken(token: string): Promise<void> {
  if (!token.trim()) throw new Error('The session response did not contain a usable credential.');
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function saveCachedUser(user: LuckReadUser): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function clearStoredSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}
