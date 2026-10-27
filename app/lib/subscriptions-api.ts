import { apiRequest, createIdempotencyKey } from './api-client';

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

export type SubscriptionTransition = 'cancel' | 'pause' | 'resume';

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

/**
 * Change the current subscriber-owned record through W01 -> W07.
 * W07 validates ownership, lifecycle state, If-Match, and idempotency.
 */
export function transitionMySubscription(
  subscription: Pick<MySubscription, 'subscriptionId' | 'etag'>,
  operation: SubscriptionTransition,
) {
  const subscriptionId = subscription.subscriptionId.trim();
  const etag = subscription.etag.trim();
  if (!subscriptionId || subscriptionId.length > 256) {
    throw new TypeError('A valid subscription ID is required.');
  }
  if (!etag || etag.length > 256 || etag === '*') {
    throw new TypeError('A current subscription version is required.');
  }
  if (!(['cancel', 'pause', 'resume'] as const).includes(operation)) {
    throw new TypeError('Unsupported subscription transition.');
  }

  return apiRequest<unknown>(
    '/memberships/subscriptions/' + encodeURIComponent(subscriptionId) + '/' + operation,
    {
      method: 'POST',
      // W01's current command adapter requires a JSON object for POST transitions.
      body: JSON.stringify({}),
      headers: { 'If-Match': etag },
      idempotencyKey: createIdempotencyKey(),
    },
  );
}
