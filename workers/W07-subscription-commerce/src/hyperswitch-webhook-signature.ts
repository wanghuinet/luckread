/**
 * Verify Hyperswitch's outgoing webhook signature without parsing or
 * re-serializing the request body. Callers must pass the exact raw bytes from
 * Request.arrayBuffer() and persist/deduplicate event_id separately before
 * applying any business transition.
 *
 * Hyperswitch signs the serialized request bytes with HMAC-SHA512 and emits
 * the hex digest in X-Webhook-Signature-512.
 */
const SHA512_HEX_LENGTH = 128;
const SHA512_HEX_PATTERN = /^[0-9a-fA-F]{128}$/;
// Defense in depth for the verifier/parser. The HTTP route must also enforce
// this limit while reading the request stream, before buffering it in memory.
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

const RFC3339_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Parse a bounded RFC3339 timestamp only when its calendar/time components
 * are valid. Date.parse normalizes impossible dates such as February 31,
 * which is unsafe for provider event ordering and signed consent evidence.
 */
export function parseHyperswitchRfc3339Timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) return null;

  const monthEnd = new Date(0);
  monthEnd.setUTCFullYear(year, month, 0);
  monthEnd.setUTCHours(0, 0, 0, 0);
  if (day > monthEnd.getUTCDate()) return null;

  if (match[8] !== undefined) {
    const offsetHours = Number(match[9]);
    const offsetMinutes = Number(match[10]);
    if (offsetHours > 23 || offsetMinutes > 59) return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function constantTimeHexEqual(expected: string, supplied: string): boolean {
  if (expected.length !== SHA512_HEX_LENGTH || supplied.length !== SHA512_HEX_LENGTH) return false;

  let difference = 0;
  for (let index = 0; index < SHA512_HEX_LENGTH; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

function toHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

/**
 * Returns false for missing/malformed configuration, missing signatures,
 * mismatched bodies, or cryptographic errors. It never throws to the webhook
 * route, so an invalid signature can be rejected with a uniform response.
 */
export async function verifyHyperswitchWebhookSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!(rawBody instanceof ArrayBuffer) || rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) return false;
  if (typeof secret !== 'string' || secret.trim().length === 0) return false;
  if (typeof signatureHeader !== 'string') return false;

  const signature = signatureHeader.trim();
  if (!SHA512_HEX_PATTERN.test(signature)) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign'],
    );
    const digest = await crypto.subtle.sign('HMAC', key, rawBody);
    const expected = toHex(new Uint8Array(digest));
    return constantTimeHexEqual(expected, signature.toLowerCase());
  } catch {
    // Fail closed if the crypto runtime or supplied input is invalid.
    return false;
  }
}


const HYPERSWITCH_EVENT_TYPES = [
  'payment_succeeded',
  'payment_failed',
  'payment_processing',
  'payment_cancelled',
  'payment_cancelled_post_capture',
  'payment_authorized',
  'payment_partially_authorized',
  'payment_captured',
  'payment_expired',
  'action_required',
  'refund_succeeded',
  'refund_failed',
  'refund_review',
  'dispute_opened',
  'dispute_expired',
  'dispute_accepted',
  'dispute_cancelled',
  'dispute_challenged',
  'dispute_won',
  'dispute_lost',
  'mandate_active',
  'mandate_revoked',
  'payout_success',
  'payout_failed',
  'payout_initiated',
  'payout_processing',
  'payout_cancelled',
  'payout_expired',
  'payout_reversed',
  'payout_not_permitted',
  'invoice_paid',
  'surcharge_payment_succeeded',
  'surcharge_refund_succeeded',
] as const;

const HYPERSWITCH_CONTENT_TYPES = [
  'payment_details',
  'refund_details',
  'dispute_details',
  'mandate_details',
  'payout_details',
  'subscription_details',
] as const;

export type HyperswitchWebhookEventType = (typeof HYPERSWITCH_EVENT_TYPES)[number];
export type HyperswitchWebhookContentType = (typeof HYPERSWITCH_CONTENT_TYPES)[number];

export function isHyperswitchWebhookEventType(value: unknown): value is HyperswitchWebhookEventType {
  return typeof value === 'string' && (HYPERSWITCH_EVENT_TYPES as readonly string[]).includes(value);
}

export function isHyperswitchWebhookContentType(value: unknown): value is HyperswitchWebhookContentType {
  return typeof value === 'string' && (HYPERSWITCH_CONTENT_TYPES as readonly string[]).includes(value);
}

export type HyperswitchWebhookEnvelope = {
  merchantId: string;
  eventId: string;
  eventType: HyperswitchWebhookEventType;
  contentType: HyperswitchWebhookContentType;
  resource: Record<string, unknown>;
  timestamp?: string;
  processorMerchantId?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

/**
 * Decode only the documented Hyperswitch v1 outgoing webhook envelope.
 * Call only after verifyHyperswitchWebhookSignature succeeds.
 *
 * The expected merchant ID is required to prevent a structurally valid event
 * from another merchant being treated as a LuckRead event. This is still not
 * payment authorization: callers must bind the event to a known local
 * payment/order, persist event_id idempotently, and enforce event ordering
 * before updating financial or entitlement state.
 */
export function parseHyperswitchWebhookEnvelope(
  rawBody: ArrayBuffer,
  expectedMerchantId: string | null | undefined,
): HyperswitchWebhookEnvelope | null {
  if (!(rawBody instanceof ArrayBuffer) || rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) return null;
  if (!isNonBlankString(expectedMerchantId)) return null;
  let decoded: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    decoded = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(decoded)) return null;
  if (!isNonBlankString(decoded.merchant_id) || decoded.merchant_id !== expectedMerchantId) return null;
  if (!isNonBlankString(decoded.event_id)) return null;
  if (!isNonBlankString(decoded.event_type)) return null;
  if (!(HYPERSWITCH_EVENT_TYPES as readonly string[]).includes(decoded.event_type)) return null;

  if (!isRecord(decoded.content)) return null;
  if (typeof decoded.content.type !== 'string') return null;
  if (!(HYPERSWITCH_CONTENT_TYPES as readonly string[]).includes(decoded.content.type)) return null;
  if (!isRecord(decoded.content.object)) return null;

  if (decoded.timestamp !== undefined &&
      parseHyperswitchRfc3339Timestamp(decoded.timestamp) === null) return null;

  if (
    decoded.processor_merchant_id !== undefined &&
    decoded.processor_merchant_id !== null &&
    !isNonBlankString(decoded.processor_merchant_id)
  ) return null;

  return {
    merchantId: decoded.merchant_id,
    eventId: decoded.event_id,
    eventType: decoded.event_type as HyperswitchWebhookEventType,
    contentType: decoded.content.type as HyperswitchWebhookContentType,
    resource: decoded.content.object,
    ...(decoded.timestamp !== undefined ? { timestamp: decoded.timestamp } : {}),
    ...(decoded.processor_merchant_id !== undefined
      ? { processorMerchantId: decoded.processor_merchant_id as string | null }
      : {}),
  };
}
