import * as SecureStore from 'expo-secure-store';

export const API_BASE_URL = process.env.EXPO_PUBLIC_LUCKREAD_API_URL || 'https://www.luckread.com';
const SESSION_KEY = 'luckread.native.session-token';

export type LuckReadUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
};

export type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
  requestId?: string;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<{ payload: T; response: Response }> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('网络连接失败，请检查网络后重试。', 0, 'NETWORK_ERROR');
  }

  const nextToken = response.headers.get('X-LuckRead-Session-Token');
  if (nextToken) await SecureStore.setItemAsync(SESSION_KEY, nextToken);

  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* handled as invalid response below */ }
  if (!response.ok) {
    const body = payload as ApiEnvelope<unknown> | null;
    throw new ApiError(body?.error?.message || `请求失败（${response.status}）`, response.status, body?.error?.code);
  }
  if (payload === null) throw new ApiError('服务器返回了无效响应。', response.status, 'INVALID_RESPONSE');
  return { payload: payload as T, response };
}

export async function login(identity: string, credential: string): Promise<LuckReadUser> {
  const { payload, response } = await request<ApiEnvelope<{ user: LuckReadUser }> & { data?: { user: LuckReadUser } }>(
    '/api/v1/auth/login',
    { method: 'POST', body: JSON.stringify({ identity: identity.trim().toLowerCase(), credential }) },
  );
  // The native credential is intentionally read only from this response header.
  const token = response.headers.get('X-LuckRead-Session-Token');
  if (!token) throw new ApiError('登录响应缺少原生会话凭据，请稍后重试。', 502, 'SESSION_TOKEN_MISSING');
  await SecureStore.setItemAsync(SESSION_KEY, token);
  const user = payload.data?.user;
  if (!user?.id || !user.email) throw new ApiError('登录响应格式不正确。', 502, 'INVALID_LOGIN_RESPONSE');
  return user;
}

export async function getCurrentSession(): Promise<LuckReadUser> {
  const token = await getSessionToken();
  if (!token) throw new ApiError('请先登录。', 401, 'UNAUTHENTICATED');
  const { payload } = await request<ApiEnvelope<{ user: LuckReadUser }>>('/api/v1/auth/session', { method: 'GET' }, token);
  const user = payload.data?.user;
  if (!user?.id) throw new ApiError('会话响应格式不正确。', 502, 'INVALID_SESSION_RESPONSE');
  return user;
}

export async function logout(): Promise<void> {
  const token = await getSessionToken();
  try {
    if (token) await request('/api/v1/auth/logout', { method: 'POST' }, token);
  } finally {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
}

export type FeedItem = {
  id: string;
  contentId?: string;
  title?: string;
  text?: string;
  content?: string;
  body?: string;
  message?: string;
  createdAt?: string;
  created_at?: string;
  publishedAt?: string;
  author?: { name?: string; username?: string; image?: string };
  authorName?: string;
  authorHandle?: string;
  authorImageUrl?: string;
  [key: string]: unknown;
};

export async function getFollowingFeed(cursor?: string): Promise<{ items: FeedItem[]; nextCursor?: string }> {
  const token = await getSessionToken();
  if (!token) throw new ApiError('请先登录。', 401, 'UNAUTHENTICATED');
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const { payload } = await request<unknown>(`/api/v1/feed/following?${query.toString()}`, { method: 'GET' }, token);
  const root = payload as any;
  const data = root?.data ?? root;
  const rawItems = Array.isArray(data) ? data : data?.items ?? data?.contents ?? data?.feed ?? data?.results;
  if (!Array.isArray(rawItems)) throw new ApiError('信息流响应格式暂不受移动端支持。', 502, 'INVALID_FEED_RESPONSE');
  const items: FeedItem[] = rawItems.map((item: any, index: number) => ({
    ...item,
    id: String(item?.id ?? item?.contentId ?? item?.content_id ?? `feed-${index}`),
    contentId: String(item?.contentId ?? item?.content_id ?? item?.id ?? ''),
  }));
  const nextCursor = data?.nextCursor ?? data?.next_cursor ?? data?.pagination?.nextCursor ?? data?.pagination?.next_cursor;
  return { items, nextCursor: typeof nextCursor === 'string' && nextCursor ? nextCursor : undefined };
}
