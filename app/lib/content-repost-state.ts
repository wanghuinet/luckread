import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiRequest, createIdempotencyKey } from './api-client';
import { useAuthStore } from '../store/auth-store';

export type ContentRepostSnapshot = {
  reposted: boolean;
  repostCount: number | null;
  loading: boolean;
  pending: boolean;
  loaded: boolean;
  error: string | null;
};
type InitialRepostState = { reposted?: boolean; repostCount?: number };
type ContentSocialSummary = { data?: { counts?: { reposts?: unknown }; viewer?: { reposted?: unknown } | null } };
type ParsedRepostStatus = { reposted: boolean; repostCount: number };
export type ContentRepostOperationResult = { ok: boolean; status?: number; message?: string };

const EMPTY_SNAPSHOT: ContentRepostSnapshot = Object.freeze({
  reposted: false, repostCount: null, loading: false, pending: false, loaded: false, error: null,
});
const snapshots = new Map<string, ContentRepostSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const MAX_REPOST_SNAPSHOTS = 400;

function promoteRepostSnapshot(key: string, value: ContentRepostSnapshot): void {
  snapshots.delete(key);
  snapshots.set(key, value);
}

function pruneRepostSnapshots(): void {
  if (snapshots.size < MAX_REPOST_SNAPSHOTS) return;
  for (const key of snapshots.keys()) {
    if (!listeners.has(key)) snapshots.delete(key);
    if (snapshots.size < MAX_REPOST_SNAPSHOTS) return;
  }
  const oldestKey = snapshots.keys().next().value;
  if (typeof oldestKey === 'string') snapshots.delete(oldestKey);
}

function normalizeContentId(contentId?: string): string {
  return typeof contentId === 'string' ? contentId.trim() : '';
}
function currentViewerId(): string | null {
  const auth = useAuthStore.getState();
  return auth.status === 'authenticated' ? auth.user?.id ?? null : null;
}
function snapshotKey(viewerId: string | null, contentId: string): string {
  const viewer = viewerId ?? 'anonymous';
  return viewer.length + ':' + viewer + ':' + contentId.length + ':' + contentId;
}
function normalizeCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function getContentRepostSnapshot(
  contentId?: string, viewerId: string | null = currentViewerId(), initial: InitialRepostState = {},
): ContentRepostSnapshot {
  const id = normalizeContentId(contentId);
  if (!id) return EMPTY_SNAPSHOT;
  const key = snapshotKey(viewerId, id);
  const current = snapshots.get(key);
  if (current) { promoteRepostSnapshot(key, current); return current; }
  pruneRepostSnapshots();
  const snapshot: ContentRepostSnapshot = {
    reposted: viewerId ? (typeof initial.reposted === 'boolean' ? initial.reposted : false) : false,
    repostCount: normalizeCount(initial.repostCount),
    loading: false, pending: false, loaded: false, error: null,
  };
  snapshots.set(key, snapshot);
  return snapshot;
}
function publish(viewerId: string | null, contentId: string, patch: Partial<ContentRepostSnapshot>): void {
  const key = snapshotKey(viewerId, contentId);
  promoteRepostSnapshot(key, { ...getContentRepostSnapshot(contentId, viewerId), ...patch });
  for (const listener of listeners.get(key) ?? []) listener();
}
function subscribe(viewerId: string | null, contentId: string, listener: () => void): () => void {
  if (!contentId) return () => undefined;
  const key = snapshotKey(viewerId, contentId);
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(key, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(key);
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
  return cause instanceof Error ? cause.message : 'Could not reach LuckRead. Check your connection and try again.';
}
function resetStaleViewerSnapshot(viewerId: string, contentId: string): void {
  publish(viewerId, contentId, { reposted: false, loading: false, pending: false, loaded: false, error: null });
}
/** Fetches aggregate and relationship data, publishing only into the viewer scope that initiated the request. */
export async function refreshContentRepostStatus(
  contentId?: string, viewerId: string | null = currentViewerId(),
): Promise<void> {
  const id = normalizeContentId(contentId);
  if (!id || currentViewerId() !== viewerId) return;
  const current = getContentRepostSnapshot(id, viewerId);
  if (current.loading || current.pending) return;
  publish(viewerId, id, { loading: true, error: null });
  try {
    const result = await apiRequest<unknown>('/contents/' + encodeURIComponent(id) + '/social', { method: 'GET' });
    if (currentViewerId() !== viewerId) {
      if (viewerId) resetStaleViewerSnapshot(viewerId, id);
      return;
    }
    if (!result.response.ok) {
      publish(viewerId, id, { loading: false, loaded: false, error: result.error?.message ?? 'Could not load repost status.' });
      return;
    }
    const parsed = parseRepostStatus(result.data);
    if (!parsed) {
      publish(viewerId, id, { loading: false, loaded: false, error: 'LuckRead returned an invalid repost status.' });
      return;
    }
    publish(viewerId, id, { reposted: viewerId ? parsed.reposted : false, repostCount: parsed.repostCount, loaded: true, loading: false, error: null });
  } catch (cause) {
    if (currentViewerId() !== viewerId) {
      if (viewerId) resetStaleViewerSnapshot(viewerId, id);
      return;
    }
    publish(viewerId, id, { loading: false, loaded: false, error: failureMessage(cause) });
  }
}
/** Toggle the current viewer's repost relationship; never operates on a stale account's snapshot. */
export async function toggleContentRepost(
  contentId?: string, viewerId: string | null = currentViewerId(),
): Promise<ContentRepostOperationResult> {
  const id = normalizeContentId(contentId);
  if (!id) return { ok: false, message: 'This item is not connected to a LuckRead content ID.' };
  if (!viewerId || currentViewerId() !== viewerId) return { ok: false, message: 'Sign in to repost.' };
  const current = getContentRepostSnapshot(id, viewerId);
  if (current.loading || current.pending) return { ok: false, message: 'Repost status is still syncing. Please try again.' };
  if (!current.loaded) return { ok: false, message: current.error ?? 'Repost status is not available yet. Retry loading it first.' };
  const previousReposted = current.reposted;
  const previousCount = current.repostCount;
  const nextReposted = !previousReposted;
  const optimisticCount = previousCount === null ? null : Math.max(0, previousCount + (nextReposted ? 1 : -1));
  publish(viewerId, id, { reposted: nextReposted, repostCount: optimisticCount, pending: true, error: null });
  try {
    if (currentViewerId() !== viewerId) {
      resetStaleViewerSnapshot(viewerId, id);
      return { ok: false, message: 'The active account changed. Refresh repost status and retry.' };
    }
    const result = await apiRequest<unknown>('/content/' + encodeURIComponent(id) + '/reposts', {
      method: nextReposted ? 'POST' : 'DELETE', idempotencyKey: createIdempotencyKey(),
    });
    if (currentViewerId() !== viewerId) {
      resetStaleViewerSnapshot(viewerId, id);
      return { ok: false, message: 'The active account changed while the repost was updating.' };
    }
    if (!result.response.ok) {
      const message = result.error?.message ?? 'Could not update this repost. Please try again.';
      publish(viewerId, id, { reposted: previousReposted, repostCount: previousCount, pending: false, loading: false, error: message });
      return { ok: false, status: result.response.status, message };
    }
    publish(viewerId, id, { pending: false, error: null });
    await refreshContentRepostStatus(id, viewerId);
    return { ok: true };
  } catch (cause) {
    if (currentViewerId() !== viewerId) {
      resetStaleViewerSnapshot(viewerId, id);
      return { ok: false, message: 'The active account changed while the repost was updating.' };
    }
    const message = failureMessage(cause);
    publish(viewerId, id, { reposted: previousReposted, repostCount: previousCount, pending: false, loading: false, error: message });
    return { ok: false, message };
  }
}
export function useContentRepost(
  contentId?: string, initialRepostCount?: number, initialReposted?: boolean,
): ContentRepostSnapshot & { toggleRepost: () => Promise<ContentRepostOperationResult>; refreshStatus: () => Promise<void> } {
  const id = normalizeContentId(contentId);
  const authStatus = useAuthStore((state) => state.status);
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const subscribeToContent = useCallback((listener: () => void) => subscribe(viewerId, id, listener), [id, viewerId]);
  const getSnapshot = useCallback(() => getContentRepostSnapshot(id, viewerId, {
    repostCount: initialRepostCount, reposted: initialReposted,
  }), [id, viewerId, initialRepostCount, initialReposted]);
  const snapshot = useSyncExternalStore(subscribeToContent, getSnapshot, getSnapshot);
  useEffect(() => {
    if (id && authStatus === 'authenticated' && viewerId) void refreshContentRepostStatus(id, viewerId);
  }, [authStatus, id, viewerId]);
  const refreshStatus = useCallback(() => refreshContentRepostStatus(id, viewerId), [id, viewerId]);
  const toggleRepost = useCallback(() => toggleContentRepost(id, viewerId), [id, viewerId]);
  return { ...snapshot, toggleRepost, refreshStatus };
}
