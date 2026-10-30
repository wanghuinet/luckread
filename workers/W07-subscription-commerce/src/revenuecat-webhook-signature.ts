const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const MAX_EVENT_DATA_JSON_BYTES = 16 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const SIGNATURE_PATTERN = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;

export class RevenueCatWebhookValidationError extends Error {
  constructor(readonly code: 'INVALID_SIGNATURE' | 'WEBHOOK_REJECTED') {
    super(code);
    this.name = 'RevenueCatWebhookValidationError';
  }
}

export type RevenueCatWebhookEvent = Readonly<{
  apiVersion: string;
  appId: string;
  eventId: string;
  eventType: string;
  eventTimestampMs: number;
  appUserId: string | null;
  productId: string | null;
  store: string | null;
  environment: 'PRODUCTION' | 'SANDBOX' | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  eventDataJson: string;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoundedString = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= maxLength &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/.test(value);

function constantTimeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function toHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return constantTimeBytesEqual(new TextEncoder().encode(left), new TextEncoder().encode(right));
}

/** Compare the custom Authorization value configured in the RevenueCat dashboard. */
export function verifyRevenueCatAuthorization(
  supplied: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (typeof supplied !== 'string' || typeof expected !== 'string' ||
      expected.length < 1 || expected.length > 5000 || supplied.length > 5000) return false;
  return constantTimeBytesEqual(new TextEncoder().encode(supplied), new TextEncoder().encode(expected));
}

/**
 * Verify X-RevenueCat-Webhook-Signature over the exact raw bytes:
 * HMAC-SHA256(secret, UTF8(timestamp + '.') || rawBody).
 * RevenueCat re-signs every retry, so a short timestamp tolerance prevents
 * replay without rejecting legitimate provider retries.
 */
export async function verifyRevenueCatWebhookSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!(rawBody instanceof ArrayBuffer) || rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES ||
      typeof secret !== 'string' || secret.trim().length === 0 || secret.length > 4096 ||
      typeof signatureHeader !== 'string' || signatureHeader.length > 256 ||
      !Number.isFinite(nowMs)) return false;

  const match = SIGNATURE_PATTERN.exec(signatureHeader);
  if (!match) return false;
  const timestamp = Number(match[1]);
  const suppliedSignature = match[2]!;
  if (!Number.isSafeInteger(timestamp) || timestamp < 1 ||
      Math.abs(Math.floor(nowMs / 1000) - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const prefix = new TextEncoder().encode(String(timestamp) + '.');
    const signedBytes = new Uint8Array(prefix.byteLength + rawBody.byteLength);
    signedBytes.set(prefix, 0);
    signedBytes.set(new Uint8Array(rawBody), prefix.byteLength);
    const digest = await crypto.subtle.sign('HMAC', key, signedBytes);
    return constantTimeHexEqual(toHex(new Uint8Array(digest)), suppliedSignature);
  } catch {
    return false;
  }
}

const EVENT_STRING_FIELDS = [
  'app_user_id',
  'original_app_user_id',
  'product_id',
  'new_product_id',
  'store',
  'environment',
  'transaction_id',
  'original_transaction_id',
  'redeemed_by',
  'redemption_outcome',
  'period_type',
  'cancel_reason',
  'expiration_reason',
  'country_code',
  'currency',
  'offer_code',
  'presented_offering_id',
] as const;

const EVENT_ARRAY_FIELDS = [
  'aliases',
  'entitlement_ids',
  'transferred_from',
  'transferred_to',
] as const;

const EVENT_NUMBER_FIELDS = [
  'expiration_at_ms',
  'purchased_at_ms',
  'price',
  'price_in_purchased_currency',
  'quantity',
  'tax_percentage',
  'commission_percentage',
  'takehome_percentage',
] as const;

function sanitizedEventData(event: Record<string, unknown>): string {
  const data: Record<string, unknown> = {};
  for (const key of EVENT_STRING_FIELDS) {
    if (!Object.hasOwn(event, key)) continue;
    const value = event[key];
    if (value !== null && !isBoundedString(value, 255)) {
      throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
    }
    data[key] = value;
  }
  for (const key of EVENT_ARRAY_FIELDS) {
    if (!Object.hasOwn(event, key)) continue;
    const value = event[key];
    if (value !== null && (!Array.isArray(value) || value.length > 64 ||
        !value.every((item) => isBoundedString(item, 255)))) {
      throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
    }
    data[key] = value;
  }
  for (const key of EVENT_NUMBER_FIELDS) {
    if (!Object.hasOwn(event, key)) continue;
    const value = event[key];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) ||
        value < 0 || value > Number.MAX_SAFE_INTEGER)) {
      throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
    }
    data[key] = value;
  }
  if (Object.hasOwn(event, 'is_family_share')) {
    const value = event.is_family_share;
    if (value !== null && typeof value !== 'boolean') {
      throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
    }
    data.is_family_share = value;
  }

  const serialized = JSON.stringify(data);
  if (new TextEncoder().encode(serialized).byteLength > MAX_EVENT_DATA_JSON_BYTES) {
    throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
  }
  return serialized;
}

/**
 * Extract only fields needed for future current-state reconciliation.
 * Unknown event types/fields are accepted and preserved only through the
 * minimal allowlist; subscriber_attributes and raw request bodies are omitted.
 */
export function parseRevenueCatWebhookEnvelope(
  rawBody: ArrayBuffer,
  allowedAppIds: ReadonlySet<string>,
): RevenueCatWebhookEvent {
  if (!(rawBody instanceof ArrayBuffer) || rawBody.byteLength < 2 ||
      rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)) as unknown;
  } catch {
    throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
  }
  if (!isRecord(decoded) || !isBoundedString(decoded.api_version, 32) || !isRecord(decoded.event)) {
    throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
  }
  const event = decoded.event;
  if (!isBoundedString(event.id, 255) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(event.id) ||
      !isBoundedString(event.type, 64) ||
      !/^[A-Z][A-Z0-9_]{0,63}$/.test(event.type) ||
      !isBoundedString(event.app_id, 255) ||
      !allowedAppIds.has(event.app_id) ||
      !Number.isSafeInteger(event.event_timestamp_ms) ||
      (event.event_timestamp_ms as number) < 1) {
    throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
  }

  const optionalString = (key: typeof EVENT_STRING_FIELDS[number]): string | null => {
    const value = event[key];
    if (value === undefined || value === null) return null;
    if (!isBoundedString(value, 255)) throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
    return value;
  };

  const environmentValue = optionalString('environment');
  if (environmentValue !== null && environmentValue !== 'PRODUCTION' && environmentValue !== 'SANDBOX') {
    throw new RevenueCatWebhookValidationError('WEBHOOK_REJECTED');
  }

  return {
    apiVersion: decoded.api_version,
    appId: event.app_id,
    eventId: event.id,
    eventType: event.type,
    eventTimestampMs: event.event_timestamp_ms as number,
    appUserId: optionalString('app_user_id'),
    productId: optionalString('product_id'),
    store: optionalString('store'),
    environment: environmentValue,
    transactionId: optionalString('transaction_id'),
    originalTransactionId: optionalString('original_transaction_id'),
    eventDataJson: sanitizedEventData(event),
  };
}
