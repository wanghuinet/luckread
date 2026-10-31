import { apiRequest } from './api-client';

export type SubscriptionStatus =
  | 'PENDING'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'PAUSED'
  | 'CANCELED'
  | 'EXPIRED';

export type MembershipTrialSummary = {
  source: 'WEB' | 'APP_STORE' | 'PLAY_STORE';
  status: 'TRIALING' | 'CANCELED' | 'PAYMENT_FAILED' | 'CONVERTED' | 'EXPIRED';
  trialEndsAt: string;
};

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
  trial: MembershipTrialSummary | null;
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
  trialDays: number;
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


/** Start a WEB trial only when W07 confirms an existing active MIT mandate. */
export function startWebMembershipTrial(planId: string) {
  if (typeof planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(planId)) {
    throw new RangeError('A canonical membership plan ID is required.');
  }
  return apiRequest<unknown>('/memberships/subscriptions/trial', {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

/** Cancel only a WEB trial conversion; the current trial access remains until its end. */
export function cancelWebMembershipTrial(subscriptionId: string, etag: string) {
  if (typeof subscriptionId !== 'string' || !/^sub_[a-f0-9]{64}$/.test(subscriptionId)) {
    throw new RangeError('A canonical subscription ID is required.');
  }
  if (typeof etag !== 'string' || !/^"lr-v([1-9]\\d*)"$/.test(etag)) {
    throw new RangeError('A valid subscription version is required.');
  }
  return apiRequest<unknown>('/memberships/subscriptions/' + encodeURIComponent(subscriptionId) + '/cancel-trial', {
    method: 'POST',
    headers: { 'If-Match': etag },
  });
}
