import { describe, expect, it, vi } from 'vitest';
import { resolveDemoCommercePricing } from './demo-commerce-pricing-resolver.js';
import type { ResolvedCommerceOrderItems } from './order-item-resolution.js';
import type { AuthoritativelyPricedOrder } from './order-persistence.js';
import type { SubscriptionRuntimeError } from './subscription-runtime.js';

const d1 = { marker: 'D1-01' } as unknown as D1Database;
const input = { items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] };
const resolved: ResolvedCommerceOrderItems = {
  currency: 'USD',
  items: [{
    itemType: 'MEMBERSHIP_PLAN',
    itemRef: 'plan_' + 'a'.repeat(64),
    itemVersion: '3',
    quantity: 1,
    unitAmountMinor: 1200,
    currency: 'USD',
    itemSnapshotJson: JSON.stringify({ planId: 'plan_' + 'a'.repeat(64), planVersion: 3 }),
  }],
};
const priced: AuthoritativelyPricedOrder = {
  currency: 'USD',
  pricingMode: 'demo',
  items: [{
    ...resolved.items[0]!,
    lineDiscountMinor: 0,
    lineTaxMinor: 96,
  }],
};

function env(overrides: Record<string, unknown> = {}) {
  return {
    D1_01: d1,
    COMMERCE_PRICING_MODE: 'demo',
    HYPERSWITCH_ENVIRONMENT: 'sandbox',
    COMMERCE_DEMO_TAX_PROVIDER: 'taxjar-sandbox',
    TAXJAR_SANDBOX_API_KEY: 'taxjar-sandbox-key',
    TAXJAR_DEMO_FROM_STREET: '100 Main St',
    TAXJAR_DEMO_FROM_CITY: 'Austin',
    TAXJAR_DEMO_FROM_STATE: 'TX',
    TAXJAR_DEMO_FROM_ZIP: '78701',
    TAXJAR_DEMO_TO_STREET: '200 Congress Ave',
    TAXJAR_DEMO_TO_CITY: 'Austin',
    TAXJAR_DEMO_TO_STATE: 'TX',
    TAXJAR_DEMO_TO_ZIP: '78701',
    ...overrides,
  };
}

describe('shared Demo commerce pricing resolver', () => {
  it('reuses the exact sandbox TaxJar adapter and server-resolved immutable plan', async () => {
    const resolveItems = vi.fn(async () => resolved);
    const applyTaxJar = vi.fn(async () => priced);

    const result = await resolveDemoCommercePricing(env(), input, { resolveItems, applyTaxJar });

    expect(result).toEqual(priced);
    expect(resolveItems).toHaveBeenCalledWith(d1, input);
    expect(applyTaxJar).toHaveBeenCalledWith(resolved, {
      apiKey: 'taxjar-sandbox-key',
      fromAddress: { street: '100 Main St', city: 'Austin', state: 'TX', zip: '78701' },
      toAddress: { street: '200 Congress Ave', city: 'Austin', state: 'TX', zip: '78701' },
    });
  });

  it('fails closed before reading the offer unless the provider is in Demo sandbox mode', async () => {
    const resolveItems = vi.fn(async () => resolved);
    const applyTaxJar = vi.fn(async () => priced);

    await expect(resolveDemoCommercePricing(
      env({ HYPERSWITCH_ENVIRONMENT: 'production' }),
      input,
      { resolveItems, applyTaxJar },
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' } satisfies Partial<SubscriptionRuntimeError>);

    expect(resolveItems).not.toHaveBeenCalled();
    expect(applyTaxJar).not.toHaveBeenCalled();
  });

  it('does not silently fall back when the Demo tax provider is missing or unknown', async () => {
    const resolveItems = vi.fn(async () => resolved);
    const applyTaxJar = vi.fn(async () => priced);

    await expect(resolveDemoCommercePricing(
      env({ COMMERCE_DEMO_TAX_PROVIDER: 'unconfigured' }),
      input,
      { resolveItems, applyTaxJar },
    )).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    expect(resolveItems).toHaveBeenCalledTimes(1);
    expect(applyTaxJar).not.toHaveBeenCalled();
  });
});
