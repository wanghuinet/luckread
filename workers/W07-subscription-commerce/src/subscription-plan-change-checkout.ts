/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import { applyDemoTaxPricing, isDemoPricingEnabled } from './demo-tax-pricing.js';
import { applyTaxJarSandboxPricing } from './taxjar-sandbox-pricing.js';
import { createCommerceOrder, type AuthoritativelyPricedOrder } from './order-persistence.js';
import { issueInvoiceForOrder } from './billing-persistence.js';
import { resolveCommerceOrderItems, type ResolvedCommerceOrderItems } from './order-item-resolution.js';
import {
  quoteSubscriptionPlanChange,
} from './subscription-plan-change-quote.js';
import {
  SubscriptionRuntimeError,
  validateIdempotencyKey,
  validatePrincipal,
} from './subscription-runtime.js';

type Env = Readonly<{
  D1_01: D1Database;
  D1_04: D1Database;
  HYPERSWITCH_ENVIRONMENT?: string;
  COMMERCE_PRICING_MODE?: string;
  COMMERCE_DEMO_TAX_PROVIDER?: string;
  TAXJAR_SANDBOX_API_KEY?: string;
  TAXJAR_DEMO_FROM_STREET?: string;
  TAXJAR_DEMO_FROM_CITY?: string;
  TAXJAR_DEMO_FROM_STATE?: string;
  TAXJAR_DEMO_FROM_ZIP?: string;
  TAXJAR_DEMO_TO_STREET?: string;
  TAXJAR_DEMO_TO_CITY?: string;
  TAXJAR_DEMO_TO_STATE?: string;
  TAXJAR_DEMO_TO_ZIP?: string;
}>;

const PERMANENT_IDEMPOTENCY_EXPIRY = '9999-12-31T23:59:59.999Z';

function expectedVersionFromEtag(value: string): number {
  const match = /^"lr-v([1-9]\d*)"$/.exec(value);
  if (!match?.[1]) throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  return version;
}

async function orderIdempotencyKey(
  subscriberId: string,
  subscriptionId: string,
  sourceVersion: number,
): Promise<string> {
  const digest = await sha256BytesToHex(
    new TextEncoder().encode('subscription-plan-change-v1\u0000' + subscriberId + '\u0000' + subscriptionId + '\u0000' + sourceVersion),
  );
  return 'sc_' + digest.slice(0, 60);
}

async function changeRequestId(
  subscriberId: string,
  subscriptionId: string,
  sourceVersion: number,
): Promise<string> {
  const digest = await sha256BytesToHex(
    new TextEncoder().encode('subscription-plan-change-request-v1\u0000' + subscriberId + '\u0000' + subscriptionId + '\u0000' + sourceVersion),
  );
  return 'scr_' + digest.slice(0, 60);
}

async function applyDemoTax(
  env: Env,
  resolved: ResolvedCommerceOrderItems,
): Promise<AuthoritativelyPricedOrder> {
  if (!isDemoPricingEnabled(env.COMMERCE_PRICING_MODE, env.HYPERSWITCH_ENVIRONMENT)) {
    // A live tax/pricing adapter has not yet been admitted. Never substitute
    // zero tax or Demo values for a production checkout.
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (env.COMMERCE_DEMO_TAX_PROVIDER === 'synthetic') {
    return applyDemoTaxPricing(resolved);
  }
  if (env.COMMERCE_DEMO_TAX_PROVIDER === 'taxjar-sandbox') {
    try {
      return await applyTaxJarSandboxPricing(resolved, {
        apiKey: env.TAXJAR_SANDBOX_API_KEY,
        fromAddress: {
          street: env.TAXJAR_DEMO_FROM_STREET ?? '',
          city: env.TAXJAR_DEMO_FROM_CITY ?? '',
          state: env.TAXJAR_DEMO_FROM_STATE ?? '',
          zip: env.TAXJAR_DEMO_FROM_ZIP ?? '',
        },
        toAddress: {
          street: env.TAXJAR_DEMO_TO_STREET ?? '',
          city: env.TAXJAR_DEMO_TO_CITY ?? '',
          state: env.TAXJAR_DEMO_TO_STATE ?? '',
          zip: env.TAXJAR_DEMO_TO_ZIP ?? '',
        },
      });
    } catch {
      throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
  }
  throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
}

/**
 * Re-checks an upgrade order immediately before a customer-present PaymentIntent
 * is created. This is read-only and applies only to the upgrade snapshot shape;
 * ordinary commerce orders continue through their existing payment path.
 */
export async function assertSubscriptionUpgradeOrderPayable(
  env: Readonly<{ D1_01?: D1Database; D1_04: D1Database }>,
  customerIdInput: string,
  orderIdInput: string,
): Promise<void> {
  const customerId = validatePrincipal(customerIdInput);
  if (typeof orderIdInput !== 'string' || orderIdInput.length < 1 ||
      orderIdInput.length > 255 || orderIdInput.trim() !== orderIdInput) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  let order: { order_id: string; customer_id: string; status: string; currency: string; total_minor: number } | null;
  let lines: Array<{
    item_type: string; item_ref: string; item_version: string; quantity: number;
    unit_amount_minor: number; line_total_minor: number; item_snapshot_json: string;
  }>;
  try {
    order = await env.D1_04.prepare(
      'SELECT order_id, customer_id, status, currency, total_minor FROM orders ' +
      'WHERE order_id = ? AND customer_id = ? LIMIT 1',
    ).bind(orderIdInput, customerId).first();
    if (!order) return; // The existing payment-persistence layer returns canonical 404.
    const result = await env.D1_04.prepare(
      'SELECT item_type, item_ref, item_version, quantity, unit_amount_minor, line_total_minor, item_snapshot_json ' +
      'FROM order_lines WHERE order_id = ? ORDER BY order_line_id ASC',
    ).bind(orderIdInput).all();
    lines = result.results ?? [];
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  const membershipLines = lines.filter((line) => line.item_type === 'MEMBERSHIP_PLAN');
  if (membershipLines.length === 0) return;
  if (membershipLines.length !== 1 || lines.length !== 1) {
    throw new SubscriptionRuntimeError('CONFLICT', 409);
  }
  const line = membershipLines[0]!;
  let snapshot: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line.item_snapshot_json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid snapshot');
    snapshot = parsed as Record<string, unknown>;
  } catch {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  if (!Object.hasOwn(snapshot, 'subscriptionChange')) return;
  if (!env.D1_01) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);

  const raw = snapshot.subscriptionChange;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  const change = raw as Record<string, unknown>;
  if (change.changeType !== 'UPGRADE' ||
      typeof change.changeRequestId !== 'string' || !/^scr_[a-f0-9]{60}$/.test(change.changeRequestId) ||
      change.subscriberId !== customerId ||
      !isBoundedId(change.subscriptionId) ||
      !Number.isSafeInteger(change.sourceSubscriptionVersion) ||
      (change.sourceSubscriptionVersion as number) < 1 ||
      typeof change.sourcePlanId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(change.sourcePlanId) ||
      !Number.isSafeInteger(change.sourcePlanVersion) || (change.sourcePlanVersion as number) < 1 ||
      typeof change.targetPlanId !== 'string' || change.targetPlanId !== line.item_ref ||
      !Number.isSafeInteger(change.targetPlanVersion) || (change.targetPlanVersion as number) < 1 ||
      String(change.targetPlanVersion) !== line.item_version ||
      !isCanonicalDate(change.currentPeriodStart) ||
      !isCanonicalDate(change.currentPeriodEnd) ||
      change.currentPeriodEnd <= change.currentPeriodStart ||
      !isSafePositiveMinor(change.amountDueBeforeTaxMinor) ||
      change.amountDueBeforeTaxMinor !== line.unit_amount_minor ||
      line.quantity !== 1 ||
      snapshot.planId !== line.item_ref ||
      snapshot.planVersion !== change.targetPlanVersion ||
      !isBoundedId(snapshot.creatorId) ||
      !isSafePositiveMinor(snapshot.priceMinor) ||
      snapshot.currency !== order.currency ||
      change.currency !== order.currency ||
      !isCanonicalDate(change.effectiveAt) ||
      !isSafePositiveMinor(line.line_total_minor) ||
      order.total_minor !== line.line_total_minor ||
      !/^[A-Z]{3}$/.test(order.currency)) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }
  if (!['CREATED', 'PENDING_PAYMENT'].includes(order.status)) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }

  let subscription: {
    subscriber_id: string; plan_id: string; plan_version: number; creator_id: string | null;
    status: string; current_period_start: string; current_period_end: string; cancel_at: string | null; version: number;
  } | null;
  let receipt: { change_request_id: string } | null;
  try {
    subscription = await env.D1_01.prepare(
      'SELECT subscriber_id, plan_id, plan_version, creator_id, status, current_period_start, ' +
      'current_period_end, cancel_at, version FROM membership_subscriptions WHERE subscription_id = ? LIMIT 1',
    ).bind(change.subscriptionId).first();
    receipt = await env.D1_01.prepare(
      'SELECT change_request_id FROM membership_subscription_plan_change_receipts WHERE change_request_id = ? LIMIT 1',
    ).bind(change.changeRequestId).first();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (receipt) throw new SubscriptionRuntimeError('CONFLICT', 409);
  let targetPlan: {
    owner_id: string; owner_type: string; name: string; tier: string;
    billing_interval: string; price_minor: number; currency: string;
  } | null;
  try {
    targetPlan = await env.D1_01.prepare(
      'SELECT p.owner_id, p.owner_type, v.name, v.tier, v.billing_interval, v.price_minor, v.currency ' +
      'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = ? ' +
      'WHERE p.plan_id = ? LIMIT 1',
    ).bind(change.targetPlanVersion, change.targetPlanId).first();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (!targetPlan || targetPlan.owner_type !== 'CREATOR' ||
      targetPlan.owner_id !== snapshot.creatorId ||
      targetPlan.name !== snapshot.name ||
      targetPlan.tier !== snapshot.tier ||
      targetPlan.billing_interval !== snapshot.billingInterval ||
      targetPlan.price_minor !== snapshot.priceMinor ||
      targetPlan.currency !== snapshot.currency) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
  if (!subscription || !subscription.creator_id || subscription.subscriber_id !== customerId ||
      subscription.creator_id !== targetPlan.owner_id ||
      subscription.status !== 'ACTIVE' || subscription.cancel_at !== null ||
      subscription.version !== change.sourceSubscriptionVersion ||
      subscription.plan_id !== change.sourcePlanId ||
      subscription.plan_version !== change.sourcePlanVersion ||
      subscription.current_period_start !== change.currentPeriodStart ||
      subscription.current_period_end !== change.currentPeriodEnd ||
      Date.parse(change.currentPeriodEnd) <= Date.now()) {
    throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
  }
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function isCanonicalDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isSafePositiveMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
}

/**
 * Creates one immutable Commerce Order for the unused-term upgrade difference.
 *
 * The Order is the durable change intent in existing D1-04; this deliberately
 * does not create a parallel change-request table or cross-D1 transaction.
 * The deterministic order idempotency scope permits only one upgrade order per
 * subscriber/subscription source version. A different target or reused key with
 * changed semantics conflicts rather than creating a second payable order.
 *
 * Only a verified Hyperswitch payment_succeeded webhook can apply the plan
 * change to D1-01. This operation never mutates Subscription or Entitlement.
 */
export async function createSubscriptionPlanUpgradeOrder(
  env: Env,
  subscriberIdInput: string,
  input: Readonly<{
    subscriptionId: string;
    planId: string;
    ifMatch: string;
    idempotencyKey: string;
    actorLayer: string;
  }>,
): Promise<Readonly<{
  changeRequestId: string;
  status: 'PAYMENT_REQUIRED';
  paymentRequired: true;
  order: Awaited<ReturnType<typeof createCommerceOrder>>['data'];
  replayed: boolean;
  quote?: Readonly<Record<string, unknown>>;
  paymentIntentPath: string;
}>> {
  const subscriberId = validatePrincipal(subscriberIdInput);
  const subscriptionId = input.subscriptionId;
  const targetPlanId = input.planId;
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  if (typeof subscriptionId !== 'string' || subscriptionId.length < 1 ||
      subscriptionId.length > 256 || subscriptionId.trim() !== subscriptionId ||
      /[\u0000-\u001f\u007f]/.test(subscriptionId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  if (typeof targetPlanId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(targetPlanId)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  if (!/^L[2-8]$/.test(input.actorLayer)) {
    throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403);
  }
  const sourceVersion = expectedVersionFromEtag(input.ifMatch);
  const orderKey = await orderIdempotencyKey(subscriberId, subscriptionId, sourceVersion);
  const requestId = await changeRequestId(subscriberId, subscriptionId, sourceVersion);
  const orderRequest = { items: [{ itemRef: targetPlanId, quantity: 1 }] };

  let quote: Readonly<Record<string, unknown>> | undefined;
  const result = await createCommerceOrder(
    env.D1_04,
    subscriberId,
    orderKey,
    orderRequest,
    async () => {
      quote = await quoteSubscriptionPlanChange(
        env.D1_01,
        subscriberId,
        subscriptionId,
        { planId: targetPlanId },
        input.ifMatch,
      );
      if (quote.direction !== 'UPGRADE' ||
          quote.paymentRequired !== true ||
          !Number.isSafeInteger(quote.amountDueBeforeTaxMinor) ||
          Number(quote.amountDueBeforeTaxMinor) < 1 ||
          typeof quote.currency !== 'string' ||
          !/^[A-Z]{3}$/.test(quote.currency)) {
        throw new SubscriptionRuntimeError('CONFLICT', 409);
      }

      const resolved = await resolveCommerceOrderItems(env.D1_01, orderRequest);
      const offer = resolved.items[0];
      if (!offer || offer.itemRef !== targetPlanId ||
          offer.itemVersion !== String((quote.targetPlan as Record<string, unknown>).planVersion) ||
          offer.currency !== quote.currency) {
        throw new SubscriptionRuntimeError('PRECONDITION_FAILED', 412);
      }

      const offerSnapshot = JSON.parse(offer.itemSnapshotJson) as Record<string, unknown>;
      const subscriptionChange = {
        changeRequestId: requestId,
        changeType: 'UPGRADE',
        actorLayer: input.actorLayer,
        subscriptionId,
        subscriberId,
        sourceSubscriptionVersion: sourceVersion,
        sourcePlanId: (quote.currentPlan as Record<string, unknown>).planId,
        sourcePlanVersion: (quote.currentPlan as Record<string, unknown>).planVersion,
        targetPlanId,
        targetPlanVersion: (quote.targetPlan as Record<string, unknown>).planVersion,
        currentPeriodStart: quote.currentPeriodStart,
        currentPeriodEnd: quote.currentPeriodEnd,
        amountDueBeforeTaxMinor: quote.amountDueBeforeTaxMinor,
        currency: quote.currency,
        effectiveAt: quote.effectiveAt,
      };
      const adjusted: ResolvedCommerceOrderItems = {
        currency: offer.currency,
        items: [{
          ...offer,
          unitAmountMinor: Number(quote.amountDueBeforeTaxMinor),
          itemSnapshotJson: JSON.stringify({ ...offerSnapshot, subscriptionChange }),
        }],
      };
      return applyDemoTax(env, adjusted);
    },
    {
      idempotencyExpiresAt: PERMANENT_IDEMPOTENCY_EXPIRY,
      idempotencyContext: JSON.stringify({
        operation: 'subscription-plan-upgrade',
        subscriberId,
        subscriptionId,
        sourceVersion,
        targetPlanId,
        clientIdempotencyKey: idempotencyKey,
      }),
    },
  );

  await issueInvoiceForOrder(env.D1_04, subscriberId, result.data.orderId);
  return {
    changeRequestId: requestId,
    status: 'PAYMENT_REQUIRED',
    paymentRequired: true,
    order: result.data,
    replayed: result.replayed,
    ...(quote === undefined ? {} : { quote }),
    paymentIntentPath: '/api/v1/payments/intents',
  };
}
