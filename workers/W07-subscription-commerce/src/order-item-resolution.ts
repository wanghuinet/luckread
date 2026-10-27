import {
  validateCreateCommerceOrderRequest,
  type CreateCommerceOrderItem,
} from './order-request-validation.js';
import {
  resolvePurchasableMembershipPlanOffers,
  SubscriptionRuntimeError,
} from './subscription-runtime.js';

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
  db: D1Database,
  input: unknown,
): Promise<ResolvedCommerceOrderItems> {
  const validated = validateCreateCommerceOrderRequest(input);
  if (!validated.ok) {
    throw new SubscriptionRuntimeError(validated.error.code, validated.error.status);
  }

  const planIds = toPlanIds(validated.value.items);
  const plans = await resolvePurchasableMembershipPlanOffers(db, planIds);
  const planById = new Map(plans.map((plan) => [plan.planId, plan]));
  const resolved: ResolvedCommerceOrderItem[] = [];

  for (const item of validated.value.items) {
    const plan = planById.get(item.itemRef);
    if (!plan || plan.status !== 'ACTIVE' || plan.visibility !== 'PUBLIC') {
      throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
    }

    const snapshot = {
      planId: plan.planId,
      planVersion: plan.planVersion,
      creatorId: plan.creatorId,
      name: plan.name,
      tier: plan.tier,
      billingInterval: plan.billingInterval,
      priceMinor: plan.priceMinor,
      currency: plan.currency,
      benefits: plan.benefits,
    };
    const itemSnapshotJson = JSON.stringify(snapshot);
    if (new TextEncoder().encode(itemSnapshotJson).byteLength > MAX_ITEM_SNAPSHOT_BYTES) {
      throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
    }

    resolved.push({
      itemType: 'MEMBERSHIP_PLAN',
      itemRef: plan.planId,
      itemVersion: String(plan.planVersion),
      quantity: 1,
      unitAmountMinor: plan.priceMinor,
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
