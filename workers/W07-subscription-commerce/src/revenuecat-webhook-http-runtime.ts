/// <reference types="@cloudflare/workers-types" />

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

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
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
    value.trim() === value && !/[\\u0000-\\u001f\\u007f]/.test(value);
}

function allowedAppIds(value: string): ReadonlySet<string> | null {
  const items = value.split(',').map((item) => item.trim());
  if (items.length < 1 || items.length > 16 ||
      items.some((item) => !nonBlank(item, 255)) ||
      new Set(items).size !== items.length) return null;
  return new Set(items);
}

async function readBoundedRawBody(request: Request): Promise<ArrayBuffer | Response> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\\d+$/.test(declaredLength)) {
      return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook request length is invalid');
    }
    if (Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES) {
      return errorResponse(413, 'WEBHOOK_REJECTED', 'Webhook request is too large');
    }
  }
  if (!request.body) return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook body is required');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_WEBHOOK_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return errorResponse(413, 'WEBHOOK_REJECTED', 'Webhook request is too large');
      }
      chunks.push(part.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook body could not be read');
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer as ArrayBuffer;
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
 * W01-only private receiver. The webhook is acknowledged with 200 only after
 * the sanitized event receipt (or an idempotent duplicate/conflict record)
 * is durable in D1-04. This endpoint never activates a subscription or grants
 * a content entitlement.
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
    !nonBlank(env.REVENUECAT_WEBHOOK_SIGNING_SECRET, 4096) ||
    !nonBlank(env.REVENUECAT_ALLOWED_APP_IDS, 4096)
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

  const rawBody = await readBoundedRawBody(request);
  if (rawBody instanceof Response) return rawBody;

  const signatureValid = await verifyRevenueCatWebhookSignature(
    rawBody,
    request.headers.get(SIGNATURE_HEADER),
    env.REVENUECAT_WEBHOOK_SIGNING_SECRET,
    dependencies.nowMs?.() ?? Date.now(),
  );
  if (!signatureValid) return errorResponse(401, 'INVALID_SIGNATURE', 'Webhook signature is invalid');

  try {
    const event = parseRevenueCatWebhookEnvelope(rawBody, appIds);
    if (event.eventType === 'TEST') {
      return Response.json(
        { data: { outcome: 'TEST_ACKNOWLEDGED', eventId: event.eventId, entitlementApplied: false }, requestId: 'req_' + crypto.randomUUID() },
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
