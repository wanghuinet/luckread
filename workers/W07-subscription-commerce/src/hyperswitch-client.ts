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
  /** Must match the merchant account that owns the server-side API key. */
  expectedMerchantId: string | null | undefined;
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

/** Server-authoritative data for a customer-approved recurring-payment charge (MIT). */
export interface CreateHyperswitchMerchantInitiatedPaymentInput extends CreateHyperswitchPaymentIntentInput {
  /** Must be the same Hyperswitch customer ID bound to the stored payment method. */
  customerId: string;
  /** Hyperswitch payment_method_id returned by an earlier customer-authorized CIT/mandate setup. */
  paymentMethodId: string;
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

/** Shared runtime guard so webhook reconciliation uses the same status allowlist as API responses. */
export function isHyperswitchPaymentStatus(value: unknown): value is HyperswitchPaymentStatus {
  return typeof value === 'string' && PAYMENT_STATUSES.has(value as HyperswitchPaymentStatus);
}

function resolveConfig(config: HyperswitchClientConfig): {
  baseUrl: string;
  apiKey: string;
  expectedMerchantId: string;
} {
  if (config.environment !== 'sandbox' && config.environment !== 'production') {
    throw new HyperswitchClientError('CONFIGURATION_INVALID', 'Hyperswitch environment must be explicitly set to sandbox or production.');
  }
  if (typeof config.apiKey !== 'string' || config.apiKey.length === 0 || config.apiKey.trim() !== config.apiKey || /[\r\n]/.test(config.apiKey)) {
    throw new HyperswitchClientError('CONFIGURATION_INVALID', 'Hyperswitch server API key is missing or malformed.');
  }
  if (
    typeof config.expectedMerchantId !== 'string' ||
    config.expectedMerchantId.length === 0 ||
    config.expectedMerchantId.trim() !== config.expectedMerchantId
  ) {
    throw new HyperswitchClientError('CONFIGURATION_INVALID', 'Expected Hyperswitch merchant ID is missing or malformed.');
  }
  return {
    baseUrl: BASE_URLS[config.environment],
    apiKey: config.apiKey,
    expectedMerchantId: config.expectedMerchantId,
  };
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

function validateProviderReference(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new HyperswitchClientError('REQUEST_INVALID', field + ' is missing or malformed.');
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch response exceeded the allowed size.');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch response body was missing.');
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch response exceeded the allowed size.');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof HyperswitchClientError) throw error;
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch response body could not be read.');
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
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
    !isHyperswitchPaymentStatus(status) ||
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
  const { baseUrl, apiKey, expectedMerchantId } = resolveConfig(config);
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
  const payment = normalizePayment(await readJsonResponse(response));
  if (payment.merchantId !== expectedMerchantId) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch returned a payment for a different merchant.');
  }
  return payment;
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

/**
 * Execute a merchant-initiated recurring charge through Hyperswitch's existing
 * payment orchestration API. Billing cadence/retries remain the subscription
 * provider's responsibility; this function performs one charge only.
 *
 * The caller must load customerId/paymentMethodId from trusted server-side
 * records, create a durable local attempt first, and reuse its paymentId and
 * idempotencyKey on retry. The returned status is not, by itself, fulfillment
 * evidence: the caller must persist it and apply the verified webhook/reconciliation
 * contract before confirming an order or granting access.
 */
export async function createHyperswitchMerchantInitiatedPayment(
  config: HyperswitchClientConfig,
  input: CreateHyperswitchMerchantInitiatedPaymentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<HyperswitchPayment> {
  validateCreateInput(input);
  validateProviderReference(input.customerId, 'Customer ID');
  validateProviderReference(input.paymentMethodId, 'Payment method ID');

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
      customer_id: input.customerId,
      confirm: true,
      capture_method: 'automatic',
      off_session: true,
      recurring_details: {
        type: 'payment_method_id',
        data: input.paymentMethodId,
      },
      mit_category: 'recurring',
    }),
  }, fetchImpl);

  if (
    payment.paymentId !== input.paymentId ||
    payment.amount !== input.amount ||
    payment.currency !== input.currency
  ) {
    throw new HyperswitchClientError(
      'UPSTREAM_INVALID_RESPONSE',
      'Hyperswitch recurring payment did not match the authoritative request.',
    );
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
