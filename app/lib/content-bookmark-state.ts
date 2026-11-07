import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiRequest, createIdempotencyKey } from './api-client';
import { useAuthStore } from '../store/auth-store';

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

function currentViewerId(): string | null {
  const auth = useAuthStore.getState();
  return auth.status === 'authenticated' ? auth.user?.id ?? null : null;
}

function snapshotKey(viewerId: string, contentId: string): string {
  return viewerId.length + ':' + viewerId + ':' + contentId.length + ':' + contentId;
}

export function getContentBookmarkSnapshot(
  contentId?: string,
  viewerId: string | null = currentViewerId(),
): ContentBookmarkSnapshot {
  const id = normalizeContentId(contentId);
  if (!id || !viewerId) return EMPTY_SNAPSHOT;

  const key = snapshotKey(viewerId, id);
  const current = snapshots.get(key);
  if (current) return current;

  const initial = { ...EMPTY_SNAPSHOT };
  snapshots.set(key, initial);
  return initial;
}

function publish(
  viewerId: string,
  contentId: string,
  patch: Partial<ContentBookmarkSnapshot>,
): void {
  const key = snapshotKey(viewerId, contentId);
  const current = getContentBookmarkSnapshot(contentId, viewerId);
  snapshots.set(key, { ...current, ...patch });
  for (const listener of listeners.get(key) ?? []) listener();
}

function subscribe(viewerId: string | null, contentId: string, listener: () => void): () => void {
  if (!viewerId || !contentId) return () => undefined;
  const key = snapshotKey(viewerId, contentId);
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(key, subscribers);

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(key);
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

function resetStaleViewerSnapshot(viewerId: string, contentId: string): void {
  publish(viewerId, contentId, {
    bookmarked: false,
    loaded: false,
    loading: false,
    pending: false,
    error: null,
  });
}

/** Read one viewer's bookmark relationship from the existing W01/W05 route. */
export async function refreshContentBookmarkStatus(
  contentId?: string,
  viewerId: string | null = currentViewerId(),
): Promise<void> {
  const id = normalizeContentId(contentId);
  if (!id || !viewerId || currentViewerId() !== viewerId) return;

  const current = getContentBookmarkSnapshot(id, viewerId);
  if (current.loading || current.pending) return;

  publish(viewerId, id, { loading: true, error: null });
  try {
    const result = await apiRequest<unknown>(
      '/interactions/bookmarks?targetType=content&targetId=' + encodeURIComponent(id),
      { method: 'GET' },
    );

    // A response started for one viewer is never published into another
    // viewer's relationship state, even when both accounts remain authenticated.
    if (currentViewerId() !== viewerId) {
      resetStaleViewerSnapshot(viewerId, id);
      return;
    }

    if (!result.response.ok) {
      publish(viewerId, id, {
        loaded: false,
        loading: false,
        error: result.error?.message ?? 'Could not load this bookmark status.',
      });
      return;
    }

    const bookmarked = parseBookmarkStatus(result.data);
    if (bookmarked === null) {
      publish(viewerId, id, {
        loaded: false,
        loading: false,
        error: 'LuckRead returned an invalid bookmark status.',
      });
      return;
    }

    publish(viewerId, id, { bookmarked, loaded: true, loading: false, error: null });
  } catch (cause) {
    if (currentViewerId() !== viewerId) {
      resetStaleViewerSnapshot(viewerId, id);
      return;
    }
    publish(viewerId, id, { loaded: false, loading: false, error: failureMessage(cause) });
  }
}

/** Toggle a bookmark using the active viewer's own scoped relationship snapshot. */
export async function toggleContentBookmark(
  contentId?: string,
  viewerId: string | null = currentViewerId(),
): Promise<ContentBookmarkOperationResult> {
  const id = normalizeContentId(contentId);
  if (!id) {
    return { ok: false, message: 'This item is not connected to a LuckRead content ID.' };
  }
  if (!viewerId || currentViewerId() !== viewerId) {
    return { ok: false, message: 'Sign in to manage this bookmark.' };
  }

  const current = getContentBookmarkSnapshot(id, viewerId);
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
  publish(viewerId, id, {
    bookmarked: nextBookmarked,
    pending: true,
    error: null,
  });

  try {
    // Do not start a mutation from a stale component after the active account changes.
    if (currentViewerId() !== viewerId) {
      resetStaleViewerSnapshot(viewerId, id);
      return { ok: false, message: 'The active account changed. Refresh bookmark status and retry.' };
    }

    const result = await apiRequest<unknown>('/interactions/bookmarks', {
      method: nextBookmarked ? 'POST' : 'DELETE',
      body: JSON.stringify({ targetType: 'content', targetId: id }),
      idempotencyKey: createIdempotencyKey(),
    });

    if (currentViewerId() !== viewerId) {
      resetStaleViewerSnapshot(viewerId, id);
      return { ok: false, message: 'The active account changed while the bookmark was updating.' };
    }

    if (!result.response.ok) {
      const message = result.error?.message ?? 'Could not update this bookmark.';
      publish(viewerId, id, {
        bookmarked: previousBookmarked,
        pending: false,
        loading: false,
        error: message,
      });
      return { ok: false, status: result.response.status, message };
    }

    publish(viewerId, id, { bookmarked: nextBookmarked, loaded: true, pending: false, error: null });
    await refreshContentBookmarkStatus(id, viewerId);
    return { ok: true };
  } catch (cause) {
    if (currentViewerId() !== viewerId) {
      resetStaleViewerSnapshot(viewerId, id);
      return { ok: false, message: 'The active account changed while the bookmark was updating.' };
    }
    const message = failureMessage(cause);
    publish(viewerId, id, {
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
  const authStatus = useAuthStore((state) => state.status);
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const subscribeToContent = useCallback(
    (listener: () => void) => subscribe(viewerId, id, listener),
    [id, viewerId],
  );
  const getSnapshot = useCallback(
    () => getContentBookmarkSnapshot(id, viewerId),
    [id, viewerId],
  );
  const snapshot = useSyncExternalStore(subscribeToContent, getSnapshot, getSnapshot);

  useEffect(() => {
    if (id && authStatus === 'authenticated' && viewerId) {
      void refreshContentBookmarkStatus(id, viewerId);
    }
  }, [authStatus, id, viewerId]);

  const refreshStatus = useCallback(
    () => refreshContentBookmarkStatus(id, viewerId),
    [id, viewerId],
  );
  const toggleBookmark = useCallback(
    () => toggleContentBookmark(id, viewerId),
    [id, viewerId],
  );
  return { ...snapshot, refreshStatus, toggleBookmark };
}
