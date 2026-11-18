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
import { expirePendingSubscriptionPlanUpgradeForPayment } from './subscription-plan-change-checkout.js';
import {
  getW07PaymentWebhookDatabase,
  getW07PaymentWebhookPostgresPool,
  type W07PaymentMethodReadRuntimeEnv,
} from './neon/payment-method-read-runtime.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import { receiveHyperswitchRefundWebhookPostgres } from './refund-webhook-postgres-persistence.js';
import { receiveHyperswitchPaymentWebhookPostgres } from './payment-webhook-payment-postgres.js';
import { receiveHyperswitchMandateWebhookPostgres } from './mandate-webhook-postgres-persistence.js';
import { issueReceiptForPaidPaymentPostgres } from './billing-document-postgres-persistence.js';

type HyperswitchWebhookRuntimeEnv = W07PaymentMethodReadRuntimeEnv & Readonly<{
  D1_01: D1Database;
  D1_04: D1Database;
  W06_GOVERNANCE?: Fetcher;
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
  getWebhookDatabase?: (env: HyperswitchWebhookRuntimeEnv) => D1Database | undefined;
  getWebhookPostgresPool?: (env: HyperswitchWebhookRuntimeEnv) => W07WebhookPostgresPool | undefined;
  receiveRefundWebhookPostgres?: typeof receiveHyperswitchRefundWebhookPostgres;
  receivePaymentWebhookPostgres?: typeof receiveHyperswitchPaymentWebhookPostgres;
  receiveMandateWebhookPostgres?: typeof receiveHyperswitchMandateWebhookPostgres;
  issueReceiptPostgres?: typeof issueReceiptForPaidPaymentPostgres;
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
  expirePendingPlanUpgrade?: typeof expirePendingSubscriptionPlanUpgradeForPayment;
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
  const purchaseFulfillmentNeedsWork = purchaseFulfillment?.outcome === 'RECONCILIATION_REQUIRED';
  const status = !subscriptionSyncNeedsWork && !pendingRecoveryNeedsWork && !purchaseFulfillmentNeedsWork &&
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
            ...(purchaseFulfillment.reasonCode ? { reasonCode: purchaseFulfillment.reasonCode } : {}),
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
    const content = typeof envelope.content === 'object' && envelope.content !== null &&
      !Array.isArray(envelope.content)
      ? envelope.content as Record<string, unknown>
      : null;
    const contentType = envelope.content_type ?? content?.type;
    const resourceValue = envelope.resource ?? content?.object;
    if (contentType !== 'payment_details' ||
        typeof resourceValue !== 'object' || resourceValue === null || Array.isArray(resourceValue)) return null;
    const paymentId = (resourceValue as Record<string, unknown>).payment_id;
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
    const webhookInput = {
      rawBody,
      signatureHeader: request.headers.get(SIGNATURE_HEADER),
      webhookSecret: env.HYPERSWITCH_WEBHOOK_SECRET,
      expectedMerchantId: env.HYPERSWITCH_MERCHANT_ID,
    };
    let webhookDatabase: D1Database | undefined;
    const useNeon = env.W07_DATABASE_DRIVER?.trim().toLowerCase() === 'neon';
    const postgresPool = useNeon
      ? (dependencies.getWebhookPostgresPool ?? getW07PaymentWebhookPostgresPool)(env)
      : undefined;
    const nativeRefund = postgresPool
      ? await (dependencies.receiveRefundWebhookPostgres ?? receiveHyperswitchRefundWebhookPostgres)(
        postgresPool, webhookInput,
      )
      : null;
    const nativeMandate = postgresPool && !nativeRefund
      ? await (dependencies.receiveMandateWebhookPostgres ?? receiveHyperswitchMandateWebhookPostgres)(
        postgresPool, webhookInput,
      )
      : null;
    const nativePayment = postgresPool && !nativeRefund && !nativeMandate
      ? await (dependencies.receivePaymentWebhookPostgres ?? receiveHyperswitchPaymentWebhookPostgres)(
        postgresPool, webhookInput,
      )
      : null;
    let result: WebhookReceiptResult;
    if (nativeRefund) {
      result = nativeRefund;
    } else if (nativeMandate) {
      result = nativeMandate;
    } else if (nativePayment) {
      // Keep the existing read/sync saga on the selected D1-04 Neon facade;
      // payment_details state, order and renewal-cycle writes are committed natively above.
      const neonDatabase = (dependencies.getWebhookDatabase ?? getW07PaymentWebhookDatabase)(env);
      if (!neonDatabase) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
      webhookDatabase = neonDatabase;
      result = nativePayment;
    } else {
      const receive = dependencies.receive ?? receiveHyperswitchWebhook;
      const neonDatabase = (dependencies.getWebhookDatabase ?? getW07PaymentWebhookDatabase)(env);
      webhookDatabase = neonDatabase ?? env.D1_04;
      result = await receive(webhookDatabase, webhookInput, {
        databaseDialect: neonDatabase ? 'postgres' : 'd1',
      });
    }

    // The selected native PostgreSQL Store or D1-compatible bridge has verified
    // the exact raw-body signature and committed its provider receipt before any
    // payment-only post-commit saga is allowed to run.
    let subscriptionSync: RenewalOutcomeSyncResult | undefined;
    let pendingRecovery: RenewalPendingRecoveryResult | undefined;
    let purchaseFulfillment: PaidMembershipPurchaseFulfillmentResult | undefined;
    const paymentId = (result.outcome === 'APPLIED' || result.outcome === 'DUPLICATE')
      ? paymentIdFromSignedPayload(rawBody)
      : null;
    if (paymentId) {
      const selectedWebhookDatabase = webhookDatabase;
      if (!selectedWebhookDatabase) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
      if (isSignedPaymentSucceededEvent(rawBody)) {
        // A receipt is created only after the selected provider Store has verified
        // the raw HMAC signature and durably committed the successful Payment state.
        // Duplicate signed events safely retry a previously interrupted receipt.
        if (postgresPool) {
          const issueReceipt = dependencies.issueReceiptPostgres ?? issueReceiptForPaidPaymentPostgres;
          await issueReceipt(postgresPool, paymentId, env.HYPERSWITCH_MERCHANT_ID);
        } else {
          const issueReceipt = dependencies.issueReceipt ?? issueReceiptForPaidPayment;
          await issueReceipt(selectedWebhookDatabase, paymentId, env.HYPERSWITCH_MERCHANT_ID);
        }
      }
      const sync = dependencies.syncRenewalOutcome ?? syncRenewalCycleOutcomeForPayment;
      const renewalEnv = { D1_01: env.D1_01, D1_04: selectedWebhookDatabase, W06_GOVERNANCE: env.W06_GOVERNANCE };
      subscriptionSync = await sync(
        renewalEnv,
        paymentId,
        env.HYPERSWITCH_MERCHANT_ID,
      );

      // Signed provider outcomes are already durable in D1-04. Expire only a
      // matching unpaid plan-upgrade reservation when the stored Payment is terminally failed.
      const expireUpgrade = dependencies.expirePendingPlanUpgrade ??
        expirePendingSubscriptionPlanUpgradeForPayment;
      await expireUpgrade(renewalEnv, paymentId, env.HYPERSWITCH_MERCHANT_ID);

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
