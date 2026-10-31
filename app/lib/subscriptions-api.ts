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
