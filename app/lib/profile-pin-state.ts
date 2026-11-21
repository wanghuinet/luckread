import { useEffect, useSyncExternalStore } from 'react';

import { apiRequest, createIdempotencyKey, getApiErrorMessage } from './api-client';

export type ProfilePinSnapshot = {
  userId: string | null;
  contentId: string | null;
  loaded: boolean;
  loading: boolean;
  pending: boolean;
  error: string | null;
};

export type ProfilePinOperationResult = {
  ok: boolean;
  status?: number;
  message?: string;
};

const EMPTY_SNAPSHOT: ProfilePinSnapshot = Object.freeze({
  userId: null,
  contentId: null,
  loaded: false,
  loading: false,
  pending: false,
  error: null,
});

let snapshot: ProfilePinSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();
let loadGeneration = 0;
let activeLoad: { userId: string; generation: number; promise: Promise<void> } | null = null;

function publish(next: ProfilePinSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProfilePinSnapshot(): ProfilePinSnapshot {
  return snapshot;
}

function normalizeId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPinnedContentId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('data' in value)) return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || !('contentId' in data)) return null;
  const contentId = (data as { contentId?: unknown }).contentId;
  return typeof contentId === 'string' && contentId.trim() ? contentId.trim() : null;
}

/** Load the signed-in user's single profile pin once for all mounted feed cards. */
export async function refreshProfilePin(userIdValue: string | null | undefined): Promise<void> {
  const userId = normalizeId(userIdValue);
  if (!userId) return;
  if (snapshot.userId === userId && (snapshot.loaded || snapshot.loading || snapshot.pending)) return;
  if (activeLoad?.userId === userId) return activeLoad.promise;

  const generation = ++loadGeneration;
  const promise = (async () => {
    publish({
      userId,
      contentId: null,
      loaded: false,
      loading: true,
      pending: false,
      error: null,
    });
    try {
      const result = await apiRequest<unknown>(
        '/users/' + encodeURIComponent(userId) + '/pinned-content',
        { method: 'GET', auth: false },
      );
      if (generation !== loadGeneration) return;
      if (!result.response.ok) {
        publish({
          userId,
          contentId: null,
          loaded: false,
          loading: false,
          pending: false,
          error: result.error?.message ?? getApiErrorMessage(
            result.data,
            'Could not load the current profile pin.',
            result.response.status,
          ),
        });
        return;
      }
      publish({
        userId,
        contentId: readPinnedContentId(result.data),
        loaded: true,
        loading: false,
        pending: false,
        error: null,
      });
    } catch (cause) {
      if (generation !== loadGeneration) return;
      publish({
        userId,
        contentId: null,
        loaded: false,
        loading: false,
        pending: false,
        error: cause instanceof Error ? cause.message : 'Could not load the current profile pin.',
      });
    } finally {
      if (activeLoad?.generation === generation) activeLoad = null;
    }
  })();
  activeLoad = { userId, generation, promise };
  return promise;
}

/** Pin/unpin the current user's published post through the existing W01 -> W05 boundary. */
export async function setProfilePin(
  userIdValue: string | null | undefined,
  contentIdValue: string | null | undefined,
  pinned: boolean,
): Promise<ProfilePinOperationResult> {
  const userId = normalizeId(userIdValue);
  const contentId = normalizeId(contentIdValue);
  if (!userId || !contentId) {
    return { ok: false, message: 'This post or account is not connected to a LuckRead ID.' };
  }
  if (snapshot.userId === userId && (snapshot.loading || snapshot.pending)) {
    return { ok: false, message: 'Profile pin status is still syncing. Please try again.' };
  }

  const previous = snapshot.userId === userId ? snapshot : null;
  const generation = ++loadGeneration;
  activeLoad = null;
  publish({
    userId,
    contentId: previous?.contentId ?? null,
    loaded: previous?.loaded ?? false,
    loading: false,
    pending: true,
    error: null,
  });

  try {
    const result = await apiRequest<unknown>(
      '/content/' + encodeURIComponent(contentId) + '/pin',
      {
        method: pinned ? 'POST' : 'DELETE',
        idempotencyKey: createIdempotencyKey(),
      },
    );
    if (generation !== loadGeneration) {
      return { ok: false, message: 'Profile pin state changed during this request. Refresh and try again.' };
    }
    if (!result.response.ok) {
      const message = result.error?.message ?? getApiErrorMessage(
        result.data,
        pinned ? 'Could not pin this post to the profile.' : 'Could not remove this profile pin.',
        result.response.status,
      );
      publish({
        userId,
        contentId: previous?.contentId ?? null,
        loaded: previous?.loaded ?? false,
        loading: false,
        pending: false,
        error: message,
      });
      return { ok: false, status: result.response.status, message };
    }

    publish({
      userId,
      contentId: pinned ? contentId : previous?.contentId === contentId ? null : previous?.contentId ?? null,
      loaded: true,
      loading: false,
      pending: false,
      error: null,
    });
    return { ok: true };
  } catch (cause) {
    if (generation === loadGeneration) {
      publish({
        userId,
        contentId: previous?.contentId ?? null,
        loaded: previous?.loaded ?? false,
        loading: false,
        pending: false,
        error: cause instanceof Error ? cause.message : 'Could not update the profile pin.',
      });
    }
    return { ok: false, message: cause instanceof Error ? cause.message : 'Could not update the profile pin.' };
  }
}

export function useProfilePinSnapshot(userIdValue: string | null | undefined): ProfilePinSnapshot {
  const userId = normalizeId(userIdValue);
  const current = useSyncExternalStore(subscribe, getProfilePinSnapshot, getProfilePinSnapshot);

  useEffect(() => {
    if (userId) void refreshProfilePin(userId);
  }, [userId]);

  if (!userId || current.userId !== userId) return EMPTY_SNAPSHOT;
  return current;
}
