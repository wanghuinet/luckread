/// <reference types="@cloudflare/workers-types" />

import { describe, expect, it } from 'vitest';
import { resolveCommerceOrderItems } from './order-item-resolution.js';
import { SubscriptionRuntimeError } from './subscription-runtime.js';

type PlanVersionFixture = {
  plan_version: number;
  name: string;
  tier: string;
  billing_interval: 'MONTHLY' | 'YEARLY';
  price_minor: number;
  currency: string;
  benefits_json: string;
  created_at: string;
};

type PlanFixture = {
  plan_id: string;
  owner_type: 'CREATOR' | 'COMMUNITY' | 'PLATFORM';
  owner_id: string;
  current_version: number;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED';
  visibility: 'PRIVATE' | 'PUBLIC';
  version: number;
  created_at: string;
  updated_at: string;
  versions: PlanVersionFixture[];
};

type CapturedQuery = { sql: string; values: unknown[] };

const at = '2026-10-27T10:00:00.000Z';
const planA = 'plan_' + 'a'.repeat(64);
const planB = 'plan_' + 'b'.repeat(64);

function fixture(
  planId: string,
  overrides: Partial<PlanFixture> = {},
): PlanFixture {
  const defaultVersion: PlanVersionFixture = {
    plan_version: 1,
    name: 'Creator membership',
    tier: 'basic',
    billing_interval: 'MONTHLY',
    price_minor: 1200,
    currency: 'USD',
    benefits_json: JSON.stringify(['Member posts']),
    created_at: at,
  };
  return {
    plan_id: planId,
    owner_type: 'CREATOR',
    owner_id: 'creator_123',
    current_version: 1,
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    version: 1,
    created_at: at,
    updated_at: at,
    versions: [defaultVersion],
    ...overrides,
  };
}

function fakeDb(fixtures: PlanFixture[], readError?: Error) {
  const queries: CapturedQuery[] = [];
  const db = {
    prepare(sql: string) {
      const captured: CapturedQuery = { sql, values: [] };
      queries.push(captured);
      const statement = {
        bind(...values: unknown[]) {
          captured.values = values;
          return statement;
        },
        async all<T>() {
          if (readError) throw readError;
          const ids = new Set(captured.values.map(String));
          const results = fixtures
            .filter((plan) =>
              ids.has(plan.plan_id) &&
              plan.owner_type === 'CREATOR' &&
              plan.status === 'ACTIVE' &&
              plan.visibility === 'PUBLIC',
            )
            .flatMap((plan) => {
              const version = plan.versions.find((entry) => entry.plan_version === plan.current_version);
              if (!version) return [];
              return [{
                plan_id: plan.plan_id,
                owner_id: plan.owner_id,
                current_version: plan.current_version,
                status: plan.status,
                visibility: plan.visibility,
                version: plan.version,
                created_at: plan.created_at,
                updated_at: plan.updated_at,
                name: version.name,
                tier: version.tier,
                billing_interval: version.billing_interval,
                price_minor: version.price_minor,
                currency: version.currency,
                benefits_json: version.benefits_json,
              }];
            });
          return { results: results as T[] };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, queries };
}

async function expectRuntimeError(
  action: () => Promise<unknown>,
  code: string,
  status: number,
) {
  await expect(action()).rejects.toMatchObject({ code, status });
}

describe('PAY-002 read-only membership offer resolution', () => {
  it('resolves authoritative current prices/versions and preserves request order with one D1 read', async () => {
    const a = fixture(planA, {
      current_version: 2,
      versions: [
        { plan_version: 1, name: 'Old', tier: 'basic', billing_interval: 'MONTHLY', price_minor: 100, currency: 'USD', benefits_json: '[]', created_at: at },
        { plan_version: 2, name: 'Current A', tier: 'plus', billing_interval: 'YEARLY', price_minor: 4900, currency: 'USD', benefits_json: JSON.stringify(['Archive']), created_at: at },
      ],
    });
    const b = fixture(planB, {
      owner_id: 'creator_456',
      versions: [
        { plan_version: 1, name: 'Current B', tier: 'basic', billing_interval: 'MONTHLY', price_minor: 800, currency: 'USD', benefits_json: JSON.stringify(['Posts']), created_at: at },
      ],
    });
    const { db, queries } = fakeDb([a, b]);

    const result = await resolveCommerceOrderItems(db, {
      items: [{ itemRef: planB, quantity: 1 }, { itemRef: planA, quantity: 1 }],
    });

    expect(result.currency).toBe('USD');
    expect(result.items.map((item) => [item.itemRef, item.itemVersion, item.unitAmountMinor])).toEqual([
      [planB, '1', 800],
      [planA, '2', 4900],
    ]);
    expect(JSON.parse(result.items[1]!.itemSnapshotJson)).toMatchObject({
      planId: planA,
      planVersion: 2,
      creatorId: 'creator_123',
      name: 'Current A',
      priceMinor: 4900,
      currency: 'USD',
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('v.plan_version = p.current_version');
    expect(queries[0]!.sql).toContain("p.owner_type = 'CREATOR'");
    expect(queries[0]!.sql).toContain("p.status = 'ACTIVE'");
    expect(queries[0]!.sql).toContain("p.visibility = 'PUBLIC'");
    expect(queries[0]!.values).toEqual([planB, planA]);
  });

  it('normalizes D1/schema read failures without exposing database details', async () => {
    const internalError = new Error('no such table: membership_plans; secret SQL fragment');
    const { db } = fakeDb([fixture(planA)], internalError);

    await expectRuntimeError(
      () => resolveCommerceOrderItems(db, { items: [{ itemRef: planA, quantity: 1 }] }),
      'SERVICE_UNAVAILABLE',
      503,
    ).then(() => undefined);
  });

  it('returns resource-not-found for unknown, draft, private or retired offers', async () => {
    for (const unavailable of [
      [],
      [fixture(planA, { status: 'DRAFT', visibility: 'PRIVATE' })],
      [fixture(planA, { status: 'ACTIVE', visibility: 'PRIVATE' })],
      [fixture(planA, { status: 'RETIRED', visibility: 'PUBLIC' })],
      [fixture(planA, { owner_type: 'COMMUNITY' })],
      [fixture(planA, { versions: [] })],
    ]) {
      const { db } = fakeDb(unavailable);
      await expectRuntimeError(
        () => resolveCommerceOrderItems(db, { items: [{ itemRef: planA, quantity: 1 }] }),
        'RESOURCE_NOT_FOUND',
        404,
      );
    }
  });

  it('fails closed on unsupported item families before reading D1', async () => {
    const { db, queries } = fakeDb([fixture(planA)]);
    await expectRuntimeError(
      () => resolveCommerceOrderItems(db, { items: [{ itemRef: 'content_article_123', quantity: 1 }] }),
      'RESOURCE_NOT_FOUND',
      404,
    );
    expect(queries).toHaveLength(0);
  });

  it('rejects membership quantities other than one before reading D1', async () => {
    const { db, queries } = fakeDb([fixture(planA)]);
    await expectRuntimeError(
      () => resolveCommerceOrderItems(db, { items: [{ itemRef: planA, quantity: 2 }] }),
      'VALIDATION_FAILED',
      400,
    );
    expect(queries).toHaveLength(0);
  });

  it('rejects multi-plan orders before charging because Beta fulfills one subscription per order', async () => {
    const { db, queries } = fakeDb([fixture(planA), fixture(planB)]);
    await expectRuntimeError(
      () => resolveCommerceOrderItems(db, {
        items: [{ itemRef: planA, quantity: 1 }, { itemRef: planB, quantity: 1 }],
      }),
      'VALIDATION_FAILED',
      400,
    );
    expect(queries).toHaveLength(0);
  });

  it('rejects client-supplied price, currency and unknown fields before reading D1', async () => {
    const { db, queries } = fakeDb([fixture(planA)]);
    await expectRuntimeError(
      () => resolveCommerceOrderItems(db, {
        customerId: 'attacker',
        totalMinor: 1,
        items: [{ itemRef: planA, quantity: 1, unitAmountMinor: 1 }],
      }),
      'VALIDATION_FAILED',
      400,
    );
    expect(queries).toHaveLength(0);
  });

  it('maps malformed persisted offer metadata to an integrity failure', async () => {
    const bad = fixture(planA, {
      versions: [{
        plan_version: 1,
        name: 'Creator membership',
        tier: 'basic',
        billing_interval: 'MONTHLY',
        price_minor: 1200,
        currency: 'USD',
        benefits_json: '{"not":"an array"}',
        created_at: at,
      }],
    });
    const { db } = fakeDb([bad]);
    await expectRuntimeError(
      () => resolveCommerceOrderItems(db, { items: [{ itemRef: planA, quantity: 1 }] }),
      'INTEGRITY_VIOLATION',
      500,
    );
  });

  it('allows a zero-priced offer as pricing data only; it does not create or confirm anything', async () => {
    const free = fixture(planA, {
      versions: [{
        plan_version: 1,
        name: 'Free tier',
        tier: 'basic',
        billing_interval: 'MONTHLY',
        price_minor: 0,
        currency: 'USD',
        benefits_json: '[]',
        created_at: at,
      }],
    });
    const { db, queries } = fakeDb([free]);
    const result = await resolveCommerceOrderItems(db, { items: [{ itemRef: planA, quantity: 1 }] });
    expect(result.items[0]!.unitAmountMinor).toBe(0);
    expect(queries).toHaveLength(1);
  });

  it('rejects mixed-currency items rather than silently converting or aggregating them', async () => {
    const eur = fixture(planB, {
      versions: [{
        plan_version: 1,
        name: 'Euro membership',
        tier: 'basic',
        billing_interval: 'MONTHLY',
        price_minor: 900,
        currency: 'EUR',
        benefits_json: '[]',
        created_at: at,
      }],
    });
    const { db } = fakeDb([fixture(planA), eur]);
    await expectRuntimeError(
      () => resolveCommerceOrderItems(db, {
        items: [{ itemRef: planA, quantity: 1 }, { itemRef: planB, quantity: 1 }],
      }),
      'VALIDATION_FAILED',
      400,
    );
  });
});
