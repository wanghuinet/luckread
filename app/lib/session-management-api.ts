import { apiRequest, type ApiResult } from './api-client';

export const SESSION_PAGE_SIZE = 20;

export type SessionListItem = {
  sessionId: string;
  deviceId?: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
};

export type SessionListPage = {
  items: SessionListItem[];
  currentSessionId: string;
  nextCursor: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isDateTime = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export function parseSessionListPage(value: unknown): SessionListPage | null {
  if (!isRecord(value) ||
      typeof value.currentSessionId !== 'string' ||
      value.currentSessionId.length === 0 ||
      !(value.nextCursor === null || typeof value.nextCursor === 'string') ||
      !Array.isArray(value.items)) {
    return null;
  }

  const items: SessionListItem[] = [];
  for (const candidate of value.items) {
    if (!isRecord(candidate) ||
        typeof candidate.sessionId !== 'string' ||
        candidate.sessionId.length === 0 ||
        !isDateTime(candidate.createdAt) ||
        !isDateTime(candidate.expiresAt) ||
        !(candidate.lastSeenAt === null || isDateTime(candidate.lastSeenAt)) ||
        (candidate.deviceId !== undefined && typeof candidate.deviceId !== 'string')) {
      return null;
    }

    items.push({
      sessionId: candidate.sessionId,
      ...(typeof candidate.deviceId === 'string' ? { deviceId: candidate.deviceId } : {}),
      createdAt: candidate.createdAt,
      expiresAt: candidate.expiresAt,
      lastSeenAt: candidate.lastSeenAt,
    });
  }

  return {
    items,
    currentSessionId: value.currentSessionId,
    nextCursor: value.nextCursor,
  };
}

export async function fetchSessionListPage(options: {
  cursor?: string | null;
  signal?: AbortSignal;
} = {}): Promise<ApiResult<unknown>> {
  const params = new URLSearchParams({ limit: String(SESSION_PAGE_SIZE) });
  if (options.cursor !== undefined && options.cursor !== null) {
    const cursor = options.cursor.trim();
    if (!cursor || cursor.length > 256) {
      throw new TypeError('A valid session cursor is required.');
    }
    params.set('cursor', cursor);
  }

  return apiRequest<unknown>('/auth/sessions?' + params.toString(), {
    method: 'GET',
    signal: options.signal,
  });
}

export async function revokeSession(sessionId: string): Promise<ApiResult<unknown>> {
  const targetId = sessionId.trim();
  if (!targetId || targetId.length > 128) {
    throw new TypeError('A valid session identifier is required.');
  }

  // apiRequest supplies a stable Idempotency-Key for DELETE and reuses it for
  // retries, matching the existing W01 session-revocation contract.
  return apiRequest<unknown>('/auth/sessions/' + encodeURIComponent(targetId), {
    method: 'DELETE',
  });
}
