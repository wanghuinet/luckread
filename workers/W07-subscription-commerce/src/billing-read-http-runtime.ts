/// <reference types="@cloudflare/workers-types" />

import {
  BillingPersistenceError,
  listBillingDocumentsForCustomer,
  listPaymentHistoryForCustomer,
  listRefundHistoryForCustomer,
} from './billing-persistence.js';
import { parseBoundedPositiveInt } from './subscription-runtime.js';

type BillingReadEnv = Readonly<{ D1_04: D1Database }>;

type BillingReadDependencies = Readonly<{
  listBillingDocuments?: typeof listBillingDocumentsForCustomer;
  listPaymentHistory?: typeof listPaymentHistoryForCustomer;
  listRefundHistory?: typeof listRefundHistoryForCustomer;
}>;

const ROUTES = new Map<string, 'documents' | 'payments' | 'refunds'>([
  ['/commerce/billing/documents', 'documents'],
  ['/commerce/payments/history', 'payments'],
  ['/commerce/payments/refunds', 'refunds'],
]);

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Private W01 -> W07 customer billing reads. W01 authorizes payment.read
 * against the session principal; W07 scopes every query again to that
 * server-derived customer ID. Cursors are opaque keyset cursors, not offsets.
 */
export async function handleCommerceBillingReadRequest(
  request: Request,
  customerId: string,
  env: BillingReadEnv,
  dependencies: BillingReadDependencies = {},
): Promise<Response | null> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Billing request URL is invalid');
  }
  const kind = ROUTES.get(url.pathname);
  if (!kind) return null;
  // The same customer refund path serves GET history and POST refund command.
  // Let the command handler own POST; all other non-GET read methods remain 405.
  if (kind === 'refunds' && request.method === 'POST') return null;
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET', 'cache-control': 'no-store' } });
  }
  if (request.body !== null) {
    await request.body.cancel().catch(() => undefined);
    return errorResponse(400, 'VALIDATION_FAILED', 'Billing read does not accept a request body');
  }
  const allowedParams = new Set(['limit', 'cursor']);
  for (const key of url.searchParams.keys()) {
    if (!allowedParams.has(key)) return errorResponse(400, 'VALIDATION_FAILED', 'Unsupported billing query parameter');
  }
  const rawLimit = url.searchParams.get('limit');
  if (rawLimit !== null && (
    !/^[1-9]\d*$/.test(rawLimit) ||
    !Number.isSafeInteger(Number(rawLimit)) ||
    Number(rawLimit) > 50
  )) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Billing page size is invalid');
  }
  const limit = parseBoundedPositiveInt(rawLimit, 20, 50);
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && (cursor.length < 1 || cursor.length > 512)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Billing cursor is invalid');
  }

  try {
    const result = kind === 'documents'
      ? await (dependencies.listBillingDocuments ?? listBillingDocumentsForCustomer)(env.D1_04, customerId, limit, cursor)
      : kind === 'payments'
        ? await (dependencies.listPaymentHistory ?? listPaymentHistoryForCustomer)(env.D1_04, customerId, limit, cursor)
        : await (dependencies.listRefundHistory ?? listRefundHistoryForCustomer)(env.D1_04, customerId, limit, cursor);
    return Response.json(
      { data: result, requestId: 'req_' + crypto.randomUUID() },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof BillingPersistenceError) {
      const message =
        error.code === 'VALIDATION_FAILED' ? 'Billing request validation failed' :
        error.code === 'RESOURCE_NOT_FOUND' ? 'Billing resource not found' :
        error.code === 'INTEGRITY_VIOLATION' ? 'Billing record integrity check failed' :
        'Billing service unavailable';
      return errorResponse(error.status, error.code, message);
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Billing service unavailable');
  }
}
