/**
 * Read-only RevenueCat customer snapshot adapter for W07.
 *
 * This module deliberately does not mutate Membership, Payment, Order, or
 * Entitlement state. A webhook event is only a reconciliation hint; callers
 * must still bind the returned original App User ID to a verified LuckRead
 * identity and resolve exact store-product mappings before any state change.
 */

export type RevenueCatSubscriberApiErrorCode =
  | 'CONFIGURATION_REQUIRED'
  | 'INVALID_APP_USER_ID'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_REJECTED'
  | 'INVALID_RESPONSE';

export class RevenueCatSubscriberApiError extends Error {
  constructor(
    readonly code: RevenueCatSubscriberApiErrorCode,
    readonly retryable: boolean,
    readonly upstreamStatus: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = 'RevenueCatSubscriberApiError';
  }
}

export type RevenueCatSubscriberEntitlement = Readonly<{
  expires_date: string | null;
  grace_period_expires_date?: string | null;
  product_identifier: string;
  purchase_date: string;
}>;

export type RevenueCatSubscriberSubscription = Readonly<{
  auto_resume_date?: string | null;
  billing_issues_detected_at?: string | null;
  expires_date: string | null;
  grace_period_expires_date?: string | null;
  is_sandbox?: boolean;
  original_purchase_date?: string | null;
  ownership_type?: string;
  period_type?: string;
  purchase_date: string;
  refunded_at?: string | null;
  store?: string;
  store_transaction_id?: string | number | null;
  original_transaction_id?: string | null;
  unsubscribe_detected_at?: string | null;
}>;

export type RevenueCatSubscriberSnapshot = Readonly<{
  /** The exact App User ID used in the lookup; it is an identifier, not proof of purchase. */
  queriedAppUserId: string;
  /** RevenueCat's stable first App User ID. Never substitute queriedAppUserId when this is absent. */
  originalAppUserId: string | null;
  aliases: readonly string[];
  firstSeen: string | null;
  originalPurchaseDate: string | null;
  managementUrl: string | null;
  entitlements: Readonly<Record<string, RevenueCatSubscriberEntitlement>>;
  subscriptions: Readonly<Record<string, RevenueCatSubscriberSubscription>>;
  requestDate: string | null;
  requestDateMs: number | null;
  /** RevenueCat returns 201 when this get-or-create lookup creates an empty customer. */
  customerCreatedOnLookup: boolean;
}>;

export type RevenueCatSubscriberApiDependencies = Readonly<{
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>;

const API_BASE_URL = 'https://api.revenuecat.com/v1';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_APP_USER_ID_LENGTH = 255;
const MAX_SECRET_LENGTH = 4_096;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function optionalNullableDate(record: UnknownRecord, key: string): string | null | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (!isNullableDate(value)) throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
  return value;
}

function optionalText(record: UnknownRecord, key: string, maxLength: number): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (!isBoundedText(value, maxLength)) throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
  return value;
}

function optionalNullableText(record: UnknownRecord, key: string, maxLength: number): string | null | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (value === null) return null;
  if (!isBoundedText(value, maxLength)) throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
  return value;
}

function parseEntitlements(value: unknown): Record<string, RevenueCatSubscriberEntitlement> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > 256) {
    throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
  }

  const result: Record<string, RevenueCatSubscriberEntitlement> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isBoundedText(key, 255) || !isRecord(raw) ||
        !isNullableDate(raw.expires_date) ||
        !isBoundedText(raw.product_identifier, 255) ||
        !isBoundedText(raw.purchase_date, 64) ||
        !Number.isFinite(Date.parse(raw.purchase_date))) {
      throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
    }
    const grace = optionalNullableDate(raw, 'grace_period_expires_date');
    Object.defineProperty(result, key, {
      value: {
        expires_date: raw.expires_date,
        ...(grace === undefined ? {} : { grace_period_expires_date: grace }),
        product_identifier: raw.product_identifier,
        purchase_date: raw.purchase_date,
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function parseSubscriptions(value: unknown): Record<string, RevenueCatSubscriberSubscription> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.keys(value).length > 256) {
    throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
  }

  const result: Record<string, RevenueCatSubscriberSubscription> = {};
  const dateFields = [
    'auto_resume_date',
    'billing_issues_detected_at',
    'grace_period_expires_date',
    'original_purchase_date',
    'refunded_at',
    'unsubscribe_detected_at',
  ] as const;
  const textFields = ['ownership_type', 'period_type', 'store'] as const;

  for (const [productId, raw] of Object.entries(value)) {
    if (!isBoundedText(productId, 255) || !isRecord(raw) ||
        !isNullableDate(raw.expires_date) ||
        !isBoundedText(raw.purchase_date, 64) ||
        !Number.isFinite(Date.parse(raw.purchase_date))) {
      throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
    }

    const parsed: {
      auto_resume_date?: string | null;
      billing_issues_detected_at?: string | null;
      expires_date: string | null;
      grace_period_expires_date?: string | null;
      is_sandbox?: boolean;
      original_purchase_date?: string | null;
      ownership_type?: string;
      period_type?: string;
      original_transaction_id?: string | null;
      purchase_date: string;
      refunded_at?: string | null;
      store?: string;
      store_transaction_id?: string | number | null;
      unsubscribe_detected_at?: string | null;
    } = {
      expires_date: raw.expires_date,
      purchase_date: raw.purchase_date,
    };

    for (const field of dateFields) {
      const fieldValue = optionalNullableDate(raw, field);
      if (fieldValue !== undefined) parsed[field] = fieldValue;
    }
    for (const field of textFields) {
      const fieldValue = optionalText(raw, field, 128);
      if (fieldValue !== undefined) parsed[field] = fieldValue;
    }
    if (Object.hasOwn(raw, 'is_sandbox')) {
      if (typeof raw.is_sandbox !== 'boolean') {
        throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
      }
      parsed.is_sandbox = raw.is_sandbox;
    }
    if (Object.hasOwn(raw, 'original_transaction_id')) {
      parsed.original_transaction_id = optionalNullableText(raw, 'original_transaction_id', 255) ?? null;
    }
    if (Object.hasOwn(raw, 'store_transaction_id')) {
      const transactionId = raw.store_transaction_id;
      if (transactionId !== null &&
          typeof transactionId !== 'string' &&
          (typeof transactionId !== 'number' || !Number.isSafeInteger(transactionId) || transactionId < 0)) {
        throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
      }
      if (typeof transactionId === 'string' && transactionId.length > 255) {
        throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
      }
      parsed.store_transaction_id = transactionId as string | number | null;
    }
    Object.defineProperty(result, productId, {
      value: parsed,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function parseSubscriber(
  value: unknown,
  queriedAppUserId: string,
  customerCreatedOnLookup: boolean,
  requestDate: unknown,
  requestDateMs: unknown,
): RevenueCatSubscriberSnapshot {
  if (!isRecord(value)) throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);

  const originalAppUserId = optionalNullableText(value, 'original_app_user_id', 255) ?? null;
  const firstSeen = optionalNullableDate(value, 'first_seen') ?? null;
  const originalPurchaseDate = optionalNullableDate(value, 'original_purchase_date') ?? null;
  const managementUrl = optionalNullableText(value, 'management_url', 2_048) ?? null;

  let aliases: string[] = [];
  if (Object.hasOwn(value, 'aliases')) {
    if (!Array.isArray(value.aliases) || value.aliases.length > 256 ||
        !value.aliases.every((alias) => isBoundedText(alias, 255))) {
      throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
    }
    aliases = [...value.aliases];
  }

  if (requestDate !== undefined && requestDate !== null &&
      (!isBoundedText(requestDate, 64) || !Number.isFinite(Date.parse(requestDate)))) {
    throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
  }
  if (requestDateMs !== undefined && requestDateMs !== null &&
      (typeof requestDateMs !== 'number' || !Number.isSafeInteger(requestDateMs) || requestDateMs < 0)) {
    throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
  }

  return {
    queriedAppUserId,
    originalAppUserId,
    aliases,
    firstSeen,
    originalPurchaseDate,
    managementUrl,
    entitlements: parseEntitlements(value.entitlements),
    subscriptions: parseSubscriptions(value.subscriptions),
    requestDate: typeof requestDate === 'string' ? requestDate : null,
    requestDateMs: typeof requestDateMs === 'number' ? requestDateMs : null,
    customerCreatedOnLookup,
  };
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 3_600);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(Math.max(Math.ceil((date - now) / 1_000), 0), 3_600);
}

async function readBoundedResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes) {
      throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false, response.status);
    }
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false, response.status);
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof RevenueCatSubscriberApiError) throw error;
    throw new RevenueCatSubscriberApiError('UPSTREAM_UNAVAILABLE', true, response.status);
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Fetches the current RevenueCat v1 customer snapshot.
 *
 * This is deliberately a read-only adapter. RevenueCat's GET endpoint is
 * get-or-create: HTTP 201 is surfaced as customerCreatedOnLookup=true with an
 * empty entitlement/subscription map, never as evidence of an active purchase.
 */
export async function fetchRevenueCatSubscriber(
  input: Readonly<{ appUserId: string; secretApiKey: string | null | undefined }>,
  dependencies: RevenueCatSubscriberApiDependencies = {},
): Promise<RevenueCatSubscriberSnapshot> {
  const apiKey = input.secretApiKey;
  if (!isBoundedText(apiKey, MAX_SECRET_LENGTH)) {
    throw new RevenueCatSubscriberApiError('CONFIGURATION_REQUIRED', false);
  }
  if (!isBoundedText(input.appUserId, MAX_APP_USER_ID_LENGTH)) {
    throw new RevenueCatSubscriberApiError('INVALID_APP_USER_ID', false);
  }

  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = dependencies.maxResponseBytes ?? MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 ||
      maxResponseBytes > 2 * 1024 * 1024) {
    throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false);
  }

  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const url = API_BASE_URL + '/subscribers/' + encodeURIComponent(input.appUserId);

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new RevenueCatSubscriberApiError('UPSTREAM_UNAVAILABLE', true);
  }

  if (response.status !== 200 && response.status !== 201) {
    const retryable = response.status === 429 || response.status >= 500;
    const code = response.status === 429
      ? 'RATE_LIMITED'
      : retryable ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_REJECTED';
    throw new RevenueCatSubscriberApiError(
      code,
      retryable,
      response.status,
      response.status === 429 ? parseRetryAfter(response.headers.get('retry-after'), now()) : null,
    );
  }

  const bytes = await readBoundedResponseBody(response, maxResponseBytes);
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false, response.status);
  }
  if (!isRecord(decoded) || !Object.hasOwn(decoded, 'subscriber')) {
    throw new RevenueCatSubscriberApiError('INVALID_RESPONSE', false, response.status);
  }

  return parseSubscriber(
    decoded.subscriber,
    input.appUserId,
    response.status === 201,
    decoded.request_date,
    decoded.request_date_ms,
  );
}
