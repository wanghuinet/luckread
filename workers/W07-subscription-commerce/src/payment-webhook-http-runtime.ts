/// <reference types="@cloudflare/workers-types" />

import {
  receiveHyperswitchWebhook,
  PaymentPersistenceError,
  type WebhookReceiptResult,
} from './payment-persistence.js';

type HyperswitchWebhookRuntimeEnv = Readonly<{
  D1_04: D1Database;
  HYPERSWITCH_WEBHOOK_SECRET?: string | null;
  HYPERSWITCH_MERCHANT_ID?: string | null;
}>;

type HyperswitchWebhookRuntimeDependencies = Readonly<{
  receive?: typeof receiveHyperswitchWebhook;
}>;

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const WEBHOOK_PATH = '/internal/webhooks/hyperswitch';
const SIGNATURE_HEADER = 'X-Webhook-Signature-512';

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function nonBlank(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

async function readBoundedRawBody(request: Request): Promise<ArrayBuffer | Response> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
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

function receiptResponse(result: WebhookReceiptResult): Response {
  // Signed events that are durably recorded as duplicates or requiring manual
  // reconciliation are acknowledged. Returning 5xx would only cause useless
  // provider retries; database failures still return 503 before a receipt exists.
  const status = result.outcome === 'APPLIED' || result.outcome === 'DUPLICATE' ? 200 : 202;
  return Response.json(
    {
      data: {
        outcome: result.outcome,
        eventId: result.eventId,
        receiptId: result.receiptId,
        state: result.state,
        payloadSha256: result.payloadSha256,
        ...(result.conflictId ? { conflictId: result.conflictId } : {}),
      },
      requestId: 'req_' + crypto.randomUUID(),
    },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * Private W01 → W07 provider callback receiver. W01 only relays bounded raw
 * bytes and the provider signature. W07 owns HMAC verification, event identity,
 * replay/conflict persistence, and payment state application. This endpoint
 * never accepts browser-authenticated principal headers and does not enable
 * order capture, ledger posting, or subscription entitlement grants by itself.
 */
export async function handleHyperswitchWebhookRequest(
  request: Request,
  env: HyperswitchWebhookRuntimeEnv,
  dependencies: HyperswitchWebhookRuntimeDependencies = {},
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
    !nonBlank(env.HYPERSWITCH_WEBHOOK_SECRET, 4096) ||
    !nonBlank(env.HYPERSWITCH_MERCHANT_ID, 256)
  ) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment webhook is not configured');
  }

  const rawBody = await readBoundedRawBody(request);
  if (rawBody instanceof Response) return rawBody;

  try {
    const receive = dependencies.receive ?? receiveHyperswitchWebhook;
    const result = await receive(env.D1_04, {
      rawBody,
      signatureHeader: request.headers.get(SIGNATURE_HEADER),
      webhookSecret: env.HYPERSWITCH_WEBHOOK_SECRET,
      expectedMerchantId: env.HYPERSWITCH_MERCHANT_ID,
    });
    return receiptResponse(result);
  } catch (error) {
    if (error instanceof PaymentPersistenceError) {
      if (error.code === 'INVALID_SIGNATURE') {
        return errorResponse(401, 'INVALID_SIGNATURE', 'Webhook signature is invalid');
      }
      if (error.code === 'WEBHOOK_REJECTED' || error.code === 'VALIDATION_FAILED') {
        return errorResponse(400, 'WEBHOOK_REJECTED', 'Webhook request was rejected');
      }
      if (error.code === 'SERVICE_UNAVAILABLE') {
        return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment webhook service is temporarily unavailable');
      }
      return errorResponse(409, error.code, 'Webhook event requires reconciliation');
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Payment webhook service is temporarily unavailable');
  }
}
