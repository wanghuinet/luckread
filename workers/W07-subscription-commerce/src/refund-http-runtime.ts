/// <reference types="@cloudflare/workers-types" />

import {
  createHyperswitchRefund,
  HyperswitchClientError,
  retrieveHyperswitchPayment,
  retrieveHyperswitchRefund,
  type HyperswitchClientConfig,
} from './hyperswitch-client.js';
import {
  createRefundReservation,
  findExistingRefundReservation,
  recordHyperswitchRefundAcknowledgement,
  resolveRefundPaymentReference,
  RefundPersistenceError,
  type RefundDto,
  type RefundReservation,
} from './refund-persistence.js';

type RefundRuntimeEnv = Readonly<{
  D1_04: D1Database;
  HYPERSWITCH_ENVIRONMENT?: string | null;
  HYPERSWITCH_API_KEY?: string | null;
  HYPERSWITCH_MERCHANT_ID?: string | null;
}>;

type RefundRuntimeDependencies = Readonly<{
  resolvePayment?: typeof resolveRefundPaymentReference;
  retrievePayment?: typeof retrieveHyperswitchPayment;
  reserve?: typeof createRefundReservation;
  findExistingReservation?: typeof findExistingRefundReservation;
  retrieveProviderRefund?: typeof retrieveHyperswitchRefund;
  createProviderRefund?: typeof createHyperswitchRefund;
  recordAcknowledgement?: typeof recordHyperswitchRefundAcknowledgement;
}>;

const REFUND_PATH = '/commerce/payments/refunds';

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function providerConfig(env: RefundRuntimeEnv): HyperswitchClientConfig | null {
  if (
    (env.HYPERSWITCH_ENVIRONMENT !== 'sandbox' && env.HYPERSWITCH_ENVIRONMENT !== 'production') ||
    !validText(env.HYPERSWITCH_API_KEY, 4096) ||
    /[\r\n]/.test(env.HYPERSWITCH_API_KEY) ||
    !validText(env.HYPERSWITCH_MERCHANT_ID, 256)
  ) return null;
  return {
    environment: env.HYPERSWITCH_ENVIRONMENT,
    apiKey: env.HYPERSWITCH_API_KEY,
    expectedMerchantId: env.HYPERSWITCH_MERCHANT_ID,
  };
}

async function readBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 8192)) {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        throw new RefundPersistenceError('VALIDATION_FAILED', 400);
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof RefundPersistenceError) throw error;
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new RefundPersistenceError('VALIDATION_FAILED', 400);
  }
}

function mapPersistenceError(error: RefundPersistenceError): Response {
  const message =
    error.code === 'PRECONDITION_REQUIRED' ? 'Idempotency-Key is required' :
    error.code === 'RESOURCE_NOT_FOUND' ? 'Payment not found' :
    error.code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT' ? 'Idempotency-Key was used for a different refund request' :
    error.code === 'CONFLICT' ? 'Refund conflicts with the captured payment or refundable balance' :
    error.code === 'VALIDATION_FAILED' ? 'Refund request validation failed' :
    error.code === 'INTEGRITY_VIOLATION' ? 'Refund persistence integrity check failed' :
    'Refund service unavailable';
  return errorResponse(error.status, error.code, message);
}

function refundResponse(refund: RefundDto, replayed: boolean, status?: number): Response {
  const responseStatus = status ?? (
    refund.status === 'SUCCEEDED' || refund.status === 'FAILED' ? 200 :
    refund.status === 'REQUESTED' || refund.status === 'RECONCILIATION_REQUIRED' ? 202 : 202
  );
  return Response.json({
    data: {
      refundId: refund.refundId,
      paymentId: refund.paymentId,
      orderId: refund.orderId,
      amountMinor: refund.amountMinor,
      capturedAmountMinor: refund.capturedAmountMinor,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      version: refund.version,
      providerUpdatedAt: refund.providerUpdatedAt,
      createdAt: refund.createdAt,
      updatedAt: refund.updatedAt,
      replayed,
    },
    requestId: 'req_' + crypto.randomUUID(),
  }, { status: responseStatus, headers: { 'cache-control': 'no-store' } });
}

/**
 * Private W01 -> W07 customer refund command. D1-04 reserves the local refund
 * ID and idempotency key before Hyperswitch POST /refunds. Provider calls never
 * execute in a D1 transaction. On timeout, the REQUESTED row is retained and
 * the same Idempotency-Key reuses the same provider refund_id on retry.
 *
 * The create API response is only an acknowledgement. SUCCEEDED/FAILED is
 * reserved for the shared HMAC-verified provider webhook path.
 */
export async function handleCommerceRefundRequest(
  request: Request,
  customerId: string,
  env: RefundRuntimeEnv,
  dependencies: RefundRuntimeDependencies = {},
): Promise<Response | null> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Refund request URL is invalid');
  }
  if (url.pathname !== REFUND_PATH) return null;
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST', 'cache-control': 'no-store' } });
  }

  const idempotencyKey = request.headers.get('Idempotency-Key');
  if (idempotencyKey === null || idempotencyKey.trim() === '') {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required');
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Idempotency-Key is invalid');
  }

  try {
    const input = await readBody(request);
    if (
      !isRecord(input) ||
      !Object.keys(input).every((key) => ['paymentId', 'amountMinor', 'currency', 'reason'].includes(key)) ||
      Object.keys(input).length < 3 ||
      !Object.hasOwn(input, 'paymentId') ||
      !Object.hasOwn(input, 'amountMinor') ||
      !Object.hasOwn(input, 'currency') ||
      typeof input.paymentId !== 'string' ||
      !/^pay_[A-Za-z0-9]{26}$/.test(input.paymentId) ||
      typeof input.amountMinor !== 'number' || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 ||
      typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency) ||
      (input.reason !== undefined && !validText(input.reason, 255))
    ) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Refund payment, amount and currency are required');
    }

    const config = providerConfig(env);
    if (!config || !env.HYPERSWITCH_MERCHANT_ID) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment provider is not configured');
    }

    const resolvePayment = dependencies.resolvePayment ?? resolveRefundPaymentReference;
    const paymentReference = await resolvePayment(
      env.D1_04, customerId, input.paymentId, config.expectedMerchantId as string,
    );
    if (paymentReference.currency !== input.currency) {
      return errorResponse(409, 'CONFLICT', 'Refund currency does not match the original payment');
    }

    const idempotencyInput = {
      customerId,
      paymentId: input.paymentId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      reason: typeof input.reason === 'string' ? input.reason : null,
      idempotencyKey,
      expectedMerchantId: config.expectedMerchantId as string,
    };

    // Check the durable D1-04 idempotency record before external I/O. A replay
    // can return the accepted state during provider downtime; REQUESTED retries
    // reuse the same refund_id without re-reading the original Payment.
    const findExisting = dependencies.findExistingReservation ?? findExistingRefundReservation;
    let reservation: RefundReservation | null = await findExisting(env.D1_04, idempotencyInput);
    let reconcileProviderBeforeCreate = reservation !== null;

    if (!reservation) {
      // The provider retrieval is server-authenticated and merchant-bound.
      // Captured amount is never accepted from the browser.
      const retrievePayment = dependencies.retrievePayment ?? retrieveHyperswitchPayment;
      const providerPayment = await retrievePayment(config, input.paymentId);
      if (
        providerPayment.paymentId !== paymentReference.paymentId ||
        providerPayment.merchantId !== paymentReference.merchantId ||
        providerPayment.amount !== paymentReference.amountMinor ||
        providerPayment.currency !== paymentReference.currency ||
        !['succeeded', 'partially_captured'].includes(providerPayment.status) ||
        typeof providerPayment.amountCaptured !== 'number' ||
        !Number.isSafeInteger(providerPayment.amountCaptured) ||
        providerPayment.amountCaptured <= 0 ||
        providerPayment.amountCaptured > providerPayment.amount
      ) {
        return errorResponse(409, 'REFUND_CAPTURE_NOT_CONFIRMED', 'Captured amount could not be verified for this payment');
      }

      const reserve = dependencies.reserve ?? createRefundReservation;
      reservation = await reserve(env.D1_04, {
        ...idempotencyInput,
        capturedAmountMinor: providerPayment.amountCaptured,
      });
      // A concurrent request may have won the unique customer/idempotency-key
      // insert. Its replay flag means the provider outcome may already exist.
      reconcileProviderBeforeCreate = reservation.replayed;
    }

    // Do not issue another POST for already accepted, completed, or ambiguous
    // refunds. An ambiguous state requires provider retrieve/manual reconciliation.
    if (reservation.refund.status !== 'REQUESTED') {
      return refundResponse(reservation.refund, reservation.replayed);
    }

    const providerIdentity = {
      paymentId: reservation.refund.paymentId,
      refundId: reservation.refund.refundId,
      amount: reservation.refund.amountMinor,
      currency: reservation.refund.currency,
    };
    const retrieveProviderRefund = dependencies.retrieveProviderRefund ?? retrieveHyperswitchRefund;
    let providerRefund: Awaited<ReturnType<typeof retrieveHyperswitchRefund>> | null = null;
    if (reconcileProviderBeforeCreate) {
      try {
        // A previous POST may have succeeded even when its response was lost.
        // Reconcile by the durable provider refund_id before another create call.
        // A GET result cannot finalize state; only the signed webhook can.
        providerRefund = await retrieveProviderRefund(config, providerIdentity);
      } catch (error) {
        if (!(error instanceof HyperswitchClientError) || error.status !== 404) throw error;
        // Provider confirms this refund_id does not exist; retry the immutable
        // request with the same identity rather than minting a second refund ID.
      }
    }

    if (providerRefund) {
      const record = dependencies.recordAcknowledgement ?? recordHyperswitchRefundAcknowledgement;
      const persisted = await record(env.D1_04, providerRefund);
      return refundResponse(persisted, reservation.replayed);
    }

    const create = dependencies.createProviderRefund ?? createHyperswitchRefund;
    const createdRefund = await create(config, {
      ...providerIdentity,
      reason: reservation.refund.reason,
    });

    const record = dependencies.recordAcknowledgement ?? recordHyperswitchRefundAcknowledgement;
    const persisted = await record(env.D1_04, createdRefund);
    return refundResponse(persisted, reservation.replayed);
  } catch (error) {
    if (error instanceof RefundPersistenceError) return mapPersistenceError(error);
    if (error instanceof HyperswitchClientError) {
      if (error.code === 'REQUEST_INVALID') {
        return errorResponse(400, 'VALIDATION_FAILED', 'Refund request validation failed');
      }
      if (error.code === 'UPSTREAM_REJECTED') {
        return errorResponse(502, 'PAYMENT_PROVIDER_REJECTED', 'Payment provider rejected the refund request; retry with the same Idempotency-Key');
      }
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment provider is temporarily unavailable; retry with the same Idempotency-Key');
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Refund service is temporarily unavailable');
  }
}
