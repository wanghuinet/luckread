import {
  assertRevenueCatSubscriberIdentity,
  type RevenueCatSubscriberIdentityMatch,
} from './revenuecat-subscriber-identity.js';
import type {
  RevenueCatSubscriberEntitlement,
  RevenueCatSubscriberSnapshot,
  RevenueCatSubscriberSubscription,
} from './revenuecat-subscriber-api.js';
import {
  resolveRevenueCatMembershipProduct,
  type RevenueCatMembershipProductBinding,
  type RevenueCatStore,
} from './membership-store-product-binding.js';
import { SubscriptionRuntimeError } from './subscription-runtime.js';

export type RevenueCatMembershipCurrentState = 'TRIALING' | 'ACTIVE' | 'EXPIRED' | 'REFUNDED';

export type RevenueCatMembershipCurrentStateCandidate = Readonly<
  RevenueCatMembershipProductBinding & {
    revenueCatAppId: string;
    store: RevenueCatStore;
    productId: string;
    entitlementIds: readonly string[];
    currentState: RevenueCatMembershipCurrentState;
    purchaseDate: string;
    effectiveExpiresAt: string | null;
    gracePeriodExpiresAt: string | null;
    storeTransactionId: string | number | null;
    isSandbox: boolean | null;
    refundedAt: string | null;
    unsubscribeDetectedAt: string | null;
    billingIssuesDetectedAt: string | null;
    autoResumeDate: string | null;
    periodType: string | null;
    originalTransactionId: string | null;
  }
>;

export type RevenueCatSubscriberReconciliationResult = Readonly<{
  appUserId: string;
  originalAppUserId: string | null;
  identityMatch: RevenueCatSubscriberIdentityMatch['matchedBy'];
  snapshotRequestDateMs: number;
  customerCreatedOnLookup: boolean;
  candidates: readonly RevenueCatMembershipCurrentStateCandidate[];
}>;

export type RevenueCatSubscriberReconciliationErrorCode =
  | 'INVALID_RECONCILIATION_INPUT'
  | 'INVALID_SNAPSHOT'
  | 'SNAPSHOT_VERSION_MISSING'
  | 'UNSUPPORTED_STORE'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'PRODUCT_MAPPING_UNAVAILABLE';

export class RevenueCatSubscriberReconciliationError extends Error {
  constructor(readonly code: RevenueCatSubscriberReconciliationErrorCode) {
    super(code);
    this.name = 'RevenueCatSubscriberReconciliationError';
  }
}

type EntitlementEntry = Readonly<{
  entitlementId: string;
  entitlement: RevenueCatSubscriberEntitlement;
}>;

type ProductGroup = {
  productId: string;
  store: RevenueCatStore;
  subscription: RevenueCatSubscriberSubscription;
  entitlementEntries: EntitlementEntry[];
};

const MAX_APP_ID_LENGTH = 128;
const MAX_PROVIDER_ID_LENGTH = 255;

function isBoundedCanonicalText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isValidDateOrNull(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' &&
    value.length <= 64 &&
    value.trim() === value &&
    Number.isFinite(Date.parse(value))
  );
}

function requireStore(value: unknown): RevenueCatStore {
  if (value === 'APP_STORE' || value === 'app_store') return 'APP_STORE';
  if (value === 'PLAY_STORE' || value === 'play_store') return 'PLAY_STORE';
  throw new RevenueCatSubscriberReconciliationError('UNSUPPORTED_STORE');
}

function laterDate(values: readonly (string | null)[]): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value === null) continue;
    const valueMs = Date.parse(value);
    if (valueMs > latestMs) {
      latest = value;
      latestMs = valueMs;
    }
  }
  return latest;
}

function buildCurrentState(
  entries: readonly EntitlementEntry[],
  subscription: RevenueCatSubscriberSubscription,
  nowMs: number,
): {
  currentState: RevenueCatMembershipCurrentState;
  effectiveExpiresAt: string | null;
  gracePeriodExpiresAt: string | null;
} {
  const hasNonExpiringEntitlement = entries.some(({ entitlement }) => entitlement.expires_date === null);
  const latestExpiry = laterDate(entries.map(({ entitlement }) => entitlement.expires_date));
  const gracePeriodExpiresAt = laterDate(entries.map(({ entitlement }) =>
    entitlement.grace_period_expires_date !== undefined
      ? entitlement.grace_period_expires_date
      : subscription.grace_period_expires_date ?? null,
  ));
  const effectiveExpiresAt = hasNonExpiringEntitlement
    ? null
    : laterDate([latestExpiry, gracePeriodExpiresAt]);

  // RevenueCat's current entitlement snapshot is the access authority. A
  // cancellation/refund metadata field must not override another still-active
  // entitlement or a restored purchase visible in that same snapshot.
  const active = effectiveExpiresAt === null || Date.parse(effectiveExpiresAt) > nowMs;
  const refundedAt = subscription.refunded_at ?? null;
  return {
    currentState: active
      ? subscription.period_type === 'TRIAL' ? 'TRIALING' : 'ACTIVE'
      : refundedAt !== null && Date.parse(refundedAt) <= nowMs
        ? 'REFUNDED'
        : 'EXPIRED',
    effectiveExpiresAt,
    gracePeriodExpiresAt,
  };
}

function validateSnapshot(snapshot: RevenueCatSubscriberSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object' ||
      !snapshot.entitlements || typeof snapshot.entitlements !== 'object' || Array.isArray(snapshot.entitlements) ||
      !snapshot.subscriptions || typeof snapshot.subscriptions !== 'object' || Array.isArray(snapshot.subscriptions) ||
      typeof snapshot.customerCreatedOnLookup !== 'boolean') {
    throw new RevenueCatSubscriberReconciliationError('INVALID_SNAPSHOT');
  }

  if (Object.keys(snapshot.entitlements).length > 256 || Object.keys(snapshot.subscriptions).length > 256) {
    throw new RevenueCatSubscriberReconciliationError('INVALID_SNAPSHOT');
  }

  for (const [entitlementId, entitlement] of Object.entries(snapshot.entitlements)) {
    if (!isBoundedCanonicalText(entitlementId, MAX_PROVIDER_ID_LENGTH) ||
        !entitlement || typeof entitlement !== 'object' ||
        !isBoundedCanonicalText(entitlement.product_identifier, MAX_PROVIDER_ID_LENGTH) ||
        !isValidDateOrNull(entitlement.expires_date) ||
        !isBoundedCanonicalText(entitlement.purchase_date, 64) ||
        !Number.isFinite(Date.parse(entitlement.purchase_date)) ||
        (entitlement.grace_period_expires_date !== undefined &&
          !isValidDateOrNull(entitlement.grace_period_expires_date))) {
      throw new RevenueCatSubscriberReconciliationError('INVALID_SNAPSHOT');
    }
  }

  for (const [productId, subscription] of Object.entries(snapshot.subscriptions)) {
    if (!isBoundedCanonicalText(productId, MAX_PROVIDER_ID_LENGTH) ||
        !subscription || typeof subscription !== 'object' ||
        !isBoundedCanonicalText(subscription.purchase_date, 64) ||
        !Number.isFinite(Date.parse(subscription.purchase_date)) ||
        !isValidDateOrNull(subscription.expires_date) ||
        (subscription.grace_period_expires_date !== undefined &&
          !isValidDateOrNull(subscription.grace_period_expires_date)) ||
        (subscription.refunded_at !== undefined && !isValidDateOrNull(subscription.refunded_at)) ||
        (subscription.unsubscribe_detected_at !== undefined &&
          !isValidDateOrNull(subscription.unsubscribe_detected_at)) ||
        (subscription.billing_issues_detected_at !== undefined &&
          !isValidDateOrNull(subscription.billing_issues_detected_at)) ||
        (subscription.auto_resume_date !== undefined && !isValidDateOrNull(subscription.auto_resume_date)) ||
        (subscription.store_transaction_id !== undefined &&
          subscription.store_transaction_id !== null &&
          typeof subscription.store_transaction_id !== 'string' &&
          (typeof subscription.store_transaction_id !== 'number' ||
            !Number.isSafeInteger(subscription.store_transaction_id) ||
            subscription.store_transaction_id < 0)) ||
        (typeof subscription.store_transaction_id === 'string' &&
          subscription.store_transaction_id.length > MAX_PROVIDER_ID_LENGTH) ||
        (subscription.is_sandbox !== undefined && typeof subscription.is_sandbox !== 'boolean') ||
        (subscription.period_type !== undefined && !isBoundedCanonicalText(subscription.period_type, 128)) ||
        (subscription.original_transaction_id !== undefined && subscription.original_transaction_id !== null &&
          !isBoundedCanonicalText(subscription.original_transaction_id, MAX_PROVIDER_ID_LENGTH))) {
      throw new RevenueCatSubscriberReconciliationError('INVALID_SNAPSHOT');
    }
  }
}

/**
 * Builds read-only LuckRead plan candidates from a current RevenueCat snapshot.
 *
 * The caller MUST supply expectedAppUserId from the authenticated W02 principal.
 * Webhook IDs, aliases, and client-supplied identifiers are never identity
 * authorities. This function does not create or update payments, subscriptions,
 * orders, or entitlements. Every product must resolve to an existing store
 * binding; otherwise the entire reconciliation candidate build fails closed.
 */
export async function buildRevenueCatSubscriberReconciliationCandidates(
  db: D1Database,
  input: Readonly<{
    snapshot: RevenueCatSubscriberSnapshot;
    expectedAppUserId: string;
    revenueCatAppId: string;
  }>,
  dependencies: Readonly<{ nowMs?: () => number }> = {},
): Promise<RevenueCatSubscriberReconciliationResult> {
  if (!isBoundedCanonicalText(input.revenueCatAppId, MAX_APP_ID_LENGTH)) {
    throw new RevenueCatSubscriberReconciliationError('INVALID_RECONCILIATION_INPUT');
  }

  const identity = assertRevenueCatSubscriberIdentity(input.snapshot, input.expectedAppUserId);
  validateSnapshot(input.snapshot);

  const snapshotRequestDateMs = input.snapshot.requestDateMs;
  if (typeof snapshotRequestDateMs !== 'number' ||
      !Number.isSafeInteger(snapshotRequestDateMs) ||
      snapshotRequestDateMs < 1 ||
      !Number.isFinite(new Date(snapshotRequestDateMs).getTime())) {
    throw new RevenueCatSubscriberReconciliationError('SNAPSHOT_VERSION_MISSING');
  }

  const nowMs = dependencies.nowMs?.() ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isFinite(new Date(nowMs).getTime())) {
    throw new RevenueCatSubscriberReconciliationError('INVALID_RECONCILIATION_INPUT');
  }

  if (input.snapshot.customerCreatedOnLookup) {
    if (Object.keys(input.snapshot.entitlements).length !== 0 ||
        Object.keys(input.snapshot.subscriptions).length !== 0) {
      throw new RevenueCatSubscriberReconciliationError('INVALID_SNAPSHOT');
    }
    return {
      appUserId: identity.appUserId,
      originalAppUserId: identity.originalAppUserId,
      identityMatch: identity.matchedBy,
      snapshotRequestDateMs,
      customerCreatedOnLookup: true,
      candidates: [],
    };
  }

  const groups = new Map<string, ProductGroup>();
  for (const [entitlementId, entitlement] of Object.entries(input.snapshot.entitlements)) {
    const productId = entitlement.product_identifier;
    const subscription = Object.hasOwn(input.snapshot.subscriptions, productId)
      ? input.snapshot.subscriptions[productId]
      : undefined;
    if (!subscription) {
      throw new RevenueCatSubscriberReconciliationError('SUBSCRIPTION_NOT_FOUND');
    }

    const store = requireStore(subscription.store);
    const group = groups.get(productId);
    if (group) {
      if (group.store !== store || group.subscription !== subscription) {
        throw new RevenueCatSubscriberReconciliationError('INVALID_SNAPSHOT');
      }
      group.entitlementEntries.push({ entitlementId, entitlement });
    } else {
      groups.set(productId, {
        productId,
        store,
        subscription,
        entitlementEntries: [{ entitlementId, entitlement }],
      });
    }
  }

  const candidates: RevenueCatMembershipCurrentStateCandidate[] = [];
  for (const group of groups.values()) {
    let binding: RevenueCatMembershipProductBinding;
    try {
      binding = await resolveRevenueCatMembershipProduct(db, {
        revenueCatAppId: input.revenueCatAppId,
        store: group.store,
        productId: group.productId,
        purpose: 'EXISTING_TRANSACTION',
      });
    } catch (error) {
      if (error instanceof SubscriptionRuntimeError && error.code === 'RESOURCE_NOT_FOUND') {
        throw new RevenueCatSubscriberReconciliationError('PRODUCT_MAPPING_UNAVAILABLE');
      }
      throw error;
    }

    const state = buildCurrentState(group.entitlementEntries, group.subscription, nowMs);
    candidates.push({
      ...binding,
      revenueCatAppId: input.revenueCatAppId,
      store: group.store,
      productId: group.productId,
      entitlementIds: group.entitlementEntries
        .map((entry) => entry.entitlementId)
        .sort((left, right) => left.localeCompare(right)),
      currentState: state.currentState,
      purchaseDate: group.subscription.purchase_date,
      effectiveExpiresAt: state.effectiveExpiresAt,
      gracePeriodExpiresAt: state.gracePeriodExpiresAt,
      storeTransactionId: group.subscription.store_transaction_id ?? null,
      isSandbox: group.subscription.is_sandbox ?? null,
      refundedAt: group.subscription.refunded_at ?? null,
      unsubscribeDetectedAt: group.subscription.unsubscribe_detected_at ?? null,
      billingIssuesDetectedAt: group.subscription.billing_issues_detected_at ?? null,
      autoResumeDate: group.subscription.auto_resume_date ?? null,
      periodType: group.subscription.period_type ?? null,
      originalTransactionId: group.subscription.original_transaction_id ?? null,
    });
  }

  candidates.sort((left, right) =>
    left.creatorId.localeCompare(right.creatorId) ||
    left.planId.localeCompare(right.planId) ||
    left.productId.localeCompare(right.productId),
  );

  return {
    appUserId: identity.appUserId,
    originalAppUserId: identity.originalAppUserId,
    identityMatch: identity.matchedBy,
    snapshotRequestDateMs,
    customerCreatedOnLookup: false,
    candidates,
  };
}
