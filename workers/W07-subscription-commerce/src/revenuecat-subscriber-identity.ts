import type { RevenueCatSubscriberSnapshot } from './revenuecat-subscriber-api.js';

export type RevenueCatSubscriberIdentityMatch = Readonly<{
  /** W02-authenticated LuckRead principal used for the server-side lookup. */
  appUserId: string;
  originalAppUserId: string | null;
  matchedBy: 'ORIGINAL_APP_USER_ID' | 'ALIAS';
  /** A 201 get-or-create response identifies an empty customer, not a purchase. */
  customerCreatedOnLookup: boolean;
}>;

export type RevenueCatSubscriberIdentityErrorCode =
  | 'INVALID_PRINCIPAL_ID'
  | 'INVALID_SNAPSHOT'
  | 'SNAPSHOT_QUERY_MISMATCH'
  | 'CUSTOMER_IDENTITY_UNVERIFIED';

export class RevenueCatSubscriberIdentityError extends Error {
  constructor(readonly code: RevenueCatSubscriberIdentityErrorCode) {
    super(code);
    this.name = 'RevenueCatSubscriberIdentityError';
  }
}

const MAX_APP_USER_ID_LENGTH = 255;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isCanonicalAppUserId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_APP_USER_ID_LENGTH &&
    value.trim() === value &&
    !hasControlCharacter(value);
}

/**
 * Confirms that a RevenueCat snapshot belongs to the authenticated LuckRead
 * principal that was used for the lookup.
 *
 * expectedAppUserId MUST come from the W02-authenticated principal forwarded
 * through W01. Never derive it from webhook app_user_id, original_app_user_id,
 * aliases, or a client-supplied identifier.
 *
 * RevenueCat may retain an anonymous original ID after Purchases.logIn(); in
 * that case the authenticated custom ID must appear in the provider aliases.
 * This establishes customer identity only. It never establishes that a
 * purchase exists or that an entitlement should be granted.
 */
export function assertRevenueCatSubscriberIdentity(
  snapshot: Pick<
    RevenueCatSubscriberSnapshot,
    'queriedAppUserId' | 'originalAppUserId' | 'aliases' | 'customerCreatedOnLookup'
  >,
  expectedAppUserId: string,
): RevenueCatSubscriberIdentityMatch {
  if (!isCanonicalAppUserId(expectedAppUserId)) {
    throw new RevenueCatSubscriberIdentityError('INVALID_PRINCIPAL_ID');
  }

  if (
    !snapshot ||
    typeof snapshot !== 'object' ||
    typeof snapshot.queriedAppUserId !== 'string' ||
    (snapshot.originalAppUserId !== null && !isCanonicalAppUserId(snapshot.originalAppUserId)) ||
    !Array.isArray(snapshot.aliases) ||
    snapshot.aliases.length > 256 ||
    !snapshot.aliases.every(isCanonicalAppUserId) ||
    typeof snapshot.customerCreatedOnLookup !== 'boolean'
  ) {
    throw new RevenueCatSubscriberIdentityError('INVALID_SNAPSHOT');
  }

  if (snapshot.queriedAppUserId !== expectedAppUserId) {
    throw new RevenueCatSubscriberIdentityError('SNAPSHOT_QUERY_MISMATCH');
  }

  const matchedBy = snapshot.originalAppUserId === expectedAppUserId
    ? 'ORIGINAL_APP_USER_ID'
    : snapshot.aliases.includes(expectedAppUserId)
      ? 'ALIAS'
      : null;

  if (!matchedBy) {
    throw new RevenueCatSubscriberIdentityError('CUSTOMER_IDENTITY_UNVERIFIED');
  }

  return {
    appUserId: expectedAppUserId,
    originalAppUserId: snapshot.originalAppUserId,
    matchedBy,
    customerCreatedOnLookup: snapshot.customerCreatedOnLookup,
  };
}
