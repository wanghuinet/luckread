import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiRequest, createIdempotencyKey } from './api-client';

export type ContentBookmarkSnapshot = {
  bookmarked: boolean;
  loaded: boolean;
  loading: boolean;
  pending: boolean;
  error: string | null;
};

export type ContentBookmarkOperationResult = {
  ok: boolean;
  status?: number;
  message?: string;
};

const EMPTY_SNAPSHOT: ContentBookmarkSnapshot = Object.freeze({
  bookmarked: false,
  loaded: false,
  loading: false,
  pending: false,
  error: null,
});

const snapshots = new Map<string, ContentBookmarkSnapshot>();
const listeners = new Map<string, Set<() => void>>();

function normalizeContentId(contentId?: string): string {
  return typeof contentId === 'string' ? contentId.trim() : '';
}

export function getContentBookmarkSnapshot(contentId?: string): ContentBookmarkSnapshot {
  const id = normalizeContentId(contentId);
  if (!id) return EMPTY_SNAPSHOT;

  const current = snapshots.get(id);
  if (current) return current;

  snapshots.set(id, { ...EMPTY_SNAPSHOT });
  return snapshots.get(id)!;
}

function publish(contentId: string, patch: Partial<ContentBookmarkSnapshot>): void {
  const current = getContentBookmarkSnapshot(contentId);
  snapshots.set(contentId, { ...current, ...patch });
  for (const listener of listeners.get(contentId) ?? []) listener();
}

function subscribe(contentId: string, listener: () => void): () => void {
  if (!contentId) return () => undefined;
  const subscribers = listeners.get(contentId) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(contentId, subscribers);

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(contentId);
  };
}

function parseBookmarkStatus(value: unknown): boolean | null {
  if (!value || typeof value !== 'object' || !('data' in value)) return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || !('favorited' in data)) return null;
  const favorited = (data as { favorited?: unknown }).favorited;
  return typeof favorited === 'boolean' ? favorited : null;
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : 'Could not reach LuckRead. Check your connection and try again.';
}

/** Read the current viewer's bookmark relationship from W01/W05. */
export async function refreshContentBookmarkStatus(contentId?: string): Promise<void> {
  const id = normalizeContentId(contentId);
  if (!id) return;

  const current = getContentBookmarkSnapshot(id);
  if (current.loading || current.pending) return;

  publish(id, { loading: true, error: null });
  try {
    const result = await apiRequest<unknown>(
      '/interactions/bookmarks?targetType=content&targetId=' + encodeURIComponent(id),
      { method: 'GET' },
    );

    if (!result.response.ok) {
      publish(id, {
        loaded: false,
        loading: false,
        error: result.error?.message ?? 'Could not load this bookmark status.',
      });
      return;
    }

    const bookmarked = parseBookmarkStatus(result.data);
    if (bookmarked === null) {
      publish(id, {
        loaded: false,
        loading: false,
        error: 'LuckRead returned an invalid bookmark status.',
      });
      return;
    }

    publish(id, { bookmarked, loaded: true, loading: false, error: null });
  } catch (cause) {
    publish(id, { loaded: false, loading: false, error: failureMessage(cause) });
  }
}

/** Toggle one content bookmark, rolling optimistic state back on all failed writes. */
export async function toggleContentBookmark(contentId?: string): Promise<ContentBookmarkOperationResult> {
  const id = normalizeContentId(contentId);
  if (!id) {
    return { ok: false, message: 'This item is not connected to a LuckRead content ID.' };
  }

  const current = getContentBookmarkSnapshot(id);
  if (current.loading || current.pending) {
    return { ok: false, message: 'Bookmark status is still syncing. Please try again.' };
  }
  if (!current.loaded) {
    return {
      ok: false,
      message: current.error ?? 'Bookmark status is not available yet. Retry loading it first.',
    };
  }

  const previousBookmarked = current.bookmarked;
  const nextBookmarked = !previousBookmarked;
  publish(id, {
    bookmarked: nextBookmarked,
    pending: true,
    error: null,
  });

  try {
    const result = await apiRequest<unknown>('/interactions/bookmarks', {
      method: nextBookmarked ? 'POST' : 'DELETE',
      body: JSON.stringify({ targetType: 'content', targetId: id }),
      idempotencyKey: createIdempotencyKey(),
    });

    if (!result.response.ok) {
      const message = result.error?.message ?? 'Could not update this bookmark.';
      publish(id, {
        bookmarked: previousBookmarked,
        pending: false,
        loading: false,
        error: message,
      });
      return { ok: false, status: result.response.status, message };
    }

    publish(id, { bookmarked: nextBookmarked, loaded: true, pending: false, error: null });
    await refreshContentBookmarkStatus(id);
    return { ok: true };
  } catch (cause) {
    const message = failureMessage(cause);
    publish(id, {
      bookmarked: previousBookmarked,
      pending: false,
      loading: false,
      error: message,
    });
    return { ok: false, message };
  }
}

export function useContentBookmark(contentId?: string): ContentBookmarkSnapshot & {
  refreshStatus: () => Promise<void>;
  toggleBookmark: () => Promise<ContentBookmarkOperationResult>;
} {
  const id = normalizeContentId(contentId);
  const subscribeToContent = useCallback(
    (listener: () => void) => subscribe(id, listener),
    [id],
  );
  const getSnapshot = useCallback(() => getContentBookmarkSnapshot(id), [id]);
  const snapshot = useSyncExternalStore(subscribeToContent, getSnapshot, getSnapshot);

  useEffect(() => {
    if (id) void refreshContentBookmarkStatus(id);
  }, [id]);

  const refreshStatus = useCallback(() => refreshContentBookmarkStatus(id), [id]);
  const toggleBookmark = useCallback(() => toggleContentBookmark(id), [id]);
  return { ...snapshot, refreshStatus, toggleBookmark };
}
