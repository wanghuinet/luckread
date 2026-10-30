import { SubscriptionRuntimeError } from './subscription-runtime.js';

export type RevenueCatStore = 'APP_STORE' | 'PLAY_STORE';
export type RevenueCatStoreInput = RevenueCatStore | 'app_store' | 'play_store';
export type RevenueCatBindingPurpose = 'NEW_PURCHASE' | 'EXISTING_TRANSACTION';

export type RevenueCatMembershipProductBinding = {
  planId: string;
  planVersion: number;
  creatorId: string;
  billingInterval: 'MONTHLY' | 'YEARLY';
};

type RevenueCatMembershipProductBindingRow = {
  plan_id: string;
  plan_version: number;
  creator_id: string;
  billing_interval: string;
};

const normalizeRevenueCatStore = (value: unknown): RevenueCatStore => {
  // RevenueCat Webhooks use APP_STORE / PLAY_STORE, while its Subscriber API
  // serializes the same stores as app_store / play_store. Normalize only those
  // exact documented forms; promotional, Stripe and unknown stores fail closed.
  if (value === 'APP_STORE' || value === 'app_store') return 'APP_STORE';
  if (value === 'PLAY_STORE' || value === 'play_store') return 'PLAY_STORE';
  throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
};

const MAX_APP_ID_LENGTH = 128;
const MAX_PRODUCT_ID_LENGTH = 255;

const requireCanonicalIdentifier = (value: unknown, maxLength: number): string => {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maxLength ||
    value !== value.trim()
  ) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  return value;
};

/**
 * Resolves RevenueCat's exact product identity to the immutable LuckRead
 * membership-plan version. Google Play base-plan suffixes and App Store
 * commitment suffixes remain part of productId; this function never parses
 * or rewrites provider identifiers.
 *
 * NEW_PURCHASE accepts only a sellable binding to the current public version.
 * EXISTING_TRANSACTION also resolves retired bindings so renewals, refunds and
 * historical events continue to reference the original plan version.
 *
 * The result is internal W07 data only. It does not create a payment,
 * subscription, entitlement or financial fact.
 */
export async function resolveRevenueCatMembershipProduct(
  db: D1Database,
  input: {
    revenueCatAppId: string;
    store: RevenueCatStoreInput;
    productId: string;
    purpose: RevenueCatBindingPurpose;
  },
): Promise<RevenueCatMembershipProductBinding> {
  const appId = requireCanonicalIdentifier(input.revenueCatAppId, MAX_APP_ID_LENGTH);
  const productId = requireCanonicalIdentifier(input.productId, MAX_PRODUCT_ID_LENGTH);
  const store = normalizeRevenueCatStore(input.store);
  if (input.purpose !== 'NEW_PURCHASE' && input.purpose !== 'EXISTING_TRANSACTION') {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }

  const sellableOnly = input.purpose === 'NEW_PURCHASE'
    ? "AND b.status = 'ACTIVE' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC' AND p.current_version = b.plan_version "
    : "AND b.status IN ('ACTIVE', 'RETIRED') ";

  let row: RevenueCatMembershipProductBindingRow | null;
  try {
    row = await db.prepare(
      'SELECT b.plan_id, b.plan_version, p.owner_id AS creator_id, v.billing_interval ' +
      'FROM membership_revenuecat_product_bindings AS b ' +
      'INNER JOIN membership_plans AS p ON p.plan_id = b.plan_id ' +
      'INNER JOIN membership_plan_versions AS v ON v.plan_id = b.plan_id AND v.plan_version = b.plan_version ' +
      "WHERE b.revenuecat_app_id = ? AND b.store = ? AND b.product_id = ? AND p.owner_type = 'CREATOR' " +
      sellableOnly +
      'LIMIT 1',
    ).bind(appId, store, productId).first<RevenueCatMembershipProductBindingRow>();
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  if (!row) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  if (
    typeof row.plan_id !== 'string' || row.plan_id.length < 1 || row.plan_id.length > 256 ||
    typeof row.creator_id !== 'string' || row.creator_id.length < 1 || row.creator_id.length > 256 ||
    !Number.isSafeInteger(row.plan_version) || row.plan_version < 1 ||
    (row.billing_interval !== 'MONTHLY' && row.billing_interval !== 'YEARLY')
  ) {
    throw new SubscriptionRuntimeError('INTEGRITY_VIOLATION', 500);
  }

  return {
    planId: row.plan_id,
    planVersion: row.plan_version,
    creatorId: row.creator_id,
    billingInterval: row.billing_interval,
  };
}
