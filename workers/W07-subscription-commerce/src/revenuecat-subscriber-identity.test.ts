import { describe, expect, it } from 'vitest';
import {
  assertRevenueCatSubscriberIdentity,
  RevenueCatSubscriberIdentityError,
  type RevenueCatSubscriberIdentityErrorCode,
} from './revenuecat-subscriber-identity.js';
import type { RevenueCatSubscriberSnapshot } from './revenuecat-subscriber-api.js';

type IdentitySnapshot = Pick<
  RevenueCatSubscriberSnapshot,
  'queriedAppUserId' | 'originalAppUserId' | 'aliases' | 'customerCreatedOnLookup'
>;

const W02_USER_ID = '123e4567-e89b-42d3-a456-426614174000';

const makeSnapshot = (overrides: Partial<IdentitySnapshot> = {}): IdentitySnapshot => ({
  queriedAppUserId: W02_USER_ID,
  originalAppUserId: W02_USER_ID,
  aliases: [W02_USER_ID],
  customerCreatedOnLookup: false,
  ...overrides,
});

function expectIdentityError(action: () => unknown, code: RevenueCatSubscriberIdentityErrorCode) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RevenueCatSubscriberIdentityError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error('Expected RevenueCat subscriber identity validation to fail');
}

describe('RevenueCat subscriber identity guard', () => {
  it('accepts the authenticated principal as the original RevenueCat App User ID', () => {
    expect(assertRevenueCatSubscriberIdentity(makeSnapshot(), W02_USER_ID)).toEqual({
      appUserId: W02_USER_ID,
      originalAppUserId: W02_USER_ID,
      matchedBy: 'ORIGINAL_APP_USER_ID',
      customerCreatedOnLookup: false,
    });
  });

  it('accepts the authenticated principal as an alias when RevenueCat retains an anonymous original ID', () => {
    expect(assertRevenueCatSubscriberIdentity(makeSnapshot({
      originalAppUserId: '$RCAnonymousID:abc123',
      aliases: ['$RCAnonymousID:abc123', W02_USER_ID],
    }), W02_USER_ID)).toEqual({
      appUserId: W02_USER_ID,
      originalAppUserId: '$RCAnonymousID:abc123',
      matchedBy: 'ALIAS',
      customerCreatedOnLookup: false,
    });
  });

  it('fails closed when the queried customer is unrelated to the authenticated principal', () => {
    expectIdentityError(
      () => assertRevenueCatSubscriberIdentity(makeSnapshot({
        originalAppUserId: 'another-account',
        aliases: ['another-account'],
      }), W02_USER_ID),
      'CUSTOMER_IDENTITY_UNVERIFIED',
    );
  });

  it('rejects a snapshot fetched using a different App User ID even if an alias happens to match', () => {
    expectIdentityError(
      () => assertRevenueCatSubscriberIdentity(makeSnapshot({
        queriedAppUserId: 'client-supplied-user',
        originalAppUserId: '$RCAnonymousID:abc123',
        aliases: ['$RCAnonymousID:abc123', W02_USER_ID],
      }), W02_USER_ID),
      'SNAPSHOT_QUERY_MISMATCH',
    );
  });

  it('distinguishes a newly created empty customer from purchase evidence', () => {
    expect(assertRevenueCatSubscriberIdentity(makeSnapshot({
      customerCreatedOnLookup: true,
    }), W02_USER_ID)).toMatchObject({
      matchedBy: 'ORIGINAL_APP_USER_ID',
      customerCreatedOnLookup: true,
    });
  });

  it('rejects non-UUID principals, control characters, and malformed aliases', () => {
    expectIdentityError(
      () => assertRevenueCatSubscriberIdentity(makeSnapshot(), 'luckread-user-123'),
      'INVALID_PRINCIPAL_ID',
    );
    expectIdentityError(
      () => assertRevenueCatSubscriberIdentity(makeSnapshot(), ' 123e4567-e89b-42d3-a456-426614174000 '),
      'INVALID_PRINCIPAL_ID',
    );
    expectIdentityError(
      () => assertRevenueCatSubscriberIdentity(makeSnapshot(), 'luckread-user-123\nforged'),
      'INVALID_PRINCIPAL_ID',
    );
    expectIdentityError(
      () => assertRevenueCatSubscriberIdentity(makeSnapshot({
        aliases: ['luckread-user-123\nforged'],
      }), W02_USER_ID),
      'INVALID_SNAPSHOT',
    );
    expectIdentityError(
      () => assertRevenueCatSubscriberIdentity(makeSnapshot({ aliases: [''] }), W02_USER_ID),
      'INVALID_SNAPSHOT',
    );
    expectIdentityError(
      () => assertRevenueCatSubscriberIdentity(makeSnapshot({ originalAppUserId: null, aliases: [] }), W02_USER_ID),
      'CUSTOMER_IDENTITY_UNVERIFIED',
    );
  });
});
