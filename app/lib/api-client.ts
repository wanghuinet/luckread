import { readSessionToken, saveSessionToken } from './secure-session';

const DEFAULT_API_BASE_URL = 'https://luckread.com';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  requestId?: string;
};

export type ApiRecoveryAction =
  | 'sign-in'
  | 'check-permissions'
  | 'refresh-conflict'
  | 'correct-input'
  | 'wait-and-retry'
  | 'retry-request'
  | 'retry-later'
  | 'review-request';

export type ApiFailure = {
  status: number;
  code?: string;
  message: string;
  requestId?: string;
  recoveryAction: ApiRecoveryAction;
  retryable: boolean;
  retryAfterMs?: number;
};

export type ApiResult<T> = {
  response: Response;
  data: T | ApiErrorBody | null;
  /** A normalized, actionable failure for every non-2xx response. */
  error: ApiFailure | null;
};

type ApiRequestOptions = RequestInit & {
  /** Set false only where the API contract does not use idempotency keys. */
  idempotencyKey?: string | false;
  /** Set false for public authentication endpoints such as login. */
  auth?: boolean;
};

type RecoveryDefaults = {
  action: ApiRecoveryAction;
  message: string;
  retryable: boolean;
};

export class LuckReadNetworkError extends Error {
  readonly recoveryAction = 'retry-request' as const;
  readonly retryable = true;

  constructor() {
    super('Could not reach LuckRead. Check your connection and try again.');
    this.name = 'LuckReadNetworkError';
  }
}

/** Create a key once per logical write and reuse it if that operation is retried. */
export function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();

  // React Native runtimes do not all expose crypto.randomUUID. Idempotency keys
  // are identifiers rather than credentials, so a random fallback is sufficient.
  const segment = () => Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, '0');
  return 'lr-' + Date.now().toString(36) + '-' + segment() + segment();
}

export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  return (configured || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}

function isFormDataBody(body: BodyInit | null | undefined): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function parseRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return undefined;

  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Number(value) * 1000);

  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : undefined;
}

function recoveryDefaults(status: number): RecoveryDefaults {
  if (status === 401) {
    return {
      action: 'sign-in',
      message: 'Your session may have expired. Sign in again to continue.',
      retryable: false,
    };
  }
  if (status === 403) {
    return {
      action: 'check-permissions',
      message: 'You do not have permission to perform this action.',
      retryable: false,
    };
  }
  if (status === 409) {
    return {
      action: 'refresh-conflict',
      message: 'This item changed elsewhere. Refresh it and review the latest version before trying again.',
      retryable: false,
    };
  }
  if (status === 422) {
    return {
      action: 'correct-input',
      message: 'Some submitted information is invalid. Check it and try again.',
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      action: 'wait-and-retry',
      message: 'Too many requests. Wait a moment before trying again.',
      retryable: true,
    };
  }
  if (status === 408) {
    return {
      action: 'retry-request',
      message: 'The request timed out. Please try again.',
      retryable: true,
    };
  }
  if (status >= 500) {
    return {
      action: 'retry-later',
      message: 'LuckRead is temporarily unavailable. Please try again shortly.',
      retryable: true,
    };
  }
  return {
    action: 'review-request',
    message: 'The request could not be completed. Review it and try again.',
    retryable: false,
  };
}

export function getApiErrorMessage(
  data: unknown,
  fallback = 'LuckRead service is temporarily unavailable. Please try again.',
  status?: number,
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
  return status === undefined ? fallback : recoveryDefaults(status).message;
}

export function classifyApiFailure(response: Response, data: unknown): ApiFailure {
  const status = response.status;
  const defaults = recoveryDefaults(status);
  const body = data && typeof data === 'object' ? (data as ApiErrorBody) : null;
  return {
    status,
    code: typeof body?.error?.code === 'string' ? body.error.code : undefined,
    message: getApiErrorMessage(data, defaults.message, status),
    requestId: typeof body?.requestId === 'string' ? body.requestId : undefined,
    recoveryAction: defaults.action,
    retryable: defaults.retryable,
    retryAfterMs: status === 429 || status >= 500 ? parseRetryAfter(response) : undefined,
  };
}

/**
 * All native API calls go through this function so auth, content headers,
 * idempotency, no-store caching, renewed session credentials, and errors stay
 * consistent across features.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult<T>> {
  const { auth = true, idempotencyKey, headers: inputHeaders, ...init } = options;
  const headers = new Headers(inputHeaders || {});
  headers.set('Accept', 'application/json');

  const method = (init.method || 'GET').toUpperCase();
  const hasBody = init.body !== undefined && init.body !== null;

  // Let fetch create the multipart boundary. A caller-supplied Content-Type is
  // also removed for FormData because a boundary-less value breaks file uploads.
  if (isFormDataBody(init.body)) {
    headers.delete('Content-Type');
  } else if (hasBody && !headers.has('Content-Type')) {
    if (typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    } else if (
      typeof URLSearchParams !== 'undefined' &&
      init.body instanceof URLSearchParams
    ) {
      headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
    } else if (
      typeof Blob !== 'undefined' &&
      init.body instanceof Blob &&
      init.body.type
    ) {
      headers.set('Content-Type', init.body.type);
    }
  }

  // Writes get a key by default. Callers can provide a stable key for retries
  // of the same logical operation, or opt out for endpoints whose contract
  // explicitly does not use idempotency (for example login).
  if (MUTATING_METHODS.has(method)) {
    if (typeof idempotencyKey === 'string' && idempotencyKey.trim()) {
      headers.set('Idempotency-Key', idempotencyKey.trim());
    } else if (idempotencyKey !== false && !headers.has('Idempotency-Key')) {
      headers.set('Idempotency-Key', createIdempotencyKey());
    }
  }

  if (auth) {
    const token = await readSessionToken();
    if (token) headers.set('Authorization', 'Bearer ' + token);
  }

  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  let response: Response;
  try {
    response = await fetch(getApiBaseUrl() + '/api/v1' + normalizedPath, {
      ...init,
      method,
      headers,
      cache: 'no-store',
    });
  } catch {
    // Do not surface transport internals (which may include request details).
    throw new LuckReadNetworkError();
  }

  const renewedCredential = response.headers.get('X-LuckRead-Session-Token');
  if (renewedCredential) await saveSessionToken(renewedCredential);

  let data: T | ApiErrorBody | null = null;
  try {
    data = (await response.json()) as T | ApiErrorBody;
  } catch {
    // Logout and other no-content responses intentionally have no JSON body.
  }

  return {
    response,
    data,
    error: response.ok ? null : classifyApiFailure(response, data),
  };
}
