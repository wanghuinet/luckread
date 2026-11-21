import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiRequest, createIdempotencyKey } from './api-client';
import { useAuthStore } from '../store/auth-store';

export type ContentLikeSnapshot = {
  liked: boolean;
  likeCount: number | null;
  loading: boolean;
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
  pending: false,
  error: null,
});

const snapshots = new Map<string, ContentLikeSnapshot>();
const listeners = new Map<string, Set<() => void>>();

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
  const currentViewerId = useAuthStore.getState().user?.id ?? null;
  return currentViewerId === (normalizeViewerId(viewerId) || null);
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
  if (current) return current;

  const likeCount = normalizeCount(initial.likeCount);
  const initialSnapshot: ContentLikeSnapshot = {
    liked: typeof initial.liked === 'boolean' ? initial.liked : false,
    likeCount,
    loading: false,
    pending: false,
    error: null,
  };
  snapshots.set(key, initialSnapshot);
  return initialSnapshot;
}

function publish(contentId: string, viewerId: string | null | undefined, patch: Partial<ContentLikeSnapshot>): void {
  const key = contentScopeKey(contentId, viewerId);
  const current = getContentLikeSnapshot(contentId, {}, viewerId);
  const next = { ...current, ...patch };
  snapshots.set(key, next);
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

/** Re-read authoritative state on mount/re-entry; concurrent readers are deduplicated. */
export async function refreshContentLikeStatus(contentId?: string, viewerId?: string | null): Promise<void> {
  const id = normalizeContentId(contentId);
  if (!id) return;

  const current = getContentLikeSnapshot(id, {}, viewerId);
  if (current.loading || current.pending) return;

  publish(id, viewerId, { loading: true, error: null });
  try {
    const result = await apiRequest<unknown>(
      '/interactions/likes?targetType=content&targetId=' + encodeURIComponent(id),
      { method: 'GET' },
    );

    if (!result.response.ok) {
      publish(id, viewerId, {
        loading: false,
        error: result.error?.message ?? 'Could not load the current like status.',
      });
      return;
    }

    const parsed = parseLikeStatus(result.data);
    if (!parsed) {
      publish(id, viewerId, {
        loading: false,
        error: 'LuckRead returned an invalid like status.',
      });
      return;
    }

    publish(id, viewerId, {
      liked: parsed.liked,
      likeCount: parsed.likeCount,
      loading: false,
      error: null,
    });
  } catch (cause) {
    publish(id, viewerId, { loading: false, error: failureMessage(cause) });
  }
}

/** Toggle through W01/W05, optimistic for responsiveness and rolled back on failure. */
export async function toggleContentLike(contentId?: string, viewerId?: string | null): Promise<ContentLikeOperationResult> {
  const id = normalizeContentId(contentId);
  if (!id) {
    return { ok: false, message: 'This item is not connected to a LuckRead content ID.' };
  }

  if (!isCurrentViewer(viewerId)) {
    return { ok: false, message: 'Your account changed. Refresh the post before trying again.' };
  }

  const current = getContentLikeSnapshot(id, {}, viewerId);
  if (current.loading || current.pending) {
    return { ok: false, message: 'Like status is still syncing. Please try again.' };
  }

  const previousLiked = current.liked;
  const previousCount = current.likeCount;
  const nextLiked = !previousLiked;
  const optimisticCount = previousCount === null
    ? null
    : Math.max(0, previousCount + (nextLiked ? 1 : -1));

  publish(id, viewerId, {
    liked: nextLiked,
    likeCount: optimisticCount,
    pending: true,
    error: null,
  });

  try {
    const result = await apiRequest<unknown>('/interactions/likes', {
      method: nextLiked ? 'POST' : 'DELETE',
      body: JSON.stringify({ targetType: 'content', targetId: id }),
      idempotencyKey: createIdempotencyKey(),
    });

    if (!result.response.ok) {
      const message = result.error?.message ?? 'Could not update this like. Please try again.';
      publish(id, viewerId, {
        liked: previousLiked,
        likeCount: previousCount,
        pending: false,
        loading: false,
        error: message,
      });
      return { ok: false, status: result.response.status, message };
    }

    // The mutation response does not include an aggregate. Refresh from W05 to
    // reconcile the optimistic count with the authoritative server count.
    publish(id, viewerId, { pending: false, error: null });
    if (isCurrentViewer(viewerId)) await refreshContentLikeStatus(id, viewerId);
    return { ok: true };
  } catch (cause) {
    const message = failureMessage(cause);
    publish(id, viewerId, {
      liked: previousLiked,
      likeCount: previousCount,
      pending: false,
      loading: false,
      error: message,
    });
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
