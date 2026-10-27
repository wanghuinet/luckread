/**
 * Minimal server-only Hyperswitch Payments API adapter.
 *
 * This deliberately creates an unconfirmed payment intent only. It is not
 * wired to a route and cannot activate subscriptions or write financial
 * state. A caller must supply amount/currency/payment ID from an admitted
 * authoritative order, retain the same ID/key for retries, and wait for a
 * verified provider event before considering a payment successful.
 *
 * Upstream API: https://api-reference.hyperswitch.io/v1/payments/payments--create
 */

export type HyperswitchEnvironment = 'sandbox' | 'production';

export interface HyperswitchClientConfig {
  environment: HyperswitchEnvironment | string | null | undefined;
  apiKey: string | null | undefined;
}

export interface CreateHyperswitchPaymentIntentInput {
  /** Stable merchant-provided ID: exactly 30 chars, including the pay_ prefix. */
  paymentId: string;
  /** Must be a server-authoritative amount in the currency's lowest denomination. */
  amount: number;
  /** Uppercase ISO-4217-style currency code. Provider remains authoritative for support. */
  currency: string;
  /** LuckRead idempotency contract key; must be reused for semantic retries. */
  idempotencyKey: string;
}

export type HyperswitchPaymentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_customer_action'
  | 'requires_merchant_action'
  | 'requires_capture'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'cancelled_post_capture'
  | 'partially_captured'
  | 'partially_captured_and_capturable'
  | 'expired';

export interface HyperswitchPayment {
  paymentId: string;
  merchantId: string;
  amount: number;
  currency: string;
  status: HyperswitchPaymentStatus;
  /** Sensitive provider value; keep server-side until an authorized checkout response needs it. */
  clientSecret: string | null;
}

export type HyperswitchClientErrorCode =
  | 'CONFIGURATION_INVALID'
  | 'REQUEST_INVALID'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_REJECTED'
  | 'UPSTREAM_INVALID_RESPONSE';

export class HyperswitchClientError extends Error {
  constructor(
    public readonly code: HyperswitchClientErrorCode,
    message: string,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'HyperswitchClientError';
  }
}

const BASE_URLS: Record<HyperswitchEnvironment, string> = {
  sandbox: 'https://sandbox.hyperswitch.io',
  production: 'https://api.hyperswitch.io',
};

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PAYMENT_STATUSES = new Set<HyperswitchPaymentStatus>([
  'requires_payment_method',
  'requires_confirmation',
  'requires_customer_action',
  'requires_merchant_action',
  'requires_capture',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'cancelled_post_capture',
  'partially_captured',
  'partially_captured_and_capturable',
  'expired',
]);

function resolveConfig(config: HyperswitchClientConfig): {
  baseUrl: string;
  apiKey: string;
} {
  if (config.environment !== 'sandbox' && config.environment !== 'production') {
    throw new HyperswitchClientError('CONFIGURATION_INVALID', 'Hyperswitch environment must be explicitly set to sandbox or production.');
  }
  if (typeof config.apiKey !== 'string' || config.apiKey.length === 0 || config.apiKey.trim() !== config.apiKey || /[\r\n]/.test(config.apiKey)) {
    throw new HyperswitchClientError('CONFIGURATION_INVALID', 'Hyperswitch server API key is missing or malformed.');
  }
  return { baseUrl: BASE_URLS[config.environment], apiKey: config.apiKey };
}

function validateCreateInput(input: CreateHyperswitchPaymentIntentInput): void {
  if (typeof input.paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(input.paymentId)) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Payment ID must be the stable 30-character Hyperswitch payment identifier.');
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Amount must be a positive safe integer in the currency smallest unit.');
  }
  if (typeof input.currency !== 'string' || !CURRENCY_PATTERN.test(input.currency)) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Currency must be a three-letter uppercase code.');
  }
  if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Idempotency key does not match the canonical key format.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch response exceeded the allowed size.');
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch response body could not be read.');
  }
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch response exceeded the allowed size.');
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch returned invalid JSON.');
  }
}

function normalizePayment(value: unknown): HyperswitchPayment {
  if (!isRecord(value)) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch returned an invalid payment object.');
  }
  const { payment_id: paymentId, merchant_id: merchantId, amount, currency, status, client_secret: clientSecret } = value;
  if (
    typeof paymentId !== 'string' ||
    !PAYMENT_ID_PATTERN.test(paymentId) ||
    typeof merchantId !== 'string' ||
    merchantId.length === 0 ||
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    typeof currency !== 'string' ||
    !CURRENCY_PATTERN.test(currency) ||
    typeof status !== 'string' ||
    !PAYMENT_STATUSES.has(status as HyperswitchPaymentStatus) ||
    (clientSecret !== undefined && clientSecret !== null && typeof clientSecret !== 'string')
  ) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch returned a malformed payment object.');
  }

  return {
    paymentId,
    merchantId,
    amount,
    currency,
    status: status as HyperswitchPaymentStatus,
    clientSecret: typeof clientSecret === 'string' ? clientSecret : null,
  };
}

async function requestPayment(
  config: HyperswitchClientConfig,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<HyperswitchPayment> {
  const { baseUrl, apiKey } = resolveConfig(config);
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set('api-key', apiKey);
    headers.set('accept', 'application/json');
    response = await fetchImpl(new URL(path, baseUrl), {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers,
    });
  } catch {
    throw new HyperswitchClientError('UPSTREAM_UNAVAILABLE', 'Hyperswitch request failed or timed out.');
  }

  if (!response.ok) {
    // Do not surface provider response bodies: they may contain sensitive details.
    throw new HyperswitchClientError('UPSTREAM_REJECTED', 'Hyperswitch rejected the payment request.', response.status);
  }
  return normalizePayment(await readJsonResponse(response));
}

/**
 * Create a payment intent without confirming/authorizing it. The caller must
 * use the same stable paymentId and Idempotency-Key for retries.
 */
export async function createHyperswitchPaymentIntent(
  config: HyperswitchClientConfig,
  input: CreateHyperswitchPaymentIntentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<HyperswitchPayment> {
  validateCreateInput(input);
  const payment = await requestPayment(config, '/payments', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      payment_id: input.paymentId,
      amount: input.amount,
      currency: input.currency,
      confirm: false,
    }),
  }, fetchImpl);

  if (
    payment.paymentId !== input.paymentId ||
    payment.amount !== input.amount ||
    payment.currency !== input.currency ||
    !['requires_payment_method', 'requires_confirmation'].includes(payment.status)
  ) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch payment intent did not match the unconfirmed request.');
  }
  return payment;
}

/** Retrieve authoritative provider status for reconciliation/fallback checks. */
export async function retrieveHyperswitchPayment(
  config: HyperswitchClientConfig,
  paymentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HyperswitchPayment> {
  if (typeof paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(paymentId)) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Payment ID must be the stable 30-character Hyperswitch payment identifier.');
  }
  const payment = await requestPayment(config, `/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
  }, fetchImpl);
  if (payment.paymentId !== paymentId) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch returned a different payment ID.');
  }
  return payment;
}
