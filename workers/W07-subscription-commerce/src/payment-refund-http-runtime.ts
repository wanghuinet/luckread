/// <reference types="@cloudflare/workers-types" />

import {
  createHyperswitchRefund,
  retrieveHyperswitchPayment,
  HyperswitchClientError,
  type HyperswitchClientConfig,
} from './hyperswitch-client.js';
import {
  createRefundRequest,
  getPaymentAttempt,
  getRefundRequest,
  recordPaymentCapturedAmountObservation,
  recordRefundProviderResponse,
  PaymentPersistenceError,
} from './payment-persistence.js';

type PaymentRefundEnv = Readonly<{
  D1_04: D1Database;
  HYPERSWITCH_ENVIRONMENT?: string | null;
  HYPERSWITCH_API_KEY?: string | null;
  HYPERSWITCH_MERCHANT_ID?: string | null;
}>;

type PaymentRefundDependencies = Readonly<{
  readPayment?: typeof getPaymentAttempt;
  retrievePayment?: typeof retrieveHyperswitchPayment;
  recordCapturedAmount?: typeof recordPaymentCapturedAmountObservation;
  createRefundRequest?: typeof createRefundRequest;
  createProviderRefund?: typeof createHyperswitchRefund;
  recordProviderResponse?: typeof recordRefundProviderResponse;
  readRefund?: typeof getRefundRequest;
  now?: () => Date;
}>;

const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;
const REFUND_ID_PATTERN = /^ref_[A-Za-z0-9]{26}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_BODY_BYTES = 16 * 1024;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
  );
}

function nonBlank(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 &&
    value <= Number.MAX_SAFE_INTEGER;
}

function resolveConfig(env: PaymentRefundEnv): HyperswitchClientConfig | null {
  if (
    (env.HYPERSWITCH_ENVIRONMENT !== 'sandbox' && env.HYPERSWITCH_ENVIRONMENT !== 'production') ||
    !nonBlank(env.HYPERSWITCH_API_KEY, 4096) ||
    /[\r\n]/.test(env.HYPERSWITCH_API_KEY) ||
    !nonBlank(env.HYPERSWITCH_MERCHANT_ID, 256)
  ) return null;
  return {
    environment: env.HYPERSWITCH_ENVIRONMENT,
    apiKey: env.HYPERSWITCH_API_KEY,
    expectedMerchantId: env.HYPERSWITCH_MERCHANT_ID,
  };
}

function resolveRoute(request: Request):
  | { kind: 'create'; paymentId: string }
  | { kind: 'read'; refundId: string }
  | Response
  | null {
  let url: URL;
  let segments: string[];
  try {
    url = new URL(request.url);
    segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Refund path is invalid');
  }
  if (url.search) return errorResponse(400, 'VALIDATION_FAILED', 'Refund endpoints do not accept query parameters');
  if (segments.length === 3 && segments[0] === 'payments' && segments[2] === 'refunds') {
    if (!PAYMENT_ID_PATTERN.test(segments[1] ?? '')) {
      return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Payment not found');
    }
    if (request.method !== 'POST') return errorResponse(404, 'NOT_FOUND', 'Refund request endpoint not found');
    return { kind: 'create', paymentId: segments[1]! };
  }
  if (segments.length === 2 && segments[0] === 'refunds') {
    if (!REFUND_ID_PATTERN.test(segments[1] ?? '')) {
      return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Refund not found');
    }
    if (request.method !== 'GET') return errorResponse(404, 'NOT_FOUND', 'Refund status endpoint not found');
    return { kind: 'read', refundId: segments[1]! };
  }
  return null;
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown> | Response> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Refund request must use application/json');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Refund request body is too large');
  }
  if (!request.body) return errorResponse(400, 'VALIDATION_FAILED', 'Refund request body is required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'Refund request body is too large');
      }
      chunks.push(value);
    }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Refund request body could not be read');
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Refund request body must be valid UTF-8 JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Refund request body must be an object');
  }
  return value as Record<string, unknown>;
}

function parseRefundRequestBody(value: Record<string, unknown>): {
  amountMinor: number;
  reason: string | null;
} | Response {
  const keys = Object.keys(value);
  if (
    !Object.hasOwn(value, 'amountMinor') ||
    keys.some((key) => key !== 'amountMinor' && key !== 'reason') ||
    !safeMinor(value.amountMinor) ||
    (value.reason !== undefined && value.reason !== null &&
      (!nonBlank(value.reason, 255) || /[\u0000-\u001f\u007f]/.test(value.reason)))
  ) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Refund amountMinor and optional reason are invalid');
  }
  return { amountMinor: value.amountMinor, reason: value.reason === undefined ? null : value.reason as string | null };
}

function mapPersistenceError(error: PaymentPersistenceError): Response {
  const messages: Record<string, string> = {
    VALIDATION_FAILED: 'Refund request validation failed',
    PRECONDITION_REQUIRED: 'Idempotency-Key is required',
    RESOURCE_NOT_FOUND: 'Payment or refund not found',
    CONFLICT: 'Refund amount exceeds the available captured balance or payment is not refundable',
    IDEMPOTENCY_KEY_REUSE_CONFLICT: 'Idempotency-Key was used for a different refund request',
    INTEGRITY_VIOLATION: 'Refund persistence integrity check failed',
    INVALID_SIGNATURE: 'Provider signature is invalid',
    WEBHOOK_REJECTED: 'Provider webhook was rejected',
    SERVICE_UNAVAILABLE: 'Refund service unavailable',
  };
  return errorResponse(error.status, error.code, messages[error.code] ?? 'Refund service unavailable');
}

function mapProviderError(error: HyperswitchClientError): Response {
  if (error.code === 'REQUEST_INVALID') {
    return errorResponse(400, 'VALIDATION_FAILED', 'Refund provider request was invalid');
  }
  if (error.code === 'UPSTREAM_REJECTED') {
    // Do not mark the local reservation failed: an upstream timeout/reject may
    // be ambiguous. The same refund_id and Idempotency-Key must be retried.
    return errorResponse(502, 'REFUND_PROVIDER_REJECTED', 'Refund provider did not accept the request');
  }
  if (error.code === 'CONFIGURATION_INVALID') {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Refund provider is not configured');
  }
  return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Refund provider is unavailable');
}

/**
 * Internal W01 -> W07 refund ingress. D1-04 reserves the stable refund before
 * the provider mutation. A force-synced Hyperswitch payment retrieve supplies
 * the captured balance; the D1-04 trigger serializes concurrent reservations
 * against that captured balance. Provider network calls stay outside D1 batch.
 */
export async function handlePaymentRefundRequest(
  request: Request,
  customerId: string,
  env: PaymentRefundEnv,
  dependencies: PaymentRefundDependencies = {},
): Promise<Response | null> {
  const route = resolveRoute(request);
  if (route === null) return null;
  if (route instanceof Response) return route;
  if (!nonBlank(customerId, 256)) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');

  if (route.kind === 'read') {
    if (request.body !== null) {
      await request.body.cancel().catch(() => undefined);
      return errorResponse(400, 'VALIDATION_FAILED', 'Refund status does not accept a request body');
    }
    try {
      const readRefund = dependencies.readRefund ?? getRefundRequest;
      const refund = await readRefund(env.D1_04, customerId, route.refundId);
      return Response.json(
        { data: { refund, statusAuthority: 'W07_D1_04' }, requestId: 'req_' + crypto.randomUUID() },
        { status: 200, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
      );
    } catch (error) {
      if (error instanceof PaymentPersistenceError) return mapPersistenceError(error);
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Refund status is unavailable');
    }
  }

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (idempotencyKey === null || idempotencyKey.trim() === '') {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required');
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey) || idempotencyKey.trim() !== idempotencyKey) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Idempotency-Key is invalid');
  }
  const parsed = await readBoundedJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parseRefundRequestBody(parsed);
  if (body instanceof Response) return body;

  const config = resolveConfig(env);
  if (!config) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Refund provider is not configured');

  try {
    const readPayment = dependencies.readPayment ?? getPaymentAttempt;
    const localPayment = await readPayment(
      env.D1_04,
      customerId,
      route.paymentId,
      config.expectedMerchantId,
    );
    if (!['succeeded','partially_captured','partially_captured_and_capturable'].includes(localPayment.status)) {
      return errorResponse(409, 'CONFLICT', 'Payment does not have a refundable captured balance');
    }

    const retrievePayment = dependencies.retrievePayment ?? retrieveHyperswitchPayment;
    const observed = await retrievePayment(config, localPayment.paymentId, undefined, true);
    if (
      observed.paymentId !== localPayment.paymentId ||
      observed.merchantId !== config.expectedMerchantId ||
      observed.amount !== localPayment.amountMinor ||
      observed.currency !== localPayment.currency ||
      observed.status !== localPayment.status ||
      (observed.customerId !== undefined && observed.customerId !== null && observed.customerId !== customerId) ||
      !safeMinor(observed.amountCaptured) ||
      observed.amountCaptured > observed.amount
    ) {
      return errorResponse(409, 'REFUND_CAPTURED_AMOUNT_UNAVAILABLE', 'Provider captured amount could not be verified');
    }

    const recordCapturedAmount = dependencies.recordCapturedAmount ?? recordPaymentCapturedAmountObservation;
    await recordCapturedAmount(env.D1_04, customerId, observed, { now: dependencies.now });

    const createRequest = dependencies.createRefundRequest ?? createRefundRequest;
    const created = await createRequest(
      env.D1_04,
      customerId,
      localPayment.paymentId,
      body.amountMinor,
      idempotencyKey,
      body.reason,
      { now: dependencies.now },
    );

    if (created.replayed && created.refund.status !== 'INITIATING') {
      return Response.json(
        { data: { refund: created.refund, replayed: true, statusAuthority: 'W07_D1_04' }, requestId: 'req_' + crypto.randomUUID() },
        { status: 200, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
      );
    }

    const createProviderRefund = dependencies.createProviderRefund ?? createHyperswitchRefund;
    const providerRefund = await createProviderRefund(config, {
      refundId: created.refund.refundId,
      paymentId: created.refund.paymentId,
      amount: created.refund.amountMinor,
      currency: created.refund.currency,
      ...(created.refund.reason !== null ? { reason: created.refund.reason } : {}),
    });
    const recordProviderResponse = dependencies.recordProviderResponse ?? recordRefundProviderResponse;
    const persisted = await recordProviderResponse(env.D1_04, customerId, providerRefund, { now: dependencies.now });
    return Response.json(
      { data: { refund: persisted, replayed: created.replayed, statusAuthority: 'W07_D1_04' }, requestId: 'req_' + crypto.randomUUID() },
      { status: created.replayed ? 200 : 201, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
    );
  } catch (error) {
    if (error instanceof PaymentPersistenceError) return mapPersistenceError(error);
    if (error instanceof HyperswitchClientError) return mapProviderError(error);
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Refund service is unavailable');
  }
}
