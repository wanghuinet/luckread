/// <reference types="@cloudflare/workers-types" />

import { readBoundedProviderWebhookBody } from './provider-webhook-body.js'
import {
  parseRevenueCatWebhookEnvelope,
  RevenueCatWebhookValidationError,
  verifyRevenueCatAuthorization,
  verifyRevenueCatWebhookSignature,
} from './revenuecat-webhook-signature.js';
import {
  recordRevenueCatWebhookEvent,
  RevenueCatWebhookPersistenceError,
  type RevenueCatWebhookReceiptResult,
} from './revenuecat-webhook-persistence.js';

type RevenueCatWebhookRuntimeEnv = Readonly<{
  D1_04: D1Database;
  REVENUECAT_WEBHOOK_AUTHORIZATION?: string | null;
  REVENUECAT_WEBHOOK_SIGNING_SECRET?: string | null;
  REVENUECAT_ALLOWED_APP_IDS?: string | null;
}>;

type RevenueCatWebhookRuntimeDependencies = Readonly<{
  receive?: typeof recordRevenueCatWebhookEvent;
  nowMs?: () => number;
}>;

const WEBHOOK_PATH = '/internal/webhooks/revenuecat';
const AUTHORIZATION_HEADER = 'Authorization';
const SIGNATURE_HEADER = 'X-RevenueCat-Webhook-Signature';

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function nonBlank(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function allowedAppIds(value: string): ReadonlySet<string> | null {
  const items = value.split(',').map((item) => item.trim());
  if (items.length < 1 || items.length > 16 ||
      items.some((item) => !nonBlank(item, 255)) ||
      new Set(items).size !== items.length) return null;
  return new Set(items);
}

function receiptResponse(result: RevenueCatWebhookReceiptResult): Response {
  return Response.json(
    {
      data: {
        outcome: result.outcome,
        eventId: result.eventId,
        receiptId: result.receiptId,
        payloadSha256: result.payloadSha256,
        entitlementApplied: false,
      },
      requestId: 'req_' + crypto.randomUUID(),
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * W01-only private receiver. Store-backed events are acknowledged with 200
 * only after a sanitized receipt is durable in D1-04. Non-store experiment and
 * promotional events are acknowledged as ignored without creating a purchase
 * receipt. This endpoint never activates a subscription or grants entitlement.
 */
export async function handleRevenueCatWebhookRequest(
  request: Request,
  env: RevenueCatWebhookRuntimeEnv,
  dependencies: RevenueCatWebhookRuntimeDependencies = {},
): Promise<Response | null> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook request URL is invalid');
  }
  if (url.pathname !== WEBHOOK_PATH) return null;
  if (request.method !== 'POST') {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
    !nonBlank(request.headers.get('X-LuckRead-Correlation-Id'), 256)
  ) {
    return errorResponse(403, 'PERMISSION_DENIED', 'Webhook transport is not authorized');
  }

  if (
    !nonBlank(env.REVENUECAT_WEBHOOK_AUTHORIZATION, 5000) ||
    !nonBlank(env.REVENUECAT_ALLOWED_APP_IDS, 4096) ||
    (env.REVENUECAT_WEBHOOK_SIGNING_SECRET !== undefined &&
      env.REVENUECAT_WEBHOOK_SIGNING_SECRET !== null &&
      !nonBlank(env.REVENUECAT_WEBHOOK_SIGNING_SECRET, 4096))
  ) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat webhook is not configured');
  }
  const appIds = allowedAppIds(env.REVENUECAT_ALLOWED_APP_IDS);
  if (!appIds) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat app allowlist is invalid');

  if (!verifyRevenueCatAuthorization(
    request.headers.get(AUTHORIZATION_HEADER),
    env.REVENUECAT_WEBHOOK_AUTHORIZATION,
  )) {
    return errorResponse(401, 'INVALID_SIGNATURE', 'Webhook authorization is invalid');
  }

  const rawBody = await readBoundedProviderWebhookBody(request, errorResponse);
  if (rawBody instanceof Response) return rawBody;

  // RevenueCat HMAC signing is optional in its dashboard. Authorization is
  // always checked; once a signing secret is configured, a missing or invalid
  // HMAC signature is rejected rather than silently falling back.
  if (env.REVENUECAT_WEBHOOK_SIGNING_SECRET) {
    const signatureValid = await verifyRevenueCatWebhookSignature(
      rawBody,
      request.headers.get(SIGNATURE_HEADER),
      env.REVENUECAT_WEBHOOK_SIGNING_SECRET,
      dependencies.nowMs?.() ?? Date.now(),
    );
    if (!signatureValid) return errorResponse(401, 'INVALID_SIGNATURE', 'Webhook signature is invalid');
  }

  try {
    const event = parseRevenueCatWebhookEnvelope(rawBody, appIds);
    if (event.eventType === 'TEST') {
      return Response.json(
        { data: { outcome: 'TEST_ACKNOWLEDGED', eventId: event.eventId, entitlementApplied: false }, requestId: 'req_' + crypto.randomUUID() },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      );
    }
    if (event.appId === null) {
      // No store-backed product mapping exists for these events; acknowledge
      // them without creating a purchase receipt or changing subscription state.
      console.log(JSON.stringify({
        event: 'revenuecat.webhook.ignored_non_store_source',
        eventId: event.eventId,
        eventType: event.eventType,
        store: event.store,
      }));
      return Response.json(
        { data: { outcome: 'IGNORED_NON_STORE_SOURCE', eventId: event.eventId, entitlementApplied: false }, requestId: 'req_' + crypto.randomUUID() },
        { status: 200, headers: { 'cache-control': 'no-store' } },
      );
    }
    const receive = dependencies.receive ?? recordRevenueCatWebhookEvent;
    const result = await receive(env.D1_04, event, rawBody);
    return receiptResponse(result);
  } catch (error) {
    if (error instanceof RevenueCatWebhookValidationError) {
      return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook request was rejected');
    }
    if (error instanceof RevenueCatWebhookPersistenceError) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat webhook receipt could not be persisted');
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat webhook service is temporarily unavailable');
  }
}
