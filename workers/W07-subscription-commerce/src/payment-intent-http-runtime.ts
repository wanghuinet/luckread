/// <reference types="@cloudflare/workers-types" />

import {
  createHyperswitchCustomerInitiatedSetupIntent,
  HyperswitchClientError,
} from './hyperswitch-client.js';
import { assertSubscriptionUpgradeOrderPayable } from './subscription-plan-change-checkout.js';
import { SubscriptionRuntimeError } from './subscription-runtime.js';
import {
  createPaymentAttempt,
  recordUnconfirmedHyperswitchIntent,
  PaymentPersistenceError,
  type PaymentAttemptCreation,
  type PaymentAttemptDto,
} from './payment-persistence.js';

type ResolvedProviderConfig = Readonly<{
  environment: 'sandbox' | 'production';
  apiKey: string;
  expectedMerchantId: string;
}>;

type PaymentIntentRuntimeEnv = Readonly<{
  D1_01?: D1Database;
  D1_04: D1Database;
  HYPERSWITCH_ENVIRONMENT?: string | null;
  HYPERSWITCH_API_KEY?: string | null;
  HYPERSWITCH_MERCHANT_ID?: string | null;
}>;

type PaymentIntentRuntimeDependencies = Readonly<{
  createAttempt?: typeof createPaymentAttempt;
  createProviderIntent?: typeof createHyperswitchCustomerInitiatedSetupIntent;
  recordIntent?: typeof recordUnconfirmedHyperswitchIntent;
}>;

const ORDER_ID_MAX_LENGTH = 255;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function validBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function resolveProviderConfig(env: PaymentIntentRuntimeEnv): ResolvedProviderConfig | null {
  const environment = env.HYPERSWITCH_ENVIRONMENT;
  const apiKey = env.HYPERSWITCH_API_KEY;
  const expectedMerchantId = env.HYPERSWITCH_MERCHANT_ID;
  if (
    (environment !== 'sandbox' && environment !== 'production') ||
    !validBoundedText(apiKey, 4096) ||
    /[\r\n]/.test(apiKey) ||
    !validBoundedText(expectedMerchantId, 256)
  ) {
    return null;
  }
  return { environment, apiKey, expectedMerchantId };
}

function resolveRoute(request: Request): { orderId: string } | Response | null {
  let segments: string[];
  try {
    segments = new URL(request.url).pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid payment-intent path');
  }

  if (
    segments[0] !== 'commerce' ||
    segments[1] !== 'orders' ||
    segments.length !== 4 ||
    segments[3] !== 'payment-intent'
  ) {
    return null;
  }
  if (request.method !== 'POST') {
    return errorResponse(404, 'NOT_FOUND', 'Payment-intent endpoint not found');
  }

  const orderId = segments[2];
  if (!validBoundedText(orderId, ORDER_ID_MAX_LENGTH)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Order ID is invalid');
  }
  return { orderId };
}

function mapPersistenceError(error: PaymentPersistenceError): Response {
  const message =
    error.code === 'PRECONDITION_REQUIRED' ? 'Idempotency-Key is required' :
    error.code === 'RESOURCE_NOT_FOUND' ? 'Order not found' :
    error.code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT' ? 'Idempotency-Key was used for a different payment request' :
    error.code === 'CONFLICT' ? 'Payment intent conflicts with the current Order state' :
    error.code === 'VALIDATION_FAILED' ? 'Payment-intent request validation failed' :
    error.code === 'INTEGRITY_VIOLATION' ? 'Payment persistence integrity check failed' :
    'Payment service unavailable';
  return errorResponse(error.status, error.code, message);
}

/**
 * Internal W01 -> W07 checkout-intent operation. The trusted customer identity is
 * derived by W01; amount and currency are read from the customer-owned D1-04
 * Order. Provider network I/O is deliberately outside D1 writes. Only the
 * server-generated payment ID and a deterministic provider idempotency key are
 * sent upstream; provider secrets and client_secret are never persisted.
 *
 * This does not capture funds, confirm an Order, post a ledger entry, grant an
 * entitlement. The customer-present Hyperswitch SDK is responsible for showing
 * the explicit save-method consent choice; this operation alone does not imply consent.
 */
export async function handleCommercePaymentIntentRequest(
  request: Request,
  customerId: string,
  env: PaymentIntentRuntimeEnv,
  dependencies: PaymentIntentRuntimeDependencies = {},
): Promise<Response | null> {
  const route = resolveRoute(request);
  if (route === null) return null;
  if (route instanceof Response) return route;

  if (request.body !== null) {
    try {
      await request.body.cancel();
    } catch {
      // The request is rejected regardless; do not parse or trust a caller body.
    }
    return errorResponse(400, 'VALIDATION_FAILED', 'Payment-intent request must not contain a body');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== 0)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Payment-intent request must not contain a body');
  }

  const providerConfig = resolveProviderConfig(env);
  if (!providerConfig) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment provider is not configured');
  }

  try {
    // Revalidate a subscription-upgrade source version immediately before
    // persisting a new PaymentAttempt or contacting Hyperswitch. Ordinary
    // orders pass through unchanged; stale upgrade orders fail closed.
    await assertSubscriptionUpgradeOrderPayable(env, customerId, route.orderId);

    const createAttempt = dependencies.createAttempt ?? createPaymentAttempt;
    const attempt: PaymentAttemptCreation = await createAttempt(
      env.D1_04,
      customerId,
      route.orderId,
      request.headers.get('Idempotency-Key'),
      providerConfig.expectedMerchantId,
      { paymentEnvironment: providerConfig.environment },
    );

    if (!['INITIATING', 'requires_payment_method', 'requires_confirmation'].includes(attempt.payment.status)) {
      return errorResponse(409, 'PAYMENT_STATE_ADVANCED', 'This payment attempt can no longer start checkout');
    }

    // Do not forward a customer-controlled key into a merchant-global provider
    // idempotency namespace. The stable, locally unique payment ID gives every
    // retry of this persisted attempt exactly the same upstream key.
    const providerIdempotencyKey = 'lr_' + attempt.payment.paymentId;
    const createProviderIntent = dependencies.createProviderIntent ?? createHyperswitchCustomerInitiatedSetupIntent;
    const providerPayment = await createProviderIntent(providerConfig, {
      paymentId: attempt.payment.paymentId,
      amount: attempt.payment.amountMinor,
      currency: attempt.payment.currency,
      idempotencyKey: providerIdempotencyKey,
      customerId,
    });

    const recordIntent = dependencies.recordIntent ?? recordUnconfirmedHyperswitchIntent;
    const persisted: PaymentAttemptDto = await recordIntent(
      env.D1_04,
      customerId,
      attempt.payment.paymentId,
      providerConfig.expectedMerchantId,
      providerPayment,
    );

    if (
      typeof providerPayment.clientSecret !== 'string' ||
      !validBoundedText(providerPayment.clientSecret, 4096)
    ) {
      // Never report checkout as ready without a usable secret. The provider
      // intent remains recoverable using the same persisted payment ID/key.
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Checkout details are not available');
    }

    return Response.json(
      {
        data: {
          paymentId: persisted.paymentId,
          orderId: persisted.orderId,
          amountMinor: persisted.amountMinor,
          currency: persisted.currency,
          pricingMode: attempt.pricingMode,
          status: persisted.status,
          version: persisted.version,
          clientSecret: providerPayment.clientSecret,
        },
        requestId: 'req_' + crypto.randomUUID(),
      },
      { status: attempt.replayed ? 200 : 201, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) {
      const message = error.code === 'PRECONDITION_FAILED' ? 'Subscription changed after the upgrade order was created' :
        error.code === 'INVALID_STATE' ? 'The upgrade order is no longer payable' :
        error.code === 'CONFLICT' ? 'The upgrade order conflicts with the current subscription state' :
        error.code === 'VALIDATION_FAILED' ? 'Payment-intent request validation failed' : 'Subscription upgrade is unavailable';
      return errorResponse(error.status, error.code, message);
    }
    if (error instanceof PaymentPersistenceError) return mapPersistenceError(error);
    if (error instanceof HyperswitchClientError) {
      if (error.code === 'REQUEST_INVALID') {
        return errorResponse(400, 'VALIDATION_FAILED', 'Payment-intent request validation failed');
      }
      if (error.code === 'UPSTREAM_REJECTED') {
        return errorResponse(502, 'PAYMENT_PROVIDER_REJECTED', 'Payment provider rejected the checkout request');
      }
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment provider is temporarily unavailable');
    }
    // Keep adapter/database error objects out of logs and HTTP responses; they
    // may carry provider or infrastructure details.
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment service unavailable');
  }
}
