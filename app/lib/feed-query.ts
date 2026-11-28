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

export function incrementNativeFeedReplyCount(item: ApiContentRecord, minimumCount = 0): ApiContentRecord {
  const currentCount = Math.max(
    0,
    minimumCount,
    item.social?.counts?.comments ?? 0,
    item.social?.counts?.replies ?? 0,
    item.counts?.comments ?? 0,
    item.counts?.replies ?? 0,
    item.replyCount ?? 0,
    item.reply_count ?? 0,
  );
  const nextCount = currentCount + 1;

  return {
    ...item,
    replyCount: nextCount,
    reply_count: nextCount,
    counts: {
      ...(item.counts ?? {}),
      comments: nextCount,
      replies: nextCount,
    },
    social: {
      ...(item.social ?? {}),
      counts: {
        ...(item.social?.counts ?? {}),
        comments: nextCount,
        replies: nextCount,
      },
    },
  };
}

/**
 * TanStack Query calls this with every cursor already used by the current
 * infinite-query chain. Stop on missing, repeated, or cyclic cursors so a
 * malformed W01 page cannot make the native feed request the same page forever.
 */
export function getNativeFeedNextPageParam(
  lastPage: Pick<NativeFeedPage, 'hasMore' | 'nextCursor'>,
  allPageParams: readonly (string | null)[],
): string | undefined {
  const nextCursor = lastPage.nextCursor;
  if (!lastPage.hasMore || typeof nextCursor !== 'string' || !nextCursor.trim()) {
    return undefined;
  }

  return allPageParams.includes(nextCursor) ? undefined : nextCursor;
}

export function nativeFeedQueryKey(kind: NativeFeedKind, viewerId?: string | null) {
  return ['native-feed', kind, viewerId || 'anonymous'] as const;
}

/** Fetch one canonical W01 page. Cursor and viewer scope are owned by TanStack Query. */
export async function fetchNativeFeedPage(input: {
  kind: NativeFeedKind;
  cursor: string | null;
  signal?: AbortSignal;
  viewerId?: string | null;
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
      expectedAccountId: input.kind === 'following' ? input.viewerId ?? undefined : undefined,
    },
  );


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
