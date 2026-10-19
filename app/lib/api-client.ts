import { readSessionToken, saveSessionToken } from './secure-session';

const DEFAULT_API_BASE_URL = 'https://luckread.com';

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  requestId?: string;
};

export type ApiResult<T> = {
  response: Response;
  data: T | ApiErrorBody | null;
};

type ApiRequestOptions = RequestInit & {
  /** Set false for public authentication endpoints such as login. */
  auth?: boolean;
};

export class LuckReadApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody | null, fallbackMessage: string) {
    super(body?.error?.message || fallbackMessage);
    this.name = 'LuckReadApiError';
    this.status = status;
    this.code = body?.error?.code;
    this.requestId = body?.requestId;
  }
}

export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

/**
 * Native clients authenticate with the same Better Auth session as web clients.
 * The opaque credential comes from X-LuckRead-Session-Token and is persisted in
 * platform-secure storage, never in AsyncStorage, logs, URLs, or JSON bodies.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const { auth = true, headers: inputHeaders, ...init } = options;
  const headers = new Headers(inputHeaders || {});
  headers.set('Accept', 'application/json');

  if (init.body !== undefined && init.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (auth) {
    const token = await readSessionToken();
    if (token) headers.set('Authorization', 'Bearer ' + token);
  }

  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const response = await fetch(getApiBaseUrl() + '/api/v1' + normalizedPath, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const renewedCredential = response.headers.get('X-LuckRead-Session-Token');
  if (renewedCredential) await saveSessionToken(renewedCredential);

  let data: T | ApiErrorBody | null = null;
  try {
    data = (await response.json()) as T | ApiErrorBody;
  } catch {
    // Logout and other no-content responses intentionally have no JSON body.
  }

  return { response, data };
}

export function getApiErrorMessage(
  data: unknown,
  fallback = 'LuckRead service is temporarily unavailable. Please try again.',
): string {
  if (
    data &&
    typeof data === 'object' &&
    'error' in data &&
    (data as ApiErrorBody).error &&
    typeof (data as ApiErrorBody).error?.message === 'string'
  ) {
    return (data as ApiErrorBody).error?.message || fallback;
  }
  return fallback;
}
