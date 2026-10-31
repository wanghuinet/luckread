/// <reference types="@cloudflare/workers-types" />

import {
  fetchRevenueCatSubscriber,
  RevenueCatSubscriberApiError,
} from './revenuecat-subscriber-api.js';
import {
  buildRevenueCatSubscriberReconciliationCandidates,
  RevenueCatSubscriberReconciliationError,
} from './revenuecat-subscriber-reconciliation.js';
import { RevenueCatSubscriberIdentityError } from './revenuecat-subscriber-identity.js';
import { syncRevenueCatStoreTrialCandidates } from './membership-trial-runtime.js';

const RECONCILIATION_PATH = '/internal/subscriptions/reconcile-revenuecat';
const MAX_BODY_BYTES = 2_048;
const W02_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type RevenueCatSubscriberReconciliationRuntimeEnv = Readonly<{
  D1_01: D1Database;
  REVENUECAT_SECRET_API_KEY?: string | null;
  REVENUECAT_ALLOWED_APP_IDS?: string | null;
}>;

export type RevenueCatSubscriberReconciliationRuntimeDependencies = Readonly<{
  fetchSubscriber?: typeof fetchRevenueCatSubscriber;
  buildCandidates?: typeof buildRevenueCatSubscriberReconciliationCandidates;
  nowMs?: () => number;
}>;

class InvalidRequestError extends Error {
  constructor() {
    super('INVALID_REQUEST');
    this.name = 'InvalidRequestError';
  }
}

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

function parseAllowedAppIds(value: unknown): ReadonlySet<string> | null {
  if (!nonBlank(value, 4_096)) return null;
  const items = value.split(',').map((item) => item.trim());
  if (
    items.length < 1 ||
    items.length > 16 ||
    items.some((item) => !nonBlank(item, 255)) ||
    new Set(items).size !== items.length
  ) return null;
  return new Set(items);
}

async function readAppId(request: Request): Promise<string> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new InvalidRequestError();
  }
  if (!request.body) throw new InvalidRequestError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new InvalidRequestError();
      }
      chunks.push(part.value);
    }
  } catch (error) {
    if (error instanceof InvalidRequestError) throw error;
    throw new InvalidRequestError();
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new InvalidRequestError();
  }
  if (
    !decoded ||
    typeof decoded !== 'object' ||
    Array.isArray(decoded) ||
    Object.keys(decoded).length !== 1 ||
    !Object.hasOwn(decoded, 'appId') ||
    !nonBlank((decoded as { appId?: unknown }).appId, 255)
  ) throw new InvalidRequestError();
  return (decoded as { appId: string }).appId;
}

/**
 * W01-only, user-scoped read path. The principal comes only from the
 * W02-authenticated transport header; appId merely selects an allowlisted
 * product-binding namespace and is never an identity or purchase authority.
 *
 * This endpoint re-reads RevenueCat and returns sanitized candidates only.
 * It never writes D1, creates subscriptions/payments, or grants entitlements.
 */
export async function handleRevenueCatSubscriberReconciliationRequest(
  request: Request,
  env: RevenueCatSubscriberReconciliationRuntimeEnv,
  dependencies: RevenueCatSubscriberReconciliationRuntimeDependencies = {},
): Promise<Response | null> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.pathname !== RECONCILIATION_PATH) return null;
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST', 'cache-control': 'no-store' } });
  }

  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
    !nonBlank(request.headers.get('X-LuckRead-Correlation-Id'), 128)
  ) {
    return errorResponse(403, 'PERMISSION_DENIED', 'Subscription transport is not authorized');
  }
  if (request.headers.has('Authorization') || request.headers.has('Cookie')) {
    return errorResponse(403, 'PERMISSION_DENIED', 'Browser credentials are not accepted on the internal route');
  }

  const principalId = request.headers.get('X-LuckRead-Principal-User-Id') ?? '';
  const layer = request.headers.get('X-LuckRead-Principal-Layer') ?? '';
  if (!W02_USER_ID_PATTERN.test(principalId) || !/^L[2-8]$/.test(layer)) {
    return errorResponse(403, 'PERMISSION_DENIED', 'A verified W02 principal is required');
  }

  let appId: string;
  try {
    appId = await readAppId(request);
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'RevenueCat app selection is invalid');
  }

  const allowedAppIds = parseAllowedAppIds(env.REVENUECAT_ALLOWED_APP_IDS);
  if (!allowedAppIds) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat app allowlist is not configured');
  }
  if (!allowedAppIds.has(appId)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'RevenueCat app selection is not allowed');
  }
  if (!nonBlank(env.REVENUECAT_SECRET_API_KEY, 4_096)) {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat subscriber lookup is not configured');
  }

  try {
    const fetchSubscriber = dependencies.fetchSubscriber ?? fetchRevenueCatSubscriber;
    const buildCandidates = dependencies.buildCandidates ?? buildRevenueCatSubscriberReconciliationCandidates;
    const snapshot = await fetchSubscriber({
      appUserId: principalId,
      secretApiKey: env.REVENUECAT_SECRET_API_KEY,
    });
    const result = await buildCandidates(
      env.D1_01,
      {
        snapshot,
        expectedAppUserId: principalId,
        revenueCatAppId: appId,
      },
      dependencies.nowMs ? { nowMs: dependencies.nowMs } : undefined,
    );

    const trialSync = await syncRevenueCatStoreTrialCandidates(
      env.D1_01,
      principalId,
      appId,
      result.candidates,
    )

    const candidates = result.candidates.map((candidate) => ({
      planId: candidate.planId,
      planVersion: candidate.planVersion,
      creatorId: candidate.creatorId,
      billingInterval: candidate.billingInterval,
      store: candidate.store,
      productId: candidate.productId,
      entitlementIds: candidate.entitlementIds,
      currentState: candidate.currentState,
      purchaseDate: candidate.purchaseDate,
      effectiveExpiresAt: candidate.effectiveExpiresAt,
      gracePeriodExpiresAt: candidate.gracePeriodExpiresAt,
      periodType: candidate.periodType,
      originalTransactionId: candidate.originalTransactionId,
    }));

    return Response.json(
      {
        data: {
          snapshotRequestDateMs: result.snapshotRequestDateMs,
          customerCreatedOnLookup: result.customerCreatedOnLookup,
          trialSync,
          candidates,
        },
        requestId: 'req_' + crypto.randomUUID(),
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof RevenueCatSubscriberIdentityError) {
      return errorResponse(403, 'PERMISSION_DENIED', 'RevenueCat customer identity could not be verified');
    }
    if (error instanceof RevenueCatSubscriberApiError) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat subscriber service is unavailable');
    }
    if (error instanceof RevenueCatSubscriberReconciliationError) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat membership mapping is unavailable');
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'RevenueCat membership reconciliation is unavailable');
  }
}
