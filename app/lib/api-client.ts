import { readSessionToken, saveSessionToken } from './secure-session';

const DEFAULT_API_BASE_URL = 'https://api.luckread.com';
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

type MutationOutcome = 'success' | 'definitive' | 'transient';

type PendingMutationEntry = {
  key: string;
  expiresAt: number;
  inFlight: number;
  retryable: boolean;
};

type PendingMutationLease = {
  signature: string;
  entry: PendingMutationEntry;
};

const pendingMutationKeys = new Map<string, PendingMutationEntry>();
const PENDING_MUTATION_TTL_MS = 15 * 60 * 1000;
const MAX_PENDING_MUTATION_KEYS = 512;

/** Prevent a pending key from crossing sign-in/account boundaries. */
export function clearPendingMutationKeys(): void {
  pendingMutationKeys.clear();
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map((key) =>
    JSON.stringify(key) + ':' + stableSerialize(record[key]),
  ).join(',') + '}';
}

/** Short non-secret fingerprint: request bodies (which may contain private text) aren't retained as Map keys. */
function fingerprintText(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return (first >>> 0).toString(16).padStart(8, '0') +
    (second >>> 0).toString(16).padStart(8, '0');
}

function formDataValueForFingerprint(value: unknown): unknown {
  if (typeof value === 'string') return ['text', value];
  if (!value || typeof value !== 'object') return [typeof value];
  const record = value as Record<string, unknown>;
  if (typeof record.uri === 'string') {
    return [
      'native-file',
      record.uri,
      typeof record.name === 'string' ? record.name : '',
      typeof record.type === 'string' ? record.type : '',
      typeof record.size === 'number' ? record.size : null,
    ];
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const file = value as Blob & { name?: string; lastModified?: number };
    return ['blob', file.type, file.size, file.name ?? '', file.lastModified ?? null];
  }
  return ['object', stableSerialize(value)];
}

/**
 * Derive a stable request signature so a later call that retries the exact same
 * mutation reuses its prior key after an ambiguous transport/5xx failure.
 * Explicitly provided keys are still honored for the first attempt.
 */
function mutationSignature(
  method: string,
  url: string,
  body: BodyInit | null | undefined,
  ifMatch: string | null,
  uploadFingerprint: string | null,
): string | null {
  let bodyShape: string;
  if (body === undefined || body === null) {
    bodyShape = 'none';
  } else if (typeof body === 'string') {
    try {
      bodyShape = stableSerialize(JSON.parse(body));
    } catch {
      bodyShape = body;
    }
  } else if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    bodyShape = body.toString();
  } else if (isFormDataBody(body) && uploadFingerprint) {
    // For file streams, the caller-provided fingerprint is the stable semantic
    // identity; multipart boundaries and native File wrapper timestamps vary
    // between attempts and must not generate a new key.
    bodyShape = 'upload:' + uploadFingerprint;
  } else if (isFormDataBody(body)) {
    const entries: unknown[] = [];
    try {
      body.forEach((value, key) => entries.push([key, formDataValueForFingerprint(value)]));
      bodyShape = stableSerialize(entries);
    } catch {
      return null;
    }
  } else if (typeof Blob !== 'undefined' && body instanceof Blob) {
    bodyShape = stableSerialize(formDataValueForFingerprint(body));
  } else {
    return null;
  }
  return fingerprintText([method, url, ifMatch ?? '', uploadFingerprint ?? '', bodyShape].join('\\0'));
}

function acquireMutationKey(
  signature: string,
  preferredKey?: string,
): PendingMutationLease {
  const now = Date.now();
  for (const [key, value] of pendingMutationKeys) {
    if (value.inFlight === 0 && value.expiresAt <= now) pendingMutationKeys.delete(key);
  }

  const current = pendingMutationKeys.get(signature);
  if (current && (current.expiresAt > now || current.inFlight > 0)) {
    current.inFlight += 1;
    current.expiresAt = now + PENDING_MUTATION_TTL_MS;
    pendingMutationKeys.delete(signature);
    pendingMutationKeys.set(signature, current);
    return { signature, entry: current };
  }

  if (current) pendingMutationKeys.delete(signature);
  while (pendingMutationKeys.size >= MAX_PENDING_MUTATION_KEYS) {
    const oldest = pendingMutationKeys.keys().next();
    if (oldest.done) break;
    const entry = pendingMutationKeys.get(oldest.value);
    if (entry?.inFlight) {
      pendingMutationKeys.delete(oldest.value);
      pendingMutationKeys.set(oldest.value, entry);
      if ([...pendingMutationKeys.values()].every((candidate) => candidate.inFlight > 0)) break;
      continue;
    }
    pendingMutationKeys.delete(oldest.value);
  }

  const entry: PendingMutationEntry = {
    key: preferredKey || createIdempotencyKey(),
    expiresAt: now + PENDING_MUTATION_TTL_MS,
    inFlight: 1,
    retryable: false,
  };
  pendingMutationKeys.set(signature, entry);
  return { signature, entry };
}

function releaseMutationKey(lease: PendingMutationLease | null, outcome: MutationOutcome): void {
  if (!lease || pendingMutationKeys.get(lease.signature) !== lease.entry) return;
  const entry = lease.entry;
  entry.inFlight = Math.max(0, entry.inFlight - 1);
  if (outcome === 'transient') {
    entry.retryable = true;
    entry.expiresAt = Date.now() + PENDING_MUTATION_TTL_MS;
  } else if (entry.inFlight === 0) {
    entry.retryable = false;
    pendingMutationKeys.delete(lease.signature);
    return;
  } else {
    entry.retryable = false;
  }
  pendingMutationKeys.delete(lease.signature);
  pendingMutationKeys.set(lease.signature, entry);
}

const isAmbiguousMutationStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

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

  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const requestUrl = getApiBaseUrl() + '/v1' + normalizedPath;
  let mutationLease: PendingMutationLease | null = null;

  // Retry the exact same mutation with the same key after a network error,
  // timeout, rate limit, or 5xx response—even when a caller generated a fresh
  // explicit key on re-entry. Successful/definitive responses release the key.
  if (MUTATING_METHODS.has(method) && idempotencyKey !== false) {
    const signature = mutationSignature(
      method,
      requestUrl,
      init.body,
      headers.get('If-Match'),
      headers.get('X-LuckRead-Upload-Fingerprint'),
    );
    const explicitKey = typeof idempotencyKey === 'string' && idempotencyKey.trim()
      ? idempotencyKey.trim()
      : headers.get('Idempotency-Key')?.trim() || undefined;
    if (signature) {
      mutationLease = acquireMutationKey(signature, explicitKey);
      headers.set('Idempotency-Key', mutationLease.entry.key);
    } else if (explicitKey) {
      headers.set('Idempotency-Key', explicitKey);
    } else if (!headers.has('Idempotency-Key')) {
      headers.set('Idempotency-Key', createIdempotencyKey());
    }
  } else if (idempotencyKey === false) {
    headers.delete('Idempotency-Key');
  }

  if (auth) {
    const token = await readSessionToken();
    if (token) headers.set('Authorization', 'Bearer ' + token);
  }

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      ...init,
      method,
      headers,
      cache: 'no-store',
    });
  } catch {
    releaseMutationKey(mutationLease, 'transient');
    // Do not surface transport internals (which may include request details).
    throw new LuckReadNetworkError();
  }

  let outcome: MutationOutcome = 'transient';
  try {
    const renewedCredential = response.headers.get('X-LuckRead-Session-Token');
    if (renewedCredential) await saveSessionToken(renewedCredential);

    let data: T | ApiErrorBody | null = null;
    try {
      data = (await response.json()) as T | ApiErrorBody;
    } catch {
      // Logout and other no-content responses intentionally have no JSON body.
    }

    outcome = isAmbiguousMutationStatus(response.status)
      ? 'transient'
      : response.ok
        ? 'success'
        : 'definitive';

    return {
      response,
      data,
      error: response.ok ? null : classifyApiFailure(response, data),
    };
  } finally {
    releaseMutationKey(mutationLease, outcome);
  }
}


/**
 * Fetch a trusted W03 body reference through the shared native transport boundary.
 * This is for content-body text only; ordinary API calls must use apiRequest.
 */
export async function fetchContentBodyReference(
  value: string,
  options: { signal?: AbortSignal; sessionToken?: string | null } = {},
): Promise<Response> {
  const base = new URL(getApiBaseUrl());
  const target = new URL(value, base);
  const localDevelopmentHost = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  const protocolAllowed = target.protocol === 'https:' ||
    (localDevelopmentHost && target.origin === base.origin && target.protocol === 'http:');
  const trustedHost = target.origin === base.origin ||
    target.hostname === 'luckread.com' || target.hostname.endsWith('.luckread.com');

  if (
    !protocolAllowed ||
    !trustedHost ||
    target.username ||
    target.password ||
    target.hash
  ) {
    throw new TypeError('Unsupported LuckRead content body reference.');
  }

  const headers = new Headers({ Accept: 'text/plain, application/json;q=0.9, */*;q=0.8' });
  // First-party media delivery is a distinct W01 origin, but it authenticates
  // Bearer sessions and asks W03 to re-check content visibility on every read.
  // Never forward credentials to other LuckRead subdomains or arbitrary hosts.
  const trustedMediaDeliveryHost = target.protocol === 'https:' &&
    ['img.luckread.com', 'video.luckread.com'].includes(target.hostname);
  const maySendSession = target.origin === base.origin || trustedMediaDeliveryHost;
  if (maySendSession) {
    const token = options.sessionToken === undefined
      ? await readSessionToken().catch(() => null)
      : options.sessionToken;
    if (token) headers.set('Authorization', 'Bearer ' + token);
  }

  let response: Response;
  try {
    response = await fetch(target.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: options.signal,
      headers,
      redirect: 'manual',
    });
  } catch {
    throw new LuckReadNetworkError();
  }

  if (target.origin === base.origin) {
    const renewedCredential = response.headers.get('X-LuckRead-Session-Token');
    if (renewedCredential) await saveSessionToken(renewedCredential);
  }
  return response;
}
