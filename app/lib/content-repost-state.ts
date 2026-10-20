import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiRequest } from './api-client';

export type ContentRepostSnapshot = {
  reposted: boolean;
  repostCount: number | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
};

type InitialRepostState = {
  reposted?: boolean;
  repostCount?: number;
};

type ContentSocialSummary = {
  data?: {
    counts?: { reposts?: unknown };
    viewer?: { reposted?: unknown } | null;
  };
};

type ParsedRepostStatus = {
  reposted: boolean;
  repostCount: number;
};

export type ContentRepostOperationResult = {
  ok: boolean;
  status?: number;
  message?: string;
};

const EMPTY_SNAPSHOT: ContentRepostSnapshot = Object.freeze({
  reposted: false,
  repostCount: null,
  loading: false,
  pending: false,
  error: null,
});

const snapshots = new Map<string, ContentRepostSnapshot>();
const listeners = new Map<string, Set<() => void>>();

function normalizeContentId(contentId?: string): string {
  return typeof contentId === 'string' ? contentId.trim() : '';
}

function normalizeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function getContentRepostSnapshot(
  contentId?: string,
  initial: InitialRepostState = {},
): ContentRepostSnapshot {
  const id = normalizeContentId(contentId);
  if (!id) return EMPTY_SNAPSHOT;

  const current = snapshots.get(id);
  if (current) return current;

  const snapshot: ContentRepostSnapshot = {
    reposted: typeof initial.reposted === 'boolean' ? initial.reposted : false,
    repostCount: normalizeCount(initial.repostCount),
    loading: false,
    pending: false,
    error: null,
  };
  snapshots.set(id, snapshot);
  return snapshot;
}

function publish(contentId: string, patch: Partial<ContentRepostSnapshot>): void {
  const current = getContentRepostSnapshot(contentId);
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

function parseRepostStatus(value: unknown): ParsedRepostStatus | null {
  if (!value || typeof value !== 'object' || !('data' in value)) return null;
  const data = (value as ContentSocialSummary).data;
  if (!data || typeof data !== 'object') return null;
  const repostCount = normalizeCount(data.counts?.reposts);
  const reposted = data.viewer?.reposted;
  if (repostCount === null || typeof reposted !== 'boolean') return null;
  return { reposted, repostCount };
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : 'Could not reach LuckRead. Check your connection and try again.';
}

/** Read the authoritative repost relationship and aggregate from the W05-backed summary API. */
export async function refreshContentRepostStatus(contentId?: string): Promise<void> {
  const id = normalizeContentId(contentId);
  if (!id) return;

  const current = getContentRepostSnapshot(id);
  if (current.loading || current.pending) return;

  publish(id, { loading: true, error: null });
  try {
    const result = await apiRequest<unknown>(
      '/contents/' + encodeURIComponent(id) + '/social',
      { method: 'GET' },
    );

    if (!result.response.ok) {
      publish(id, {
        loading: false,
        error: result.error?.message ?? 'Could not load the current repost status.',
      });
      return;
    }

    const parsed = parseRepostStatus(result.data);
    if (!parsed) {
      publish(id, {
        loading: false,
        error: 'LuckRead returned an invalid repost status.',
      });
      return;
    }

    publish(id, {
      reposted: parsed.reposted,
      repostCount: parsed.repostCount,
      loading: false,
      error: null,
    });
  } catch (cause) {
    publish(id, { loading: false, error: failureMessage(cause) });
  }
}

/** Create/remove the viewer's relationship to the original content; never creates a second post. */
export async function toggleContentRepost(contentId?: string): Promise<ContentRepostOperationResult> {
  const id = normalizeContentId(contentId);
  if (!id) {
    return { ok: false, message: 'This item is not connected to a LuckRead content ID.' };
  }

  const current = getContentRepostSnapshot(id);
  if (current.loading || current.pending) {
    return { ok: false, message: 'Repost status is still syncing. Please try again.' };
  }

  const previousReposted = current.reposted;
  const previousCount = current.repostCount;
  const nextReposted = !previousReposted;
  const optimisticCount = previousCount === null
    ? null
    : Math.max(0, previousCount + (nextReposted ? 1 : -1));

  publish(id, {
    reposted: nextReposted,
    repostCount: optimisticCount,
    pending: true,
    error: null,
  });

  try {
    const result = await apiRequest<unknown>(
      '/content/' + encodeURIComponent(id) + '/reposts',
      { method: nextReposted ? 'POST' : 'DELETE' },
    );

    if (!result.response.ok) {
      const message = result.error?.message ?? 'Could not update this repost. Please try again.';
      publish(id, {
        reposted: previousReposted,
        repostCount: previousCount,
        pending: false,
        loading: false,
        error: message,
      });
      return { ok: false, status: result.response.status, message };
    }

    // W01/W05 mutation responses do not carry the aggregate; reconcile from the read API.
    publish(id, { pending: false, error: null });
    await refreshContentRepostStatus(id);
    return { ok: true };
  } catch (cause) {
    const message = failureMessage(cause);
    publish(id, {
      reposted: previousReposted,
      repostCount: previousCount,
      pending: false,
      loading: false,
      error: message,
    });
    return { ok: false, message };
  }
}

export function useContentRepost(
  contentId?: string,
  initialRepostCount?: number,
  initialReposted?: boolean,
): ContentRepostSnapshot & { toggleRepost: () => Promise<ContentRepostOperationResult> } {
  const id = normalizeContentId(contentId);
  const subscribeToContent = useCallback(
    (listener: () => void) => subscribe(id, listener),
    [id],
  );
  const getSnapshot = useCallback(
    () => getContentRepostSnapshot(id, {
      repostCount: initialRepostCount,
      reposted: initialReposted,
    }),
    [id, initialRepostCount, initialReposted],
  );
  const snapshot = useSyncExternalStore(subscribeToContent, getSnapshot, getSnapshot);

  useEffect(() => {
    if (id) void refreshContentRepostStatus(id);
  }, [id]);

  const toggleRepost = useCallback(() => toggleContentRepost(id), [id]);
  return { ...snapshot, toggleRepost };
}
