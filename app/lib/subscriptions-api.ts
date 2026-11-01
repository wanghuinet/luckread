import { apiRequest } from './api-client';

export type SubscriptionStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'PAUSED'
  | 'CANCELED'
  | 'EXPIRED';

export type MySubscription = {
  subscriptionId: string;
  subscriberId: string;
  planId: string;
  planVersion: number;
  creatorId: string | null;
  status: SubscriptionStatus;
  startedAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAt: string | null;
  updatedAt: string;
  etag: string;
};

export type MySubscriptionPage = {
  docs: MySubscription[];
  limit: number;
  page: number;
  hasNextPage: boolean;
};

type PageOptions = {
  page?: number;
  limit?: number;
  signal?: AbortSignal;
};

/** Read only the signed-in user's subscription records from W01 -> W07. */
export function fetchMySubscriptionsPage(options: PageOptions = {}) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
    throw new RangeError('Subscription page must be between 1 and 10000.');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('Subscription page size must be between 1 and 50.');
  }

  const query = new URLSearchParams({ limit: String(limit), page: String(page) });
  return apiRequest<unknown>('/memberships/subscriptions?' + query.toString(), {
    method: 'GET',
    signal: options.signal,
  });
}


export type ActiveMembershipPlan = {
  planId: string;
  creatorId: string;
  planVersion: number;
  name: string;
  tier: string;
  billingInterval: 'MONTHLY' | 'YEARLY';
  priceMinor: number;
  currency: string;
  benefits: string[];
  createdAt: string;
  updatedAt: string;
};

export type ActiveMembershipPlanPage = {
  docs: ActiveMembershipPlan[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
};

type PlanPageOptions = {
  limit?: number;
  cursor?: string | null;
  signal?: AbortSignal;
};

/** Read only active/public plans from W01 -> W07; the client never supplies price or owner data. */
export function fetchActiveMembershipPlansPage(options: PlanPageOptions = {}) {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('Membership plan page size must be between 1 and 50.');
  }
  const cursor = options.cursor ?? null;
  if (cursor !== null && (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 2048)) {
    throw new RangeError('Membership plan cursor must be between 1 and 2048 characters.');
  }

  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return apiRequest<unknown>('/plans?' + query.toString(), {
    method: 'GET',
    signal: options.signal,
  });
}

export type SavedPaymentMethodStatus = 'ACTIVE' | 'SETUP_PENDING' | 'NO_RECURRING' | 'REVOCATION_PENDING';
export type SavedPaymentMethodMandateStatus =
  | 'ACTIVE'
  | 'PENDING_PROVIDER_CONFIRMATION'
  | 'REVOKED'
  | 'FAILED'
  | 'EXPIRED'
  | 'NONE';

export type SavedPaymentMethod = {
  savedPaymentMethodId: string;
  paymentMethod: string;
  paymentMethodType: string | null;
  brand: string | null;
  last4: string | null;
  expiryMonth: string | null;
  expiryYear: string | null;
  createdAt: string;
  recurringEnabled: boolean;
  mandateStatus: SavedPaymentMethodMandateStatus;
  status: SavedPaymentMethodStatus;
};

/** Read only verified saved methods owned by the current W02 principal. */
export function fetchSavedPaymentMethods(options: { signal?: AbortSignal } = {}) {
  return apiRequest<unknown>('/payment-methods', {
    method: 'GET',
    signal: options.signal,
  });
}

/** Revoke provider mandates and remove a saved vault method; 202 means provider webhook confirmation is pending. */
export function revokeSavedPaymentMethod(
  savedPaymentMethodId: string,
  idempotencyKey: string = 'remove_' + savedPaymentMethodId,
) {
  if (!/^spm_[A-Za-z0-9]{26}$/.test(savedPaymentMethodId)) {
    throw new TypeError('Saved payment method ID is invalid.');
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
    throw new TypeError('Payment method removal idempotency key is invalid.');
  }
  return apiRequest<unknown>('/payment-methods/' + encodeURIComponent(savedPaymentMethodId), {
    method: 'DELETE',
    idempotencyKey,
  });
}

/** Create a customer-owned order for one immutable membership plan version. Price and tax remain server-resolved. */
export function createMembershipOrder(planId: string) {
  if (typeof planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(planId)) {
    throw new TypeError('A valid published membership plan ID is required.');
  }
  return apiRequest<unknown>('/commerce/orders', {
    method: 'POST',
    body: JSON.stringify({ items: [{ itemRef: planId, quantity: 1 }] }),
  });
}

/** Create an unconfirmed Hyperswitch intent for an existing customer-owned order. */
export function createMembershipPaymentIntent(orderId: string) {
  if (typeof orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(orderId)) {
    throw new TypeError('A valid membership order ID is required.');
  }
  return apiRequest<unknown>('/payments/intents', {
    method: 'POST',
    body: JSON.stringify({ orderId }),
  });
}


export type SubscriptionPlanSnapshot = {
  planId: string;
  planVersion: number;
  name: string;
  tier: string;
  billingInterval: 'MONTHLY' | 'YEARLY';
  priceMinor: number;
  currency: string;
};

export type SubscriptionPlanChangeType =
  | 'NO_CHANGE'
  | 'UPGRADE'
  | 'DOWNGRADE'
  | 'BILLING_INTERVAL_CHANGE'
  | 'SAME_PRICE_CHANGE';

export type SubscriptionPlanChangePreview = {
  subscriptionId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  currentPlan: SubscriptionPlanSnapshot;
  targetPlan: SubscriptionPlanSnapshot;
  changeType: SubscriptionPlanChangeType;
  effectiveAt: string;
  prorationBaseMinor: number;
  currency: string;
  paymentRequired: boolean;
  prorationBasis: 'LIST_PRICE_DIFFERENCE_BEFORE_DISCOUNTS_AND_TAX';
  pricingFinalized: false;
  remainingPeriodMs: number;
  periodDurationMs: number;
  computedAt: string;
  etag: string;
};

export type SubscriptionPlanUpgradeCheckout = {
  attemptId: string;
  subscriptionId: string;
  status: 'PENDING_PAYMENT' | 'APPLIED';
  order: {
    orderId: string;
    status: string;
    totalMinor: number;
    currency: string;
  };
  proration: {
    amountMinor: number;
    currency: string;
    basis: 'LIST_PRICE_DIFFERENCE_BEFORE_DISCOUNTS_AND_TAX';
    pricingFinalized: true;
  };
  effectiveAt: string | null;
  expiresAt: string;
  replayed: boolean;
};

export type ScheduledSubscriptionPlanChange = {
  changeId: string;
  subscriptionId: string;
  status: 'SCHEDULED' | 'APPLIED';
  changeType: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE';
  currentPlanId: string;
  targetPlanId: string;
  targetPlanVersion: number;
  effectiveAt: string;
  replayed: boolean;
};

const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9_-]{1,128}$/;
const PLAN_ID_PATTERN = /^plan_[a-f0-9]{64}$/;
const SUBSCRIPTION_ETAG_PATTERN = /^"lr-v([1-9]\\d*)"$/;
const SUBSCRIPTION_IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function validateSubscriptionId(subscriptionId: string): string {
  if (typeof subscriptionId !== 'string' || !SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) {
    throw new TypeError('A valid subscription ID is required.');
  }
  return subscriptionId;
}

function validatePlanChangeInput(planId: string, etag: string, idempotencyKey: string): void {
  if (typeof planId !== 'string' || !PLAN_ID_PATTERN.test(planId)) {
    throw new TypeError('A valid published membership plan ID is required.');
  }
  if (typeof etag !== 'string' || !SUBSCRIPTION_ETAG_PATTERN.test(etag)) {
    throw new TypeError('A current subscription ETag is required.');
  }
  if (typeof idempotencyKey !== 'string' || !SUBSCRIPTION_IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
    throw new TypeError('A valid subscription change idempotency key is required.');
  }
}

/** Read one subscriber-owned subscription through W01 -> W07. */
export function fetchMySubscription(subscriptionId: string, options: { signal?: AbortSignal } = {}) {
  const id = validateSubscriptionId(subscriptionId);
  return apiRequest<unknown>('/memberships/subscriptions/' + encodeURIComponent(id), {
    method: 'GET',
    signal: options.signal,
  });
}

/** Read-only server quote; no order, payment, subscription write, or entitlement is created. */
export function fetchSubscriptionPlanChangePreview(
  subscriptionId: string,
  targetPlanId: string,
  options: { signal?: AbortSignal } = {},
) {
  const id = validateSubscriptionId(subscriptionId);
  if (typeof targetPlanId !== 'string' || !PLAN_ID_PATTERN.test(targetPlanId)) {
    throw new TypeError('A valid published membership plan ID is required.');
  }
  const query = new URLSearchParams({ targetPlanId });
  return apiRequest<unknown>(
    '/memberships/subscriptions/' + encodeURIComponent(id) + '/change-plan-preview?' + query.toString(),
    { method: 'GET', signal: options.signal },
  );
}

/** Start the existing W07 upgrade reservation and server-priced checkout, guarded by ETag and idempotency. */
export function createSubscriptionPlanUpgradeCheckout(
  subscriptionId: string,
  planId: string,
  etag: string,
  idempotencyKey: string,
) {
  const id = validateSubscriptionId(subscriptionId);
  validatePlanChangeInput(planId, etag, idempotencyKey);
  return apiRequest<unknown>(
    '/memberships/subscriptions/' + encodeURIComponent(id) + '/change-plan/checkout',
    {
      method: 'POST',
      headers: { 'If-Match': etag },
      idempotencyKey,
      body: JSON.stringify({ planId }),
    },
  );
}

/** Schedule a same-interval downgrade at the authoritative current-period boundary. */
export function scheduleSubscriptionPlanDowngrade(
  subscriptionId: string,
  planId: string,
  etag: string,
  idempotencyKey: string,
) {
  const id = validateSubscriptionId(subscriptionId);
  validatePlanChangeInput(planId, etag, idempotencyKey);
  return apiRequest<unknown>(
    '/memberships/subscriptions/' + encodeURIComponent(id) + '/change-plan/schedule',
    {
      method: 'POST',
      headers: { 'If-Match': etag },
      idempotencyKey,
      body: JSON.stringify({ planId }),
    },
  );
}

/** Schedule a monthly/yearly interval switch at the current-period boundary. */
export function scheduleSubscriptionBillingIntervalChange(
  subscriptionId: string,
  planId: string,
  etag: string,
  idempotencyKey: string,
) {
  const id = validateSubscriptionId(subscriptionId);
  validatePlanChangeInput(planId, etag, idempotencyKey);
  return apiRequest<unknown>(
    '/memberships/subscriptions/' + encodeURIComponent(id) + '/change-plan/interval-schedule',
    {
      method: 'POST',
      headers: { 'If-Match': etag },
      idempotencyKey,
      body: JSON.stringify({ planId }),
    },
  );
}
