import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiRequest, createIdempotencyKey } from './api-client';
import { useAuthStore } from '../store/auth-store';

export type ContentLikeSnapshot = {
  liked: boolean;
  likeCount: number | null;
  loading: boolean;
  loaded: boolean;
  pending: boolean;
  error: string | null;
};

type InitialLikeState = {
  liked?: boolean;
  likeCount?: number;
};

type LikeStatusEnvelope = {
  data?: unknown;
};

type ParsedLikeStatus = {
  liked: boolean;
  likeCount: number;
};

export type ContentLikeOperationResult = {
  ok: boolean;
  status?: number;
  message?: string;
};

const EMPTY_SNAPSHOT: ContentLikeSnapshot = Object.freeze({
  liked: false,
  likeCount: null,
  loading: false,
  loaded: false,
  pending: false,
  error: null,
});

const snapshots = new Map<string, ContentLikeSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const SNAPSHOT_CACHE_MAX_ENTRIES = 1024;

function promoteSnapshot(key: string, value: ContentLikeSnapshot): void {
  snapshots.delete(key);
  snapshots.set(key, value);
}

function pruneSnapshots(): void {
  if (snapshots.size < SNAPSHOT_CACHE_MAX_ENTRIES) return;
  for (const key of snapshots.keys()) {
    if (!listeners.has(key)) snapshots.delete(key);
    if (snapshots.size < SNAPSHOT_CACHE_MAX_ENTRIES) return;
  }
  const oldestKey = snapshots.keys().next().value;
  if (typeof oldestKey === 'string') snapshots.delete(oldestKey);
}

function normalizeContentId(contentId?: string): string {
  return typeof contentId === 'string' ? contentId.trim() : '';
}

function normalizeViewerId(viewerId?: string | null): string {
  return typeof viewerId === 'string' ? viewerId.trim() : '';
}

function contentScopeKey(contentId: string, viewerId?: string | null): string {
  return JSON.stringify([normalizeViewerId(viewerId) || 'anonymous', contentId]);
}

function isCurrentViewer(viewerId?: string | null): boolean {
  const normalizedViewerId = normalizeViewerId(viewerId);
  if (!normalizedViewerId) return false;
  const currentViewerId = useAuthStore.getState().user?.id ?? null;
  return currentViewerId === normalizedViewerId;
}

function normalizeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Return the shared per-content snapshot used by feed cards and detail surfaces. */
export function getContentLikeSnapshot(
  contentId?: string,
  initial: InitialLikeState = {},
  viewerId?: string | null,
): ContentLikeSnapshot {
  const id = normalizeContentId(contentId);
  if (!id) return EMPTY_SNAPSHOT;

  const key = contentScopeKey(id, viewerId);
  const current = snapshots.get(key);
  if (current) { promoteSnapshot(key, current); return current; }

  const likeCount = normalizeCount(initial.likeCount);
  const initialSnapshot: ContentLikeSnapshot = {
    liked: typeof initial.liked === 'boolean' ? initial.liked : false,
    likeCount,
    loading: false,
    loaded: typeof initial.liked === 'boolean',
    pending: false,
    error: null,
  };
  pruneSnapshots();
  snapshots.set(key, initialSnapshot);
  return initialSnapshot;
}

function publish(contentId: string, viewerId: string | null | undefined, patch: Partial<ContentLikeSnapshot>): void {
  const key = contentScopeKey(contentId, viewerId);
  const current = getContentLikeSnapshot(contentId, {}, viewerId);
  const next = { ...current, ...patch };
  promoteSnapshot(key, next);
  for (const listener of listeners.get(key) ?? []) listener();
}

function subscribe(contentId: string, viewerId: string | null, listener: () => void): () => void {
  if (!contentId) return () => undefined;
  const key = contentScopeKey(contentId, viewerId);
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(key, subscribers);

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(key);
  };
}

function parseLikeStatus(value: unknown): ParsedLikeStatus | null {
  if (!value || typeof value !== 'object' || !('data' in value)) return null;
  const data = (value as LikeStatusEnvelope).data;
  if (!data || typeof data !== 'object') return null;

  const candidate = data as { liked?: unknown; likeCount?: unknown };
  const likeCount = normalizeCount(candidate.likeCount);
  if (typeof candidate.liked !== 'boolean' || likeCount === null) return null;
  return { liked: candidate.liked, likeCount };
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : 'Could not reach LuckRead. Check your connection and try again.';
}

/** Re-read authoritative state on mount/re-entry, scoped to the active viewer. */
export async function refreshContentLikeStatus(contentId?: string, viewerId?: string | null): Promise<void> {
  const id = normalizeContentId(contentId);
  if (!id || !normalizeViewerId(viewerId) || !isCurrentViewer(viewerId)) return;

  const current = getContentLikeSnapshot(id, {}, viewerId);
  if (current.loading || current.pending) return;
  publish(id, viewerId, { loading: true, error: null });
  try {
    const result = await apiRequest<unknown>(
      '/interactions/likes?targetType=content&targetId=' + encodeURIComponent(id),
      { method: 'GET', expectedAccountId: viewerId ?? undefined },
    );
    if (!isCurrentViewer(viewerId)) {
      publish(id, viewerId, { liked: false, likeCount: null, loading: false, loaded: false, pending: false, error: null });
      return;
    }
    if (!result.response.ok) {
      publish(id, viewerId, { loading: false, error: result.error?.message ?? 'Could not load the current like status.' });
      return;
    }
    const parsed = parseLikeStatus(result.data);
    if (!parsed) {
      publish(id, viewerId, { loading: false, error: 'LuckRead returned an invalid like status.' });
      return;
    }
    publish(id, viewerId, { liked: parsed.liked, likeCount: parsed.likeCount, loading: false, loaded: true, error: null });
  } catch (cause) {
    if (!isCurrentViewer(viewerId)) {
      publish(id, viewerId, { liked: false, likeCount: null, loading: false, loaded: false, pending: false, error: null });
      return;
    }
    publish(id, viewerId, { loading: false, error: failureMessage(cause) });
  }
}

/** Toggle through W01/W05, optimistic for responsiveness and rolled back on failure. */
export async function toggleContentLike(contentId?: string, viewerId?: string | null): Promise<ContentLikeOperationResult> {
  const id = normalizeContentId(contentId);
  if (!id) return { ok: false, message: 'This item is not connected to a LuckRead content ID.' };
  if (!normalizeViewerId(viewerId)) return { ok: false, status: 401, message: 'Sign in to like this post.' };
  if (!isCurrentViewer(viewerId)) return { ok: false, message: 'Your account changed. Refresh the post before trying again.' };

  let current = getContentLikeSnapshot(id, {}, viewerId);
  if (current.loading || current.pending) return { ok: false, message: 'Like status is still syncing. Please try again.' };

  // A feed projection may not include viewer-specific like state. Resolve it
  // before choosing POST vs DELETE; assuming "not liked" can make an early tap
  // send the wrong operation for a post the viewer already liked.
  if (!current.loaded) {
    await refreshContentLikeStatus(id, viewerId);
    if (!isCurrentViewer(viewerId)) {
      return { ok: false, message: 'Your account changed while like status was loading.' };
    }
    current = getContentLikeSnapshot(id, {}, viewerId);
    if (!current.loaded) {
      return { ok: false, message: current.error ?? 'Like status is not available yet. Please retry.' };
    }
    if (current.loading || current.pending) {
      return { ok: false, message: 'Like status is still syncing. Please try again.' };
    }
  }

  const previousLiked = current.liked;
  const previousCount = current.likeCount;
  const nextLiked = !previousLiked;
  const optimisticCount = previousCount === null ? null : Math.max(0, previousCount + (nextLiked ? 1 : -1));
  publish(id, viewerId, { liked: nextLiked, likeCount: optimisticCount, pending: true, error: null });

  try {
    if (!isCurrentViewer(viewerId)) {
      publish(id, viewerId, { liked: false, likeCount: null, loaded: false, pending: false, loading: false, error: null });
      return { ok: false, message: 'Your account changed before the like request was sent.' };
    }
    const result = await apiRequest<unknown>('/interactions/likes', {
      method: nextLiked ? 'POST' : 'DELETE',
      body: JSON.stringify({ targetType: 'content', targetId: id }),
      idempotencyKey: createIdempotencyKey(),
      expectedAccountId: viewerId ?? undefined,
    });
    if (!isCurrentViewer(viewerId)) {
      publish(id, viewerId, { liked: false, likeCount: null, loaded: false, pending: false, loading: false, error: null });
      return { ok: false, message: 'The active account changed while the like was updating.' };
    }
    if (!result.response.ok) {
      const message = result.error?.message ?? 'Could not update this like. Please try again.';
      publish(id, viewerId, { liked: previousLiked, likeCount: previousCount, pending: false, loading: false, error: message });
      return { ok: false, status: result.response.status, message };
    }
    publish(id, viewerId, { pending: false, error: null });
    await refreshContentLikeStatus(id, viewerId);
    return { ok: true };
  } catch (cause) {
    if (!isCurrentViewer(viewerId)) {
      publish(id, viewerId, { liked: false, likeCount: null, loaded: false, pending: false, loading: false, error: null });
      return { ok: false, message: 'The active account changed while the like was updating.' };
    }
    const message = failureMessage(cause);
    // A transport failure cannot tell us whether W05 committed the Like before
    // the response was lost. Invalidate the optimistic snapshot and reconcile
    // against the authoritative W01/W05 status endpoint.
    publish(id, viewerId, {
      liked: previousLiked,
      likeCount: previousCount,
      loaded: false,
      pending: false,
      loading: false,
      error: message,
    });
    await refreshContentLikeStatus(id, viewerId);
    return { ok: false, message };
  }
}

export function useContentLike(
  contentId?: string,
  initialLikeCount?: number,
  initialLiked?: boolean,
): ContentLikeSnapshot & { toggleLike: () => Promise<ContentLikeOperationResult> } {
  const id = normalizeContentId(contentId);
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const subscribeToContent = useCallback(
    (listener: () => void) => subscribe(id, viewerId, listener),
    [id, viewerId],
  );
  const getSnapshot = useCallback(
    () => getContentLikeSnapshot(id, { likeCount: initialLikeCount, liked: initialLiked }, viewerId),
    [id, initialLikeCount, initialLiked, viewerId],
  );
  const snapshot = useSyncExternalStore(subscribeToContent, getSnapshot, getSnapshot);

  useEffect(() => {
    if (id) void refreshContentLikeStatus(id, viewerId);
  }, [id, viewerId]);

  const toggleLike = useCallback(() => toggleContentLike(id, viewerId), [id, viewerId]);
  return { ...snapshot, toggleLike };
}
