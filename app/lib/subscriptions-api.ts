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
  version: number;
  etag: string;
  scheduledPlanChange?: {
    changeRequestId: string;
    planId: string;
    planVersion: number;
    effectiveAt: string;
  } | null;
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


export type SubscriptionPlanChangeQuote = {
  quoteStatus: 'PREVIEW_ONLY';
  subscriptionId: string;
  subscriptionVersion: number;
  subscriptionEtag: string;
  currentPlan: {
    planId: string;
    planVersion: number;
    name: string;
    tier: string;
    billingInterval: 'MONTHLY' | 'YEARLY';
    priceMinor: number;
    currency: string;
  };
  targetPlan: {
    planId: string;
    planVersion: number;
    name: string;
    tier: string;
    billingInterval: 'MONTHLY' | 'YEARLY';
    priceMinor: number;
    currency: string;
  };
  direction: 'UPGRADE' | 'DOWNGRADE' | 'CROSSGRADE';
  effectiveAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  remainingPeriodMilliseconds: number;
  totalPeriodMilliseconds: number;
  amountDueBeforeTaxMinor: number;
  currency: string;
  taxStatus: 'NOT_CALCULATED';
  paymentRequired: boolean;
  paymentActionAvailable: false;
  mutationPerformed: false;
  entitlementChanged: false;
  generatedAt: string;
};

/** Read-only server quote; requesting it never mutates subscription or initiates payment. */
export function fetchSubscriptionPlanChangeQuote(options: {
  subscriptionId: string;
  targetPlanId: string;
  etag: string;
  signal?: AbortSignal;
}) {
  const { subscriptionId, targetPlanId, etag } = options;
  if (!subscriptionId || subscriptionId.length > 256 || subscriptionId.trim() !== subscriptionId) {
    throw new RangeError('Subscription identifier is invalid.');
  }
  if (!/^plan_[a-f0-9]{64}$/.test(targetPlanId)) {
    throw new RangeError('Target membership plan identifier is invalid.');
  }
  if (!/^"lr-v[1-9]\d*"$/.test(etag) || etag.length > 256) {
    throw new RangeError('Subscription version tag is invalid.');
  }
  const query = new URLSearchParams({ planId: targetPlanId });
  return apiRequest<SubscriptionPlanChangeQuote>(
    '/memberships/subscriptions/' + encodeURIComponent(subscriptionId) + '/change-plan/quote?' + query.toString(),
    {
      method: 'GET',
      headers: { 'If-Match': etag },
      signal: options.signal,
    },
  );
}

export type SubscriptionPlanUpgradeCheckout = {
  changeRequestId: string;
  status: 'PAYMENT_REQUIRED';
  paymentRequired: true;
  order: {
    orderId: string;
    status: 'CREATED';
    version: number;
    currency: string;
    subtotalMinor: number;
    discountMinor: number;
    taxMinor: number;
    totalMinor: number;
    items: Array<{
      itemRef: string;
      quantity: number;
      unitAmountMinor: number;
      lineSubtotalMinor: number;
      lineDiscountMinor: number;
      lineTaxMinor: number;
      lineTotalMinor: number;
    }>;
    createdAt: string;
    updatedAt: string;
  };
  replayed: boolean;
  paymentIntentPath: '/api/v1/payments/intents';
  quote?: SubscriptionPlanChangeQuote;
};

/** Create/replay the single upgrade order bound to this subscription source version. */
export function createSubscriptionPlanUpgradeCheckout(options: {
  subscriptionId: string;
  targetPlanId: string;
  etag: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const { subscriptionId, targetPlanId, etag, idempotencyKey } = options;
  if (!subscriptionId || subscriptionId.length > 256 || subscriptionId.trim() !== subscriptionId) {
    throw new RangeError('Subscription identifier is invalid.');
  }
  if (!/^plan_[a-f0-9]{64}$/.test(targetPlanId)) {
    throw new RangeError('Target membership plan identifier is invalid.');
  }
  if (!/^"lr-v[1-9]\d*"$/.test(etag) || etag.length > 256) {
    throw new RangeError('Subscription version tag is invalid.');
  }
  if (!idempotencyKey || idempotencyKey.length > 256 || idempotencyKey.trim() !== idempotencyKey ||
      /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
    throw new RangeError('Idempotency-Key is invalid.');
  }
  return apiRequest<SubscriptionPlanUpgradeCheckout>(
    '/memberships/subscriptions/' + encodeURIComponent(subscriptionId) + '/change-plan',
    {
      method: 'POST',
      headers: { 'If-Match': etag, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ planId: targetPlanId }),
      signal: options.signal,
    },
  );
}

export type ScheduledSubscriptionPlanChange = {
  status: 'SCHEDULED';
  changeRequestId: string;
  replayed: boolean;
  subscriptionId: string;
  sourceSubscriptionVersion: number;
  scheduledSubscriptionVersion: number;
  sourcePlan: { planId: string; planVersion: number };
  targetPlan: { planId: string; planVersion: number };
  currentPeriodStart: string;
  currentPeriodEnd: string;
  effectiveAt: string;
  scheduledAt: string;
  mutationPerformed: boolean;
  entitlementChanged: false;
};

/** Schedule a downgrade for the current period end; does not change current access or initiate payment. */
export function scheduleSubscriptionPlanDowngrade(options: {
  subscriptionId: string;
  targetPlanId: string;
  etag: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const { subscriptionId, targetPlanId, etag, idempotencyKey } = options;
  if (!subscriptionId || subscriptionId.length > 256 || subscriptionId.trim() !== subscriptionId) {
    throw new RangeError('Subscription identifier is invalid.');
  }
  if (!/^plan_[a-f0-9]{64}$/.test(targetPlanId)) {
    throw new RangeError('Target membership plan identifier is invalid.');
  }
  if (!/^"lr-v[1-9]\\d*"$/.test(etag) || etag.length > 256) {
    throw new RangeError('Subscription version tag is invalid.');
  }
  if (!idempotencyKey || idempotencyKey.length > 256 || idempotencyKey.trim() !== idempotencyKey ||
      /[\\u0000-\\u001f\\u007f]/.test(idempotencyKey)) {
    throw new RangeError('Idempotency-Key is invalid.');
  }
  return apiRequest<ScheduledSubscriptionPlanChange>(
    '/memberships/subscriptions/' + encodeURIComponent(subscriptionId) + '/change-plan/schedule',
    {
      method: 'POST',
      headers: { 'If-Match': etag, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ planId: targetPlanId }),
      signal: options.signal,
    },
  );
}

/** Start the existing customer-present Hyperswitch checkout for a persisted Order. */
export function createCommercePaymentIntent(options: {
  orderId: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const { orderId, idempotencyKey } = options;
  if (!/^ord_[A-Za-z0-9_-]{1,90}$/.test(orderId)) {
    throw new RangeError('Commerce order identifier is invalid.');
  }
  if (!idempotencyKey || idempotencyKey.length > 256 || idempotencyKey.trim() !== idempotencyKey ||
      /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
    throw new RangeError('Idempotency-Key is invalid.');
  }
  return apiRequest<unknown>('/payments/intents', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ orderId }),
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
