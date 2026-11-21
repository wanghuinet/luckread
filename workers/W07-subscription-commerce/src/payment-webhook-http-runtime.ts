/// <reference types="@cloudflare/workers-types" />

import { readBoundedProviderWebhookBody } from './provider-webhook-body.js'
import {
  PaymentPersistenceError,
  type WebhookReceiptResult,
} from './payment-contracts.js';
import {
  syncRenewalCycleOutcomeForPayment,
  syncPendingRenewalOutcomes,
  type RenewalOutcomeSyncResult,
} from './subscription-renewal-outcome.js';
import {
  fulfillPaidMembershipOrder,
  type PaidMembershipPurchaseFulfillmentResult,
} from './paid-membership-order-fulfillment.js';
import {
  getW07MembershipPostgresPool,
  type W07MembershipDatabaseRuntimeEnv,
} from './neon/membership-database-runtime.js';
import {
  getW07PaymentWebhookPostgresPool,
  type W07PaymentMethodReadRuntimeEnv,
} from './neon/payment-method-read-runtime.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import { receiveHyperswitchRefundWebhookPostgres } from './refund-webhook-postgres-persistence.js';
import { receiveHyperswitchPaymentWebhookPostgres } from './payment-webhook-payment-postgres.js';
import { receiveHyperswitchMandateWebhookPostgres } from './mandate-webhook-postgres-persistence.js';
import { issueReceiptForPaidPaymentPostgres } from './billing-document-postgres-persistence.js';
import { expirePendingSubscriptionPlanUpgradeForPaymentPostgres } from './subscription-plan-upgrade-expiry-postgres.js';

type HyperswitchWebhookRuntimeEnv =
  Pick<W07PaymentMethodReadRuntimeEnv, 'W07_DATABASE_DRIVER' | 'HYPERDRIVE_FINANCE_DB'> &
  W07MembershipDatabaseRuntimeEnv &
  Readonly<{
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
  getWebhookPostgresPool?: (env: HyperswitchWebhookRuntimeEnv) => W07WebhookPostgresPool | undefined;
  getMembershipPostgresPool?: (env: HyperswitchWebhookRuntimeEnv) => W07WebhookPostgresPool | undefined;
  receiveRefundWebhookPostgres?: typeof receiveHyperswitchRefundWebhookPostgres;
  receivePaymentWebhookPostgres?: typeof receiveHyperswitchPaymentWebhookPostgres;
  receiveMandateWebhookPostgres?: typeof receiveHyperswitchMandateWebhookPostgres;
  issueReceiptPostgres?: typeof issueReceiptForPaidPaymentPostgres;
  syncRenewalOutcome?: typeof syncRenewalCycleOutcomeForPayment;
  syncPendingOutcomes?: typeof syncPendingRenewalOutcomes;
  fulfillPaidOrder?: typeof fulfillPaidMembershipOrder;
  expirePendingPlanUpgradePostgres?: typeof expirePendingSubscriptionPlanUpgradeForPaymentPostgres;
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
  // Neon finance receipt application and membership subscription synchronization form a
  // retryable cross-domain saga. A durable receipt can be acknowledged as 202 when the
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
    env.W07_DATABASE_DRIVER?.trim().toLowerCase() !== 'neon' ||
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
    const postgresPool = (dependencies.getWebhookPostgresPool ?? getW07PaymentWebhookPostgresPool)(env);
    if (!postgresPool) throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);

    const nativeRefund = await (dependencies.receiveRefundWebhookPostgres ?? receiveHyperswitchRefundWebhookPostgres)(
      postgresPool,
      webhookInput,
    );
    const nativeMandate = nativeRefund
      ? null
      : await (dependencies.receiveMandateWebhookPostgres ?? receiveHyperswitchMandateWebhookPostgres)(
        postgresPool,
        webhookInput,
      );
    const nativePayment = nativeRefund || nativeMandate
      ? null
      : await (dependencies.receivePaymentWebhookPostgres ?? receiveHyperswitchPaymentWebhookPostgres)(
        postgresPool,
        webhookInput,
      );

    let result: WebhookReceiptResult;
    if (nativeRefund) {
      result = nativeRefund;
    } else if (nativeMandate) {
      result = nativeMandate;
    } else if (nativePayment) {
      result = nativePayment;
    } else {
      throw new PaymentPersistenceError('WEBHOOK_REJECTED', 400);
    }

    // The native PostgreSQL Store has verified the exact raw-body signature and
    // committed its provider receipt before any payment-only post-commit saga runs.
    let subscriptionSync: RenewalOutcomeSyncResult | undefined;
    let pendingRecovery: RenewalPendingRecoveryResult | undefined;
    let purchaseFulfillment: PaidMembershipPurchaseFulfillmentResult | undefined;
    const paymentId = (result.outcome === 'APPLIED' || result.outcome === 'DUPLICATE')
      ? paymentIdFromSignedPayload(rawBody)
      : null;
    if (paymentId) {
      if (isSignedPaymentSucceededEvent(rawBody)) {
        // A receipt is created only after the native PostgreSQL Store has verified
        // the raw HMAC signature and durably committed the successful Payment state.
        // Duplicate signed events safely retry a previously interrupted receipt.
        const issueReceipt = dependencies.issueReceiptPostgres ?? issueReceiptForPaidPaymentPostgres;
        await issueReceipt(postgresPool, paymentId, env.HYPERSWITCH_MERCHANT_ID);
      }
      const sync = dependencies.syncRenewalOutcome ?? syncRenewalCycleOutcomeForPayment;
      const renewalEnv = { ...env, W06_GOVERNANCE: env.W06_GOVERNANCE };
      subscriptionSync = await sync(
        renewalEnv,
        paymentId,
        env.HYPERSWITCH_MERCHANT_ID,
      );

      // Signed provider outcomes are durable in the Neon finance store. Expire only a
      // matching unpaid plan-upgrade reservation when the stored Payment is terminally failed.
      const financePool = postgresPool;
      const membershipPool = (dependencies.getMembershipPostgresPool ?? getW07MembershipPostgresPool)(env);
      if (!financePool || !membershipPool) {
        throw new PaymentPersistenceError('SERVICE_UNAVAILABLE', 503);
      }
      const expireUpgrade = dependencies.expirePendingPlanUpgradePostgres ??
        expirePendingSubscriptionPlanUpgradeForPaymentPostgres;
      await expireUpgrade(financePool, membershipPool, paymentId, env.HYPERSWITCH_MERCHANT_ID);

      // Initial creator-membership purchases have no renewal-cycle row. Only a
      // verified payment_succeeded event may fulfill one, and fulfillment reads
      // the durable Neon finance Payment + Order + immutable OrderLine snapshot
      // before performing an idempotent scoped transition in the Neon membership store.
      if (subscriptionSync.outcome === 'NO_RENEWAL_CYCLE' && isSignedPaymentSucceededEvent(rawBody)) {
        const fulfill = dependencies.fulfillPaidOrder ?? fulfillPaidMembershipOrder;
        purchaseFulfillment = await fulfill(renewalEnv, paymentId, env.HYPERSWITCH_MERCHANT_ID);
      }

      // A verified terminal renewal payment is an existing, trusted execution
      // opportunity to drain a small bounded batch of older Neon finance ->
      // Neon membership outcome-sync work. This is recovery only: it does not
      // schedule new charges and does not create a new provider charge.
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
