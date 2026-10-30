/// <reference types="@cloudflare/workers-types" />

import {
  retrieveHyperswitchPayment,
  HyperswitchClientError,
  type HyperswitchClientConfig,
  type HyperswitchPaymentStatus,
} from './hyperswitch-client.js';
import {
  getPaymentAttempt,
  PaymentPersistenceError,
  type PaymentAttemptDto,
} from './payment-persistence.js';

type PaymentStatusEnv = Readonly<{
  D1_04: D1Database;
  HYPERSWITCH_ENVIRONMENT?: string | null;
  HYPERSWITCH_API_KEY?: string | null;
  HYPERSWITCH_MERCHANT_ID?: string | null;
}>;

type ProviderStatusCheck = 'MATCH' | 'DIFFERS' | 'UNAVAILABLE';

type PaymentStatusResponse = Readonly<{
  payment: PaymentAttemptDto;
  providerStatus: HyperswitchPaymentStatus | null;
  providerStatusCheck: ProviderStatusCheck;
  providerCheckedAt: string | null;
  statusAuthority: 'W07_D1_04';
}>;

type PaymentStatusDependencies = Readonly<{
  readPayment?: typeof getPaymentAttempt;
  retrieveProvider?: typeof retrieveHyperswitchPayment;
  now?: () => Date;
}>;

export class PaymentStatusRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'PaymentStatusRuntimeError';
  }
}

const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function resolveProviderConfig(env: PaymentStatusEnv): HyperswitchClientConfig | null {
  if (
    (env.HYPERSWITCH_ENVIRONMENT !== 'sandbox' && env.HYPERSWITCH_ENVIRONMENT !== 'production') ||
    typeof env.HYPERSWITCH_API_KEY !== 'string' ||
    env.HYPERSWITCH_API_KEY.length < 1 ||
    env.HYPERSWITCH_API_KEY.length > 4096 ||
    env.HYPERSWITCH_API_KEY.trim() !== env.HYPERSWITCH_API_KEY ||
    /[\r\n]/.test(env.HYPERSWITCH_API_KEY) ||
    typeof env.HYPERSWITCH_MERCHANT_ID !== 'string' ||
    env.HYPERSWITCH_MERCHANT_ID.length < 1 ||
    env.HYPERSWITCH_MERCHANT_ID.length > 256 ||
    env.HYPERSWITCH_MERCHANT_ID.trim() !== env.HYPERSWITCH_MERCHANT_ID ||
    /[\u0000-\u001f\u007f]/.test(env.HYPERSWITCH_MERCHANT_ID)
  ) return null;
  return {
    environment: env.HYPERSWITCH_ENVIRONMENT,
    apiKey: env.HYPERSWITCH_API_KEY,
    expectedMerchantId: env.HYPERSWITCH_MERCHANT_ID,
  };
}

function resolvePaymentStatusRoute(request: Request): { paymentId: string } | Response | null {
  let url: URL;
  let segments: string[];
  try {
    url = new URL(request.url);
    segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid payment path');
  }
  if (segments[0] !== 'payments') return null;
  if (segments.length !== 2 || request.method !== 'GET') {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  if ([...url.searchParams.keys()].length > 0) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Payment status does not accept query parameters');
  }
  const paymentId = segments[1]!;
  if (!PAYMENT_ID_PATTERN.test(paymentId)) {
    return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Payment not found');
  }
  if (request.body !== null) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Payment status does not accept a request body');
  }
  return { paymentId };
}

/**
 * W01-derived customer identity is mandatory. D1-04 ownership is rechecked
 * before any provider lookup. The persisted W07 status remains authoritative;
 * a live provider read is an observation only and cannot confirm an Order or
 * grant/revoke an entitlement. Provider credentials/client secrets are never
 * returned to the caller.
 */
export async function handlePaymentStatusRequest(
  request: Request,
  customerId: string,
  env: PaymentStatusEnv,
  dependencies: PaymentStatusDependencies = {},
): Promise<Response | null> {
  const route = resolvePaymentStatusRoute(request);
  if (route === null) return null;
  if (route instanceof Response) return route;

  try {
    const readPayment = dependencies.readPayment ?? getPaymentAttempt;
    const payment = await readPayment(env.D1_04, customerId, route.paymentId);
    const config = resolveProviderConfig(env);
    let providerStatus: HyperswitchPaymentStatus | null = null;
    let providerStatusCheck: ProviderStatusCheck = 'UNAVAILABLE';
    let providerCheckedAt: string | null = null;

    if (config) {
      const checkedAt = (dependencies.now ?? (() => new Date()))();
      if (!(checkedAt instanceof Date) || !Number.isFinite(checkedAt.getTime())) {
        throw new PaymentStatusRuntimeError('SERVICE_UNAVAILABLE', 503);
      }
      providerCheckedAt = checkedAt.toISOString();
      try {
        const retrieveProvider = dependencies.retrieveProvider ?? retrieveHyperswitchPayment;
        const observed = await retrieveProvider(config, payment.paymentId, undefined, true);
        const identityMatches =
          observed.paymentId === payment.paymentId &&
          observed.merchantId === config.expectedMerchantId &&
          observed.amount === payment.amountMinor &&
          observed.currency === payment.currency &&
          (observed.customerId === undefined || observed.customerId === null || observed.customerId === customerId);
        if (identityMatches) {
          providerStatus = observed.status;
          providerStatusCheck = observed.status === payment.status ? 'MATCH' : 'DIFFERS';
        }
      } catch (error) {
        // A provider outage does not hide the last D1-04 state. Do not turn an
        // unavailable live read into payment success or a false failure.
        if (!(error instanceof HyperswitchClientError)) {
          providerStatus = null;
        }
      }
    }

    const data: PaymentStatusResponse = {
      payment,
      providerStatus,
      providerStatusCheck,
      providerCheckedAt,
      statusAuthority: 'W07_D1_04',
    };
    return Response.json(
      { data, requestId: 'req_' + crypto.randomUUID() },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof PaymentPersistenceError) {
      const message =
        error.code === 'RESOURCE_NOT_FOUND' ? 'Payment not found' :
        error.code === 'VALIDATION_FAILED' ? 'Payment identifier is invalid' :
        error.code === 'INTEGRITY_VIOLATION' ? 'Payment record integrity could not be verified' :
        'Payment service unavailable';
      return errorResponse(error.status, error.code, message);
    }
    if (error instanceof PaymentStatusRuntimeError) {
      return errorResponse(error.status, error.code, 'Payment status could not be verified');
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment service unavailable');
  }
}
