/// <reference types="@cloudflare/workers-types" />

import { readBoundedProviderWebhookBody } from './provider-webhook-body.js'
import {
  receiveHyperswitchWebhook,
  PaymentPersistenceError,
  type WebhookReceiptResult,
} from './payment-persistence.js';
import {
  syncRenewalCycleOutcomeForPayment,
  syncPendingRenewalOutcomes,
  type RenewalOutcomeSyncResult,
} from './subscription-renewal-outcome.js';
import {
  fulfillPaidMembershipOrder,
  type PaidMembershipPurchaseFulfillmentResult,
} from './paid-membership-order-fulfillment.js';
import { issueReceiptForPaidPayment } from './billing-persistence.js';

type HyperswitchWebhookRuntimeEnv = Readonly<{
  D1_01: D1Database;
  D1_04: D1Database;
  HYPERSWITCH_WEBHOOK_SECRET?: string | null;
  HYPERSWITCH_MERCHANT_ID?: string | null;
}>;

type RenewalPendingRecoveryResult = Readonly<{
  scanned: number;
  applied: number;
  reconciliationRequired: number;
  pendingRetry: number;
}>;

type HyperswitchWebhookRuntimeDependencies = Readonly<{
  receive?: typeof receiveHyperswitchWebhook;
  syncRenewalOutcome?: (
    env: Readonly<{ D1_01: D1Database; D1_04: D1Database }>,
    paymentId: string,
    merchantId: string,
  ) => Promise<RenewalOutcomeSyncResult>;
  syncPendingOutcomes?: (
    env: Readonly<{ D1_01: D1Database; D1_04: D1Database }>,
    options?: Readonly<{ limit?: number }>,
  ) => Promise<RenewalPendingRecoveryResult>;
  fulfillPaidOrder?: typeof fulfillPaidMembershipOrder;
  issueReceipt?: typeof issueReceiptForPaidPayment;
}>;

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

function receiptResponse(
  result: WebhookReceiptResult,
  subscriptionSync?: RenewalOutcomeSyncResult,
  pendingRecovery?: RenewalPendingRecoveryResult,
  purchaseFulfillment?: PaidMembershipPurchaseFulfillmentResult,
): Response {
  // D1-04 receipt application and D1-01 subscription synchronization are a
  // retryable saga. A durable receipt can be acknowledged as 202 when the
  // entitlement-affecting Subscription state or bounded recovery batch needs work.
  const subscriptionSyncNeedsWork = subscriptionSync?.outcome === 'RECONCILIATION_REQUIRED' ||
    subscriptionSync?.outcome === 'PENDING_RETRY';
  const pendingRecoveryNeedsWork = (pendingRecovery?.reconciliationRequired ?? 0) > 0 ||
    (pendingRecovery?.pendingRetry ?? 0) > 0;
  const status = !subscriptionSyncNeedsWork && !pendingRecoveryNeedsWork &&
    (result.outcome === 'APPLIED' || result.outcome === 'DUPLICATE') ? 200 : 202;
  return Response.json(
    {
      data: {
        outcome: result.outcome,
        eventId: result.eventId,
        receiptId: result.receiptId,
        state: result.state,
        payloadSha256: result.payloadSha256,
        ...(result.conflictId ? { conflictId: result.conflictId } : {}),
        ...(subscriptionSync ? {
          subscriptionSync: subscriptionSync.outcome,
          ...(subscriptionSync.reasonCode ? { subscriptionSyncReason: subscriptionSync.reasonCode } : {}),
          ...(subscriptionSync.subscriptionId ? { subscriptionId: subscriptionSync.subscriptionId } : {}),
        } : {}),
        ...(pendingRecovery ? { pendingRenewalRecovery: pendingRecovery } : {}),
        ...(purchaseFulfillment ? {
          membershipPurchaseFulfillment: {
            outcome: purchaseFulfillment.outcome,
            fulfilledCount: purchaseFulfillment.fulfilledCount,
          },
        } : {}),
      },
      requestId: 'req_' + crypto.randomUUID(),
    },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function isSignedPaymentSucceededEvent(rawBody: ArrayBuffer): boolean {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>).event_type === 'payment_succeeded';
  } catch {
    return false;
  }
}

function paymentIdFromSignedPayload(rawBody: ArrayBuffer): string | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const envelope = parsed as Record<string, unknown>;
    if (envelope.content_type !== 'payment_details' ||
        typeof envelope.resource !== 'object' || envelope.resource === null || Array.isArray(envelope.resource)) return null;
    const paymentId = (envelope.resource as Record<string, unknown>).payment_id;
    return typeof paymentId === 'string' && /^pay_[A-Za-z0-9]{26}$/.test(paymentId) ? paymentId : null;
  } catch {
    return null;
  }
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

  const rawBody = await readBoundedProviderWebhookBody(request, errorResponse);
  if (rawBody instanceof Response) return rawBody;

  try {
    const receive = dependencies.receive ?? receiveHyperswitchWebhook;
    const result = await receive(env.D1_04, {
      rawBody,
      signatureHeader: request.headers.get(SIGNATURE_HEADER),
      webhookSecret: env.HYPERSWITCH_WEBHOOK_SECRET,
      expectedMerchantId: env.HYPERSWITCH_MERCHANT_ID,
    });

    // receiveHyperswitchWebhook verifies the provider signature and durably
    // commits the D1-04 event/payment/cycle outcome before this point. Only then
    // may the same signed payload identify a renewal cycle for D1-01 sync.
    let subscriptionSync: RenewalOutcomeSyncResult | undefined;
    let pendingRecovery: RenewalPendingRecoveryResult | undefined;
    let purchaseFulfillment: PaidMembershipPurchaseFulfillmentResult | undefined;
    const paymentId = (result.outcome === 'APPLIED' || result.outcome === 'DUPLICATE')
      ? paymentIdFromSignedPayload(rawBody)
      : null;
    if (paymentId && isSignedPaymentSucceededEvent(rawBody)) {
      // A receipt is created only after receiveHyperswitchWebhook has verified
      // the raw HMAC signature and committed the successful Payment state.
      // Duplicate signed events safely retry a previously interrupted receipt.
      const issueReceipt = dependencies.issueReceipt ?? issueReceiptForPaidPayment;
      await issueReceipt(env.D1_04, paymentId, env.HYPERSWITCH_MERCHANT_ID);
    }
    if (paymentId) {
      const sync = dependencies.syncRenewalOutcome ?? syncRenewalCycleOutcomeForPayment;
      const renewalEnv = { D1_01: env.D1_01, D1_04: env.D1_04 };
      subscriptionSync = await sync(
        renewalEnv,
        paymentId,
        env.HYPERSWITCH_MERCHANT_ID,
      );

      // Initial creator-membership purchases have no renewal-cycle row. Only a
      // verified payment_succeeded event may fulfill one, and fulfillment reads
      // the durable D1-04 Payment + Order + immutable OrderLine snapshot before
      // performing an idempotent scoped transition in D1-01.
      if (subscriptionSync.outcome === 'NO_RENEWAL_CYCLE' && isSignedPaymentSucceededEvent(rawBody)) {
        const fulfill = dependencies.fulfillPaidOrder ?? fulfillPaidMembershipOrder;
        purchaseFulfillment = await fulfill(renewalEnv, paymentId, env.HYPERSWITCH_MERCHANT_ID);
      }

      // A verified terminal renewal payment is an existing, trusted execution
      // opportunity to drain a small bounded batch of older D1-04 -> D1-01
      // outcome-sync work. This is recovery only: it does not schedule new
      // charges, and it is skipped for ordinary payments before migration 0004.
      if (subscriptionSync.outcome === 'APPLIED' || subscriptionSync.outcome === 'ALREADY_APPLIED') {
        const recover = dependencies.syncPendingOutcomes ?? syncPendingRenewalOutcomes;
        pendingRecovery = await recover(renewalEnv, { limit: 10 });
      }
    }
    return receiptResponse(result, subscriptionSync, pendingRecovery, purchaseFulfillment);
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
