/// <reference types="@cloudflare/workers-types" />

import {
  validateCreateCommerceOrderRequest,
  type CreateCommerceOrderItem,
} from './order-request-validation.js';
import {
  resolvePurchasableMembershipPlanOffers,
  SubscriptionRuntimeError,
} from './subscription-runtime.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';

export type ResolvedCommerceOrderItem = Readonly<{
  itemType: 'MEMBERSHIP_PLAN';
  itemRef: string;
  /** Immutable version is stored as text in the OrderLine contract. */
  itemVersion: string;
  quantity: 1;
  unitAmountMinor: number;
  currency: string;
  /** Bounded immutable offer snapshot; it does not grant access or represent payment. */
  itemSnapshotJson: string;
}>;

export type ResolvedCommerceOrderItems = Readonly<{
  currency: string;
  items: readonly ResolvedCommerceOrderItem[];
}>;

const MEMBERSHIP_PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;
const MAX_ITEM_SNAPSHOT_BYTES = 65_536;

function invalidItemReference(): never {
  // Deliberately hide whether an unsupported reference exists in another domain.
  throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
}

function toPlanIds(items: readonly CreateCommerceOrderItem[]): string[] {
  for (const item of items) {
    if (!MEMBERSHIP_PLAN_ID_PATTERN.test(item.itemRef)) invalidItemReference();
    // Multiple quantity/gifting is not admitted for creator memberships yet.
    if (item.quantity !== 1) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  return items.map((item) => item.itemRef);
}

/**
 * Resolve only the already-implemented membership-plan offer type. Values come
 * from W07's read-only D1-01 query, never from client-supplied price fields.
 * This function performs no writes, provider requests, order creation or
 * entitlement changes; unsupported item families fail closed.
 */
export async function resolveCommerceOrderItems(
  db: W07WebhookPostgresPool,
  input: unknown,
): Promise<ResolvedCommerceOrderItems> {
  const validated = validateCreateCommerceOrderRequest(input);
  if (!validated.ok) {
    throw new SubscriptionRuntimeError(validated.error.code, validated.error.status);
  }
  // Beta paid-membership fulfillment is intentionally a single subscription
  // per Order. Reject multi-plan carts here rather than charging successfully
  // and discovering after the signed webhook that the fulfillment contract
  // cannot atomically authorize every line.
  if (validated.value.items.length !== 1) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  const planIds = toPlanIds(validated.value.items);
  const plans = await resolvePurchasableMembershipPlanOffers(db, planIds);
  const planById = new Map<string, (typeof plans)[number]>();
  for (const plan of plans) planById.set(plan.planId, plan);
  const resolved: ResolvedCommerceOrderItem[] = [];

  for (const item of validated.value.items) {
    const plan = planById.get(item.itemRef);
    if (!plan || plan.status !== 'ACTIVE' || plan.visibility !== 'PUBLIC') {
      throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
    }

    const priceMode = plan.priceMode ?? 'FIXED';
    let unitAmountMinor: number;
    let snapshot: Record<string, unknown>;
    if (priceMode === 'FIXED') {
      if (item.selectedAmountMinor !== undefined ||
          !Number.isSafeInteger(plan.priceMinor) || (plan.priceMinor as number) < 1) {
        throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
      }
      unitAmountMinor = plan.priceMinor as number;
      snapshot = {
        planId: plan.planId,
        planVersion: plan.planVersion,
        creatorId: plan.creatorId,
        name: plan.name,
        tier: plan.tier,
        billingInterval: plan.billingInterval,
        priceMinor: unitAmountMinor,
        priceMode: 'FIXED',
        offerKind: plan.offerKind ?? 'STANDARD',
        foundingCapacity: plan.foundingCapacity ?? null,
        currency: plan.currency,
        benefits: plan.benefits,
      };
    } else if (priceMode === 'FLEXIBLE') {
      const minimum = plan.minimumPriceMinor;
      const suggested = plan.suggestedPriceMinor;
      const maximum = plan.maximumPriceMinor;
      const selected = item.selectedAmountMinor;
      if (
        plan.priceMinor !== null ||
        !Number.isSafeInteger(minimum) || !Number.isSafeInteger(suggested) || !Number.isSafeInteger(maximum) ||
        (minimum as number) < 1 || (suggested as number) < (minimum as number) ||
        (maximum as number) < (suggested as number) || (maximum as number) > 2_147_483_647 ||
        !Number.isSafeInteger(selected) || (selected as number) < (minimum as number) ||
        (selected as number) > (maximum as number)
      ) {
        throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
      }
      unitAmountMinor = selected as number;
      snapshot = {
        planId: plan.planId,
        planVersion: plan.planVersion,
        creatorId: plan.creatorId,
        name: plan.name,
        tier: plan.tier,
        billingInterval: plan.billingInterval,
        priceMode: 'FLEXIBLE',
        minimumPriceMinor: minimum,
        suggestedPriceMinor: suggested,
        maximumPriceMinor: maximum,
        selectedAmountMinor: unitAmountMinor,
        offerKind: plan.offerKind ?? 'STANDARD',
        foundingCapacity: plan.foundingCapacity ?? null,
        currency: plan.currency,
        benefits: plan.benefits,
      };
    } else {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }
    const itemSnapshotJson = JSON.stringify(snapshot);
    if (new TextEncoder().encode(itemSnapshotJson).byteLength > MAX_ITEM_SNAPSHOT_BYTES) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }

    resolved.push({
      itemType: 'MEMBERSHIP_PLAN',
      itemRef: plan.planId,
      itemVersion: String(plan.planVersion),
      quantity: 1,
      unitAmountMinor,
      currency: plan.currency,
      itemSnapshotJson,
    });
  }

  const currency = resolved[0]?.currency;
  if (!currency || resolved.some((item) => item.currency !== currency)) {
    // One Order has one explicit currency; do not silently convert or aggregate
    // different currencies using an implicit exchange rate.
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  return { currency, items: resolved };
}
