import { describe, expect, it } from 'vitest';
import { SubscriptionRuntimeError } from './subscription-runtime.js';
import { resolveRevenueCatMembershipProduct } from './membership-store-product-binding.js';

type FakeDbResult = {
  row?: {
    plan_id: string;
    plan_version: number;
    creator_id: string;
    billing_interval: string;
  } | null;
  failure?: Error;
};

function fakeDb(result: FakeDbResult) {
  let sql = '';
  let bindings: unknown[] = [];
  const db = {
    prepare(statement: string) {
      sql = statement;
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return {
            async first<T>() {
              if (result.failure) throw result.failure;
              return (result.row ?? null) as T | null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, getSql: () => sql, getBindings: () => bindings };
}

const input = {
  revenueCatAppId: 'app_luckread_android',
  store: 'PLAY_STORE' as const,
  // RevenueCat encodes the Google Play base plan in the product identifier.
  productId: 'creator.gold:monthly-v1',
  purpose: 'NEW_PURCHASE' as const,
};

const validRow = {
  plan_id: 'plan_creator_gold',
  plan_version: 3,
  creator_id: 'creator_123',
  billing_interval: 'MONTHLY',
};

describe('RevenueCat membership product binding', () => {
  it('resolves the exact full provider product ID without parsing suffixes', async () => {
    const { db, getSql, getBindings } = fakeDb({ row: validRow });

    await expect(resolveRevenueCatMembershipProduct(db, input)).resolves.toEqual({
      planId: 'plan_creator_gold',
      planVersion: 3,
      creatorId: 'creator_123',
      billingInterval: 'MONTHLY',
    });
    expect(getBindings()).toEqual([
      'app_luckread_android',
      'PLAY_STORE',
      'creator.gold:monthly-v1',
    ]);
    expect(getSql()).toContain('p.current_version = b.plan_version');
    expect(getSql()).toContain("b.status = 'ACTIVE'");
    expect(getSql()).toContain("p.status = 'ACTIVE'");
    expect(getSql()).toContain("p.visibility = 'PUBLIC'");
    expect(getSql()).toContain("p.owner_type = 'CREATOR'");
  });

  it('keeps retired historical bindings resolvable for existing transactions only', async () => {
    const { db, getSql } = fakeDb({ row: validRow });

    await expect(resolveRevenueCatMembershipProduct(db, {
      ...input,
      purpose: 'EXISTING_TRANSACTION',
    })).resolves.toMatchObject({ planId: 'plan_creator_gold', planVersion: 3 });
    expect(getSql()).toContain("b.status IN ('ACTIVE', 'RETIRED')");
    expect(getSql()).not.toContain('p.current_version = b.plan_version');
  });

  it('does not resolve a missing product mapping', async () => {
    const { db } = fakeDb({ row: null });

    await expect(resolveRevenueCatMembershipProduct(db, input)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  it('fails closed when D1 cannot be read', async () => {
    const { db } = fakeDb({ failure: new Error('database detail') });

    await expect(resolveRevenueCatMembershipProduct(db, input)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
  });

  it('rejects non-canonical identities and unsupported stores', async () => {
    const { db } = fakeDb({ row: validRow });

    await expect(resolveRevenueCatMembershipProduct(db, {
      ...input,
      productId: ' creator.gold:monthly-v1 ',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    await expect(resolveRevenueCatMembershipProduct(db, {
      ...input,
      store: 'STRIPE' as never,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });

  it('rejects malformed persisted mapping rows', async () => {
    const { db } = fakeDb({ row: { ...validRow, plan_version: 0 } });

    try {
      await resolveRevenueCatMembershipProduct(db, input);
      throw new Error('expected mapping integrity rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(SubscriptionRuntimeError);
      expect(error).toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 });
    }
  });
});
