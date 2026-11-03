import type { ApiContentPage, ApiContentRecord } from './content-adapter';
import { apiRequest, getApiErrorMessage } from './api-client';

export type NativeFeedKind = 'for-you' | 'following';

export type NativeFeedPage = {
  items: ApiContentRecord[];
  nextCursor: string | null;
  hasMore: boolean;
};

type ContentPageResponse = {
  data?: ApiContentPage;
  error?: {
    code?: string;
    message?: string;
  };
};

export function nativeFeedQueryKey(kind: NativeFeedKind, viewerId?: string | null) {
  return kind === 'following'
    ? (['native-feed', 'following', viewerId || 'anonymous'] as const)
    : (['native-feed', 'for-you'] as const);
}

/** Fetch one canonical W01 page. Cursor and viewer scope are owned by TanStack Query. */
export async function fetchNativeFeedPage(input: {
  kind: NativeFeedKind;
  cursor: string | null;
  signal?: AbortSignal;
  invalidateSession: () => Promise<void>;
}): Promise<NativeFeedPage> {
  const params = new URLSearchParams({ limit: '20' });
  if (input.cursor) params.set('cursor', input.cursor);
  if (input.kind === 'for-you') params.set('type', 'post');

  const endpoint = input.kind === 'following' ? '/feed/following' : '/contents';
  const { response, data } = await apiRequest<ContentPageResponse>(
    endpoint + '?' + params.toString(),
    {
      method: 'GET',
      auth: input.kind === 'following',
      signal: input.signal,
    },
  );

  if (response.status === 401 && input.kind === 'following') {
    await input.invalidateSession();
    return { items: [], nextCursor: null, hasMore: false };
  }

  const payload = data as ContentPageResponse | null;
  const page = payload?.data;
  if (!response.ok || !page || !Array.isArray(page.items)) {
    throw new Error(getApiErrorMessage(data, 'Could not load this timeline. Please retry.', response.status));
  }

  const items = page.items.filter(
    (item): item is ApiContentRecord => Boolean(item && typeof item.id === 'string' && item.id.trim()),
  );

  return {
    items,
    nextCursor: typeof page.nextCursor === 'string' && page.nextCursor.trim()
      ? page.nextCursor
      : null,
    hasMore: page.hasMore === true,
  };
}
