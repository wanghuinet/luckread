/**
 * Minimal server-only Hyperswitch Payments API adapter.
 *
 * Server-only Hyperswitch payment adapter: unconfirmed checkout intents,
 * customer-present save-for-off-session setup intents, and one MIT charge.
 * It is not wired to a route and cannot activate subscriptions or write
 * financial state. Callers must persist stable IDs before provider I/O and
 * wait for verified provider evidence before considering payment successful.
 *
 * Upstream API: https://api-reference.hyperswitch.io/v1/payments/payments--create
 */

import { parseHyperswitchRfc3339Timestamp } from './hyperswitch-webhook-signature.js';

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

/** Server-authoritative data for a customer-present setup intent that may be used off-session later. */
export interface CreateHyperswitchCustomerInitiatedSetupInput extends CreateHyperswitchPaymentIntentInput {
  customerId: string;
}

/** Server-derived online consent evidence for Hyperswitch's documented confirm API. */
export interface HyperswitchOnlineCustomerAcceptance {
  acceptedAt: string;
  ipAddress: string;
  userAgent: string;
}

/** Confirm a customer-present setup intent using a provider-issued token, never raw card data. */
export interface ConfirmHyperswitchCustomerInitiatedSetupInput extends Pick<CreateHyperswitchPaymentIntentInput, 'paymentId' | 'amount' | 'currency'> {
  customerId: string;
  paymentToken: string;
  customerAcceptance: HyperswitchOnlineCustomerAcceptance;
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
  /** Customer reference returned by Hyperswitch; absent on endpoints that do not include it. */
  customerId?: string | null;
  /** Opaque Hyperswitch vault reference; not consent evidence and not a fulfillment signal. */
  paymentMethodId?: string | null;
  /** Provider-authoritative captured amount in the currency's lowest denomination. */
  amountCaptured?: number | null;
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

function validateProviderReference(value: unknown, field: string, maxLength = 256): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
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
  const {
    payment_id: paymentId,
    merchant_id: merchantId,
    amount,
    currency,
    status,
    client_secret: clientSecret,
    customer_id: customerId,
    payment_method_id: paymentMethodId,
    amount_received: amountCaptured,
  } = value;
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
    (clientSecret !== undefined && clientSecret !== null && typeof clientSecret !== 'string') ||
    (customerId !== undefined && customerId !== null && (
      typeof customerId !== 'string' ||
      customerId.length === 0 ||
      customerId.length > 256 ||
      customerId.trim() !== customerId ||
      /[\u0000-\u001f\u007f]/.test(customerId)
    )) ||
    (paymentMethodId !== undefined && paymentMethodId !== null && (
      typeof paymentMethodId !== 'string' ||
      paymentMethodId.length === 0 ||
      paymentMethodId.length > 256 ||
      paymentMethodId.trim() !== paymentMethodId ||
      /[\u0000-\u001f\u007f]/.test(paymentMethodId)
    )) ||
    (amountCaptured !== undefined && amountCaptured !== null && (
      typeof amountCaptured !== 'number' || !Number.isSafeInteger(amountCaptured) ||
      amountCaptured < 0 || amountCaptured > amount
    ))
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
    ...(typeof customerId === 'string' ? { customerId } : {}),
    paymentMethodId: typeof paymentMethodId === 'string' ? paymentMethodId : null,
    ...(typeof amountCaptured === 'number' ? { amountCaptured } : {}),
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
 * Create an unconfirmed customer-present payment intent prepared for future
 * off-session use. This flag is not proof of customer consent: the caller must
 * complete the customer-present confirmation flow with genuine customer
 * acceptance, then persist a returned payment_method_id only after verifying
 * provider evidence and binding it to this customer on the server.
 *
 * This function does not capture a payment method, store consent, or grant
 * subscription access. It shares the existing validated adapter and stable
 * payment/idempotency contract.
 */
export async function createHyperswitchCustomerInitiatedSetupIntent(
  config: HyperswitchClientConfig,
  input: CreateHyperswitchCustomerInitiatedSetupInput,
  fetchImpl: typeof fetch = fetch,
): Promise<HyperswitchPayment> {
  validateCreateInput(input);
  validateProviderReference(input.customerId, 'Customer ID');

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
      setup_future_usage: 'off_session',
      confirm: false,
    }),
  }, fetchImpl);

  if (
    payment.paymentId !== input.paymentId ||
    payment.amount !== input.amount ||
    payment.currency !== input.currency ||
    !['requires_payment_method', 'requires_confirmation'].includes(payment.status)
  ) {
    throw new HyperswitchClientError(
      'UPSTREAM_INVALID_RESPONSE',
      'Hyperswitch customer-initiated setup intent did not match the unconfirmed request.',
    );
  }
  return payment;
}

/**
 * Confirm the customer-present setup intent with Hyperswitch's documented
 * customer_acceptance payload. The caller must call this only after the
 * authenticated customer explicitly opts in to saving the method for future
 * off-session charges, and must derive timestamp/IP from trusted server-side
 * request context. The provider-issued payment token avoids handling PAN/CVC.
 *
 * This call does not by itself establish that a saved method is reusable or
 * grant access; callers still need verified provider success and a customer-
 * bound retrieve/reconciliation step before recording a reusable reference.
 */
export async function confirmHyperswitchCustomerInitiatedSetupPayment(
  config: HyperswitchClientConfig,
  input: ConfirmHyperswitchCustomerInitiatedSetupInput,
  fetchImpl: typeof fetch = fetch,
): Promise<HyperswitchPayment> {
  if (!input || typeof input !== 'object') {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Setup confirmation input is required.');
  }
  if (typeof input.paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(input.paymentId)) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Payment ID must be the stable 30-character Hyperswitch payment identifier.');
  }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Amount must be a positive safe integer in the currency smallest unit.');
  }
  if (typeof input.currency !== 'string' || !CURRENCY_PATTERN.test(input.currency)) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Currency must be a three-letter uppercase code.');
  }
  validateProviderReference(input.customerId, 'Customer ID');
  validateProviderReference(input.paymentToken, 'Payment token');
  if (!input.customerAcceptance || typeof input.customerAcceptance !== 'object') {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Customer acceptance evidence is required.');
  }
  const { acceptedAt, ipAddress, userAgent } = input.customerAcceptance;
  if (
    typeof acceptedAt !== 'string' ||
    acceptedAt.length > 64 ||
    acceptedAt.trim() !== acceptedAt ||
    parseHyperswitchRfc3339Timestamp(acceptedAt) === null
  ) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Customer acceptance timestamp is invalid.');
  }
  validateProviderReference(ipAddress, 'Customer IP address');
  validateProviderReference(userAgent, 'Customer user agent', 1024);

  const payment = await requestPayment(config, '/payments/' + encodeURIComponent(input.paymentId) + '/confirm', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      payment_token: input.paymentToken,
      customer_acceptance: {
        acceptance_type: 'online',
        accepted_at: acceptedAt,
        online: {
          ip_address: ipAddress,
          user_agent: userAgent,
        },
      },
    }),
  }, fetchImpl);

  if (
    payment.paymentId !== input.paymentId ||
    payment.customerId !== input.customerId ||
    payment.amount !== input.amount ||
    payment.currency !== input.currency
  ) {
    throw new HyperswitchClientError(
      'UPSTREAM_INVALID_RESPONSE',
      'Hyperswitch setup confirmation did not match the authoritative customer and payment.',
    );
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
      off_session: true,
      recurring_details: {
        type: 'payment_method_id',
        data: input.paymentMethodId,
      },
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


export type CustomerBoundHyperswitchPaymentMethod = Readonly<{
  paymentId: string;
  customerId: string;
  paymentMethodId: string;
}>;

/**
 * Retrieve a reusable provider vault reference only after the initial customer-present
 * payment is succeeded and the provider response is bound to the expected customer,
 * amount and currency. This does NOT prove customer consent by itself: the caller must
 * have completed and durably recorded Hyperswitch's customer-acceptance confirmation
 * flow before storing or using this reference for MIT charges.
 */
export async function retrieveCustomerBoundHyperswitchPaymentMethod(
  config: HyperswitchClientConfig,
  input: Readonly<{
    paymentId: string;
    customerId: string;
    amount: number;
    currency: string;
  }>,
  fetchImpl: typeof fetch = fetch,
): Promise<CustomerBoundHyperswitchPaymentMethod> {
  validateProviderReference(input.customerId, 'Customer ID');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || typeof input.currency !== 'string' || !CURRENCY_PATTERN.test(input.currency)) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Expected amount or currency is malformed.');
  }

  const payment = await retrieveHyperswitchPayment(config, input.paymentId, fetchImpl);
  if (
    payment.status !== 'succeeded' ||
    payment.customerId !== input.customerId ||
    payment.amount !== input.amount ||
    payment.currency !== input.currency ||
    typeof payment.paymentMethodId !== 'string' ||
    payment.paymentMethodId.length === 0
  ) {
    throw new HyperswitchClientError(
      'UPSTREAM_INVALID_RESPONSE',
      'Hyperswitch payment is not a successful customer-bound saved-method transaction.',
    );
  }
  return {
    paymentId: payment.paymentId,
    customerId: payment.customerId,
    paymentMethodId: payment.paymentMethodId,
  };
}


export type HyperswitchRefundStatus = 'pending' | 'succeeded' | 'failed' | 'review';

export type HyperswitchRefund = Readonly<{
  refundId: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: HyperswitchRefundStatus;
  updatedAt: string | null;
}>;

export type CreateHyperswitchRefundInput = Readonly<{
  paymentId: string;
  refundId: string;
  amount: number;
  currency: string;
  reason?: string | null;
}>;

function normalizeRefund(
  value: unknown,
  expected: Readonly<{ refundId: string; paymentId: string; amount: number; currency: string }>,
): HyperswitchRefund {
  if (!isRecord(value)) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch returned an invalid refund object.');
  }
  const refundId = value.refund_id;
  const paymentId = value.payment_id;
  const amount = value.amount;
  const currency = value.currency;
  const status = value.status;
  const updated = value.updated_at ?? value.updated ?? null;
  if (
    refundId !== expected.refundId ||
    paymentId !== expected.paymentId ||
    amount !== expected.amount ||
    currency !== expected.currency ||
    (status !== 'pending' && status !== 'succeeded' && status !== 'failed' && status !== 'review') ||
    (updated !== null && (typeof updated !== 'string' || parseHyperswitchRfc3339Timestamp(updated) === null))
  ) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch refund does not match the authoritative refund request.');
  }
  return {
    refundId,
    paymentId,
    amount,
    currency,
    status,
    updatedAt: typeof updated === 'string' ? new Date(parseHyperswitchRfc3339Timestamp(updated) as number).toISOString() : null,
  };
}

async function requestRefund(
  config: HyperswitchClientConfig,
  path: string,
  init: RequestInit,
  expected: Readonly<{ refundId: string; paymentId: string; amount: number; currency: string }>,
  fetchImpl: typeof fetch,
): Promise<HyperswitchRefund> {
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
    throw new HyperswitchClientError('UPSTREAM_UNAVAILABLE', 'Hyperswitch refund request failed or timed out.');
  }
  if (!response.ok) {
    throw new HyperswitchClientError('UPSTREAM_REJECTED', 'Hyperswitch rejected the refund request.', response.status);
  }
  const raw = await readJsonResponse(response);
  if (isRecord(raw) && raw.merchant_id !== undefined && raw.merchant_id !== expectedMerchantId) {
    throw new HyperswitchClientError('UPSTREAM_INVALID_RESPONSE', 'Hyperswitch returned a refund for a different merchant.');
  }
  return normalizeRefund(raw, expected);
}

/**
 * Create a provider refund using the durable local refund ID as the provider
 * idempotency identity. Repeated submissions must reuse this exact refund ID;
 * do not mint a replacement after a timeout or ambiguous response.
 */
export async function createHyperswitchRefund(
  config: HyperswitchClientConfig,
  input: CreateHyperswitchRefundInput,
  fetchImpl: typeof fetch = fetch,
): Promise<HyperswitchRefund> {
  if (
    !input || typeof input !== 'object' ||
    typeof input.paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(input.paymentId) ||
    typeof input.refundId !== 'string' || !/^ref_[A-Za-z0-9]{26}$/.test(input.refundId) ||
    !Number.isSafeInteger(input.amount) || input.amount < 100 ||
    typeof input.currency !== 'string' || !CURRENCY_PATTERN.test(input.currency) ||
    (input.reason !== undefined && input.reason !== null && (
      typeof input.reason !== 'string' || input.reason.length > 255 ||
      input.reason.trim() !== input.reason || /[\u0000-\u001f\u007f]/.test(input.reason)
    ))
  ) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Refund request is malformed.');
  }
  const { refundId, paymentId, amount, currency } = input;
  return requestRefund(config, '/refunds', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      refund_id: refundId,
      payment_id: paymentId,
      amount,
      ...(input.reason ? { reason: input.reason } : {}),
      refund_type: 'instant',
    }),
  }, { refundId, paymentId, amount, currency }, fetchImpl);
}

/** Reconcile a previously submitted refund after an ambiguous provider response. */
export async function retrieveHyperswitchRefund(
  config: HyperswitchClientConfig,
  input: Readonly<{ refundId: string; paymentId: string; amount: number; currency: string }>,
  fetchImpl: typeof fetch = fetch,
): Promise<HyperswitchRefund> {
  if (
    !input || typeof input !== 'object' ||
    typeof input.refundId !== 'string' || !/^ref_[A-Za-z0-9]{26}$/.test(input.refundId) ||
    typeof input.paymentId !== 'string' || !PAYMENT_ID_PATTERN.test(input.paymentId) ||
    !Number.isSafeInteger(input.amount) || input.amount < 100 ||
    typeof input.currency !== 'string' || !CURRENCY_PATTERN.test(input.currency)
  ) {
    throw new HyperswitchClientError('REQUEST_INVALID', 'Refund lookup identity is malformed.');
  }
  return requestRefund(config, '/refunds/' + encodeURIComponent(input.refundId), {
    method: 'GET',
  }, input, fetchImpl);
}
