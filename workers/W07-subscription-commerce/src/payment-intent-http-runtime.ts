/// <reference types="@cloudflare/workers-types" />

import {
  createHyperswitchCustomerInitiatedSetupIntent,
  HyperswitchClientError,
} from './hyperswitch-client.js';
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

async function verifyUpgradeCheckoutReservation(
  env: PaymentIntentRuntimeEnv,
  customerId: string,
  orderId: string,
): Promise<Response | null> {
  let lines: Array<{
    order_line_id: string;
    item_type: string;
    item_ref: string;
    item_version: string;
    item_snapshot_json: string;
  }>;
  try {
    const result = await env.D1_04.prepare(
      'SELECT order_line_id, item_type, item_ref, item_version, item_snapshot_json ' +
      'FROM order_lines WHERE order_id = ? ORDER BY order_line_id ASC',
    ).bind(orderId).all<{
      order_line_id: string;
      item_type: string;
      item_ref: string;
      item_version: string;
      item_snapshot_json: string;
    }>();
    lines = result.results ?? [];
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Upgrade checkout reservation could not be verified');
  }

  const upgradeLines: Array<{
    line: (typeof lines)[number];
    snapshot: Record<string, unknown>;
    upgrade: Record<string, unknown>;
  }> = [];
  for (const line of lines) {
    if (line.item_type !== 'MEMBERSHIP_PLAN') continue;
    let snapshot: unknown;
    try { snapshot = JSON.parse(line.item_snapshot_json) as unknown; } catch {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Membership Order snapshot could not be verified');
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Membership Order snapshot could not be verified');
    }
    const value = snapshot as Record<string, unknown>;
    if (value.membershipUpgrade === undefined) continue;
    if (!value.membershipUpgrade || typeof value.membershipUpgrade !== 'object' ||
        Array.isArray(value.membershipUpgrade)) {
      return errorResponse(409, 'UPGRADE_RESERVATION_REQUIRED', 'Upgrade Order is not reserved for payment');
    }
    upgradeLines.push({
      line,
      snapshot: value,
      upgrade: value.membershipUpgrade as Record<string, unknown>,
    });
  }
  if (upgradeLines.length === 0) return null;
  if (upgradeLines.length !== 1 || lines.length !== 1 || !env.D1_01) {
    return errorResponse(409, 'UPGRADE_RESERVATION_REQUIRED', 'Upgrade Order is not reserved for payment');
  }

  const { line, snapshot, upgrade } = upgradeLines[0]!;
  if (upgrade.version !== 1 ||
      typeof upgrade.subscriptionId !== 'string' ||
      typeof upgrade.sourcePlanId !== 'string' ||
      !/^plan_[a-f0-9]{64}$/.test(upgrade.sourcePlanId) ||
      !Number.isSafeInteger(upgrade.sourcePlanVersion) ||
      typeof upgrade.targetPlanId !== 'string' ||
      upgrade.targetPlanId !== line.item_ref ||
      upgrade.targetPlanId !== snapshot.planId ||
      !Number.isSafeInteger(upgrade.targetPlanVersion) ||
      String(upgrade.targetPlanVersion) !== line.item_version ||
      !Number.isSafeInteger(upgrade.expectedSubscriptionVersion) ||
      typeof upgrade.currentPeriodStart !== 'string' ||
      typeof upgrade.currentPeriodEnd !== 'string' ||
      typeof upgrade.requestHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(upgrade.requestHash)) {
    return errorResponse(409, 'UPGRADE_RESERVATION_REQUIRED', 'Upgrade Order is not reserved for payment');
  }

  try {
    const reservation = await env.D1_01.prepare(
      "SELECT a.subscription_id, a.subscriber_id, a.source_plan_id, a.source_plan_version, a.target_plan_id, " +
      "a.target_plan_version, a.expected_subscription_version, a.current_period_start, a.current_period_end, " +
      "a.order_id, a.request_hash, a.status, a.payment_id, s.plan_id AS current_plan_id, " +
      "s.plan_version AS current_plan_version, s.version AS current_subscription_version, " +
      "s.status AS subscription_status, s.cancel_at AS subscription_cancel_at " +
      "FROM membership_subscription_plan_change_applications a " +
      "INNER JOIN membership_subscriptions s ON s.subscription_id = a.subscription_id AND s.subscriber_id = a.subscriber_id " +
      "WHERE a.order_id = ? AND a.subscriber_id = ? AND a.status = 'PENDING_PAYMENT' AND a.payment_id IS NULL LIMIT 1",
    ).bind(orderId, customerId).first<{
      subscription_id: string;
      subscriber_id: string;
      source_plan_id: string;
      source_plan_version: number;
      target_plan_id: string;
      target_plan_version: number;
      expected_subscription_version: number;
      current_period_start: string;
      current_period_end: string;
      order_id: string;
      request_hash: string;
      status: string;
      payment_id: string | null;
      current_plan_id: string;
      current_plan_version: number;
      current_subscription_version: number;
      subscription_status: string;
      subscription_cancel_at: string | null;
    }>();
    if (!reservation ||
        reservation.subscription_id !== upgrade.subscriptionId ||
        reservation.subscriber_id !== customerId ||
        reservation.source_plan_id !== upgrade.sourcePlanId ||
        reservation.source_plan_version !== upgrade.sourcePlanVersion ||
        reservation.target_plan_id !== upgrade.targetPlanId ||
        reservation.target_plan_version !== upgrade.targetPlanVersion ||
        reservation.expected_subscription_version !== upgrade.expectedSubscriptionVersion ||
        reservation.current_period_start !== upgrade.currentPeriodStart ||
        reservation.current_period_end !== upgrade.currentPeriodEnd ||
        reservation.order_id !== orderId ||
        reservation.request_hash !== upgrade.requestHash ||
        reservation.status !== 'PENDING_PAYMENT' ||
        reservation.payment_id !== null ||
        reservation.current_plan_id !== reservation.source_plan_id ||
        reservation.current_plan_version !== reservation.source_plan_version ||
        reservation.current_subscription_version !== reservation.expected_subscription_version ||
        reservation.subscription_status !== 'ACTIVE' ||
        reservation.subscription_cancel_at !== null) {
      return errorResponse(409, 'UPGRADE_RESERVATION_REQUIRED', 'Upgrade Order is not reserved for payment');
    }
    return null;
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Upgrade checkout reservation could not be verified');
  }
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

  const reservationFailure = await verifyUpgradeCheckoutReservation(env, customerId, route.orderId);
  if (reservationFailure) return reservationFailure;

  try {
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
