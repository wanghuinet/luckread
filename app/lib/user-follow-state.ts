import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { apiRequest, createIdempotencyKey } from './api-client';
import { useAuthStore } from '../store/auth-store';

export type UserFollowSnapshot = {
  following: boolean;
  loaded: boolean;
  loading: boolean;
  pending: boolean;
  error: string | null;
};

export type UserFollowOperationResult = {
  ok: boolean;
  status?: number;
  message?: string;
};

const EMPTY_SNAPSHOT: UserFollowSnapshot = Object.freeze({
  following: false,
  loaded: false,
  loading: false,
  pending: false,
  error: null,
});

const snapshots = new Map<string, UserFollowSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const SNAPSHOT_CACHE_MAX_ENTRIES = 1024;

function promoteSnapshot(key: string, value: UserFollowSnapshot): void {
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

function normalizeUserId(targetUserId?: string): string {
  return typeof targetUserId === 'string' ? targetUserId.trim() : '';
}

function normalizeViewerId(viewerId?: string | null): string {
  return typeof viewerId === 'string' ? viewerId.trim() : '';
}

function followScopeKey(targetUserId: string, viewerId?: string | null): string {
  return JSON.stringify([normalizeViewerId(viewerId) || 'anonymous', targetUserId]);
}

function isCurrentViewer(viewerId?: string | null): boolean {
  const currentViewerId = useAuthStore.getState().user?.id ?? null;
  return currentViewerId === (normalizeViewerId(viewerId) || null);
}

export function getUserFollowSnapshot(targetUserId?: string, viewerId?: string | null): UserFollowSnapshot {
  const id = normalizeUserId(targetUserId);
  if (!id) return EMPTY_SNAPSHOT;

  const key = followScopeKey(id, viewerId);
  const current = snapshots.get(key);
  if (current) { promoteSnapshot(key, current); return current; }

  pruneSnapshots();
  snapshots.set(key, { ...EMPTY_SNAPSHOT });
  return snapshots.get(key)!;
}

function publish(targetUserId: string, viewerId: string | null | undefined, patch: Partial<UserFollowSnapshot>): void {
  const key = followScopeKey(targetUserId, viewerId);
  const current = getUserFollowSnapshot(targetUserId, viewerId);
  promoteSnapshot(key, { ...current, ...patch });
  for (const listener of listeners.get(key) ?? []) listener();
}

function subscribe(targetUserId: string, viewerId: string | null, listener: () => void): () => void {
  if (!targetUserId) return () => undefined;
  const key = followScopeKey(targetUserId, viewerId);
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(key, subscribers);

  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(key);
  };
}

function parseFollowStatus(value: unknown): boolean | null {
  if (!value || typeof value !== 'object' || !('data' in value)) return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || !('following' in data)) return null;
  const following = (data as { following?: unknown }).following;
  return typeof following === 'boolean' ? following : null;
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : 'Could not reach LuckRead. Check your connection and try again.';
}

/** Resolve a public profile handle to its canonical W01 user ID. */
export async function resolveUserProfileId(
  username?: string,
): Promise<{ id: string | null; status?: number; message?: string }> {
  const handle = typeof username === 'string' ? username.trim().replace(/^@/, '') : '';
  if (!handle) return { id: null, message: 'This profile is missing its LuckRead username.' };

  try {
    const result = await apiRequest<{ id?: unknown; identityId?: unknown }>(
      '/users/by-username/' + encodeURIComponent(handle),
      { method: 'GET', auth: false },
    );
    if (!result.response.ok) {
      return {
        id: null,
        status: result.response.status,
        message: result.error?.message ?? 'Could not resolve this LuckRead profile.',
      };
    }
    const profileData = result.data as { id?: unknown; identityId?: unknown } | null;
    const canonicalId = typeof profileData?.identityId === 'string' && profileData.identityId.trim()
      ? profileData.identityId.trim()
      : typeof profileData?.id === 'string' && profileData.id.trim()
        ? profileData.id.trim()
        : null;
    if (!canonicalId) {
      return { id: null, status: result.response.status, message: 'LuckRead returned an invalid profile ID.' };
    }
    return { id: canonicalId };
  } catch (cause) {
    return { id: null, message: failureMessage(cause) };
  }
}

/** Read relationship state from W01/W05; never infer it from local profile metadata. */
export async function refreshUserFollowStatus(targetUserId?: string, viewerId?: string | null): Promise<void> {
  const id = normalizeUserId(targetUserId);
  if (!id) return;

  const current = getUserFollowSnapshot(id, viewerId);
  if (current.loading || current.pending) return;

  publish(id, viewerId, { loading: true, error: null });
  try {
    const result = await apiRequest<unknown>(
      '/social/follows/' + encodeURIComponent(id),
      { method: 'GET' },
    );

    if (!result.response.ok) {
      publish(id, viewerId, {
        loaded: false,
        loading: false,
        error: result.error?.message ?? 'Could not load this follow status.',
      });
      return;
    }

    const following = parseFollowStatus(result.data);
    if (following === null) {
      publish(id, viewerId, {
        loaded: false,
        loading: false,
        error: 'LuckRead returned an invalid follow status.',
      });
      return;
    }

    publish(id, viewerId, { following, loaded: true, loading: false, error: null });
  } catch (cause) {
    publish(id, viewerId, { loaded: false, loading: false, error: failureMessage(cause) });
  }
}

/** Toggle one relationship through the existing W01 route and reconcile from the server. */
export async function toggleUserFollow(targetUserId?: string, viewerId?: string | null): Promise<UserFollowOperationResult> {
  const id = normalizeUserId(targetUserId);
  if (!id) {
    return { ok: false, message: 'This profile is missing its LuckRead user ID.' };
  }

  if (!isCurrentViewer(viewerId)) {
    return { ok: false, message: 'Your account changed. Refresh this profile before trying again.' };
  }

  const current = getUserFollowSnapshot(id, viewerId);
  if (current.loading || current.pending) {
    return { ok: false, message: 'Follow status is still syncing. Please try again.' };
  }
  if (!current.loaded) {
    return {
      ok: false,
      message: current.error ?? 'Follow status is not available yet. Retry loading it first.',
    };
  }

  const previousFollowing = current.following;
  const nextFollowing = !previousFollowing;
  publish(id, viewerId, {
    following: nextFollowing,
    pending: true,
    error: null,
  });

  try {
    const result = await apiRequest<unknown>(
      '/social/follows/' + encodeURIComponent(id),
      {
        method: nextFollowing ? 'POST' : 'DELETE',
        idempotencyKey: createIdempotencyKey(),
      },
    );

    if (!result.response.ok) {
      const message = result.error?.message ?? 'Could not update this follow relationship.';
      publish(id, viewerId, {
        following: previousFollowing,
        pending: false,
        loading: false,
        error: message,
      });
      return { ok: false, status: result.response.status, message };
    }

    publish(id, viewerId, { following: nextFollowing, loaded: true, pending: false, error: null });
    if (isCurrentViewer(viewerId)) await refreshUserFollowStatus(id, viewerId);
    return { ok: true };
  } catch (cause) {
    const message = failureMessage(cause);
    publish(id, viewerId, {
      following: previousFollowing,
      pending: false,
      loading: false,
      error: message,
    });
    return { ok: false, message };
  }
}

export function useUserFollow(targetUserId?: string): UserFollowSnapshot & {
  refreshStatus: () => Promise<void>;
  toggleFollow: () => Promise<UserFollowOperationResult>;
} {
  const id = normalizeUserId(targetUserId);
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const subscribeToTarget = useCallback(
    (listener: () => void) => subscribe(id, viewerId, listener),
    [id, viewerId],
  );
  const getSnapshot = useCallback(
    () => getUserFollowSnapshot(id, viewerId),
    [id, viewerId],
  );
  const snapshot = useSyncExternalStore(subscribeToTarget, getSnapshot, getSnapshot);

  useEffect(() => {
    if (id) void refreshUserFollowStatus(id, viewerId);
  }, [id, viewerId]);

  const refreshStatus = useCallback(() => refreshUserFollowStatus(id, viewerId), [id, viewerId]);
  const toggleFollow = useCallback(() => toggleUserFollow(id, viewerId), [id, viewerId]);

  return { ...snapshot, refreshStatus, toggleFollow };
}
