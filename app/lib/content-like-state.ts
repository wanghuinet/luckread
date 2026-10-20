import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiRequest, createIdempotencyKey } from './api-client';

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

function normalizeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Return the shared per-content snapshot used by feed cards and detail surfaces. */
export function getContentLikeSnapshot(
  contentId?: string,
  initial: InitialLikeState = {},
): ContentLikeSnapshot {
  const id = normalizeContentId(contentId);
  if (!id) return EMPTY_SNAPSHOT;

  const current = snapshots.get(id);
  if (current) return current;

  const likeCount = normalizeCount(initial.likeCount);
  const initialSnapshot: ContentLikeSnapshot = {
    liked: typeof initial.liked === 'boolean' ? initial.liked : false,
    likeCount,
    loading: false,
    pending: false,
    error: null,
  };
  snapshots.set(id, initialSnapshot);
  return initialSnapshot;
}

function publish(contentId: string, patch: Partial<ContentLikeSnapshot>): void {
  const current = getContentLikeSnapshot(contentId);
  const next = { ...current, ...patch };
  snapshots.set(contentId, next);
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
export async function refreshContentLikeStatus(contentId?: string): Promise<void> {
  const id = normalizeContentId(contentId);
  if (!id) return;

  const current = getContentLikeSnapshot(id);
  if (current.loading || current.pending) return;

  publish(id, { loading: true, error: null });
  try {
    const result = await apiRequest<unknown>(
      '/interactions/likes?targetType=content&targetId=' + encodeURIComponent(id),
      { method: 'GET' },
    );

    if (!result.response.ok) {
      publish(id, {
        loading: false,
        error: result.error?.message ?? 'Could not load the current like status.',
      });
      return;
    }

    const parsed = parseLikeStatus(result.data);
    if (!parsed) {
      publish(id, {
        loading: false,
        error: 'LuckRead returned an invalid like status.',
      });
      return;
    }

    publish(id, {
      liked: parsed.liked,
      likeCount: parsed.likeCount,
      loading: false,
      error: null,
    });
  } catch (cause) {
    publish(id, { loading: false, error: failureMessage(cause) });
  }
}

/** Toggle through W01/W05, optimistic for responsiveness and rolled back on failure. */
export async function toggleContentLike(contentId?: string): Promise<ContentLikeOperationResult> {
  const id = normalizeContentId(contentId);
  if (!id) {
    return { ok: false, message: 'This item is not connected to a LuckRead content ID.' };
  }

  const current = getContentLikeSnapshot(id);
  if (current.loading || current.pending) {
    return { ok: false, message: 'Like status is still syncing. Please try again.' };
  }

  const previousLiked = current.liked;
  const previousCount = current.likeCount;
  const nextLiked = !previousLiked;
  const optimisticCount = previousCount === null
    ? null
    : Math.max(0, previousCount + (nextLiked ? 1 : -1));

  publish(id, {
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
      publish(id, {
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
    publish(id, { pending: false, error: null });
    await refreshContentLikeStatus(id);
    return { ok: true };
  } catch (cause) {
    const message = failureMessage(cause);
    publish(id, {
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
  const subscribeToContent = useCallback(
    (listener: () => void) => subscribe(id, listener),
    [id],
  );
  const getSnapshot = useCallback(
    () => getContentLikeSnapshot(id, { likeCount: initialLikeCount, liked: initialLiked }),
    [id, initialLikeCount, initialLiked],
  );
  const snapshot = useSyncExternalStore(subscribeToContent, getSnapshot, getSnapshot);

  useEffect(() => {
    if (id) void refreshContentLikeStatus(id);
  }, [id]);

  const toggleLike = useCallback(() => toggleContentLike(id), [id]);
  return { ...snapshot, toggleLike };
}
