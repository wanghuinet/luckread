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
