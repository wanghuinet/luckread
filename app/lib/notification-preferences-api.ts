import { apiRequest, getApiErrorMessage } from './api-client';

export type NotificationPreferences = {
  follow: boolean;
  like: boolean;
  comment: boolean;
  mention: boolean;
};

export type NotificationPreferenceKey = keyof NotificationPreferences;

export class NotificationPreferencesApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'NotificationPreferencesApiError';
  }
}

const preferenceKeys: NotificationPreferenceKey[] = [
  'follow',
  'like',
  'comment',
  'mention',
];

function parsePreferences(value: unknown): NotificationPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  const candidate = envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, unknown>
    : envelope;

  if (!preferenceKeys.every((key) => typeof candidate[key] === 'boolean')) return null;
  return {
    follow: candidate.follow as boolean,
    like: candidate.like as boolean,
    comment: candidate.comment as boolean,
    mention: candidate.mention as boolean,
  };
}

function parseErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export async function fetchNotificationPreferences(
  signal?: AbortSignal,
): Promise<NotificationPreferences> {
  const result = await apiRequest<unknown>('/notification-preferences', {
    method: 'GET',
    signal,
  });
  if (!result.response.ok) {
    throw new NotificationPreferencesApiError(
      result.error?.message || getApiErrorMessage(
        result.data,
        'Could not load notification preferences. Please try again.',
        result.response.status,
      ),
      result.response.status,
      result.error?.code || parseErrorCode(result.data),
    );
  }
  const preferences = parsePreferences(result.data);
  if (!preferences) {
    throw new NotificationPreferencesApiError('The notification preferences response was invalid.');
  }
  return preferences;
}

export async function saveNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<NotificationPreferences> {
  for (const key of preferenceKeys) {
    if (typeof preferences[key] !== 'boolean') {
      throw new TypeError('Every notification preference must be a boolean.');
    }
  }

  const result = await apiRequest<unknown>('/notification-preferences', {
    method: 'PATCH',
    body: JSON.stringify({
      follow: preferences.follow,
      like: preferences.like,
      comment: preferences.comment,
      mention: preferences.mention,
    }),
  });
  if (!result.response.ok) {
    throw new NotificationPreferencesApiError(
      result.error?.message || getApiErrorMessage(
        result.data,
        'Could not save notification preferences. Please try again.',
        result.response.status,
      ),
      result.response.status,
      result.error?.code || parseErrorCode(result.data),
    );
  }
  const saved = parsePreferences(result.data);
  if (!saved) {
    throw new NotificationPreferencesApiError('The saved notification preferences response was invalid.');
  }
  return saved;
}
