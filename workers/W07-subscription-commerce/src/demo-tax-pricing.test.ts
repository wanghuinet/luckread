import { describe, expect, it } from 'vitest';
import {
  applyDemoTaxPricing,
  DEMO_TAX_PROVIDER,
  DEMO_TAX_RATE_BASIS_POINTS,
  isDemoPricingEnabled,
} from './demo-tax-pricing.js';

const resolved = {
  currency: 'USD',
  items: [{
    itemType: 'MEMBERSHIP_PLAN' as const,
    itemRef: 'plan_' + 'a'.repeat(64),
    itemVersion: '1',
    quantity: 1 as const,
    unitAmountMinor: 1200,
    currency: 'USD',
    itemSnapshotJson: JSON.stringify({ planId: 'plan_' + 'a'.repeat(64), planVersion: 1 }),
  }],
};

describe('W07 Demo-only synthetic tax pricing', () => {
  it('calculates deterministic synthetic tax without pretending to use a jurisdiction', () => {
    const priced = applyDemoTaxPricing(resolved);
    expect(priced).toMatchObject({
      pricingMode: 'demo',
      currency: 'USD',
      items: [{ unitAmountMinor: 1200, lineDiscountMinor: 0, lineTaxMinor: 60 }],
    });
    const snapshot = JSON.parse(priced.items[0]!.itemSnapshotJson) as Record<string, any>;
    expect(snapshot.luckreadPricing).toMatchObject({
      mode: 'demo',
      taxProvider: DEMO_TAX_PROVIDER,
      taxRateBasisPoints: DEMO_TAX_RATE_BASIS_POINTS,
      taxMinor: 60,
      disclaimer: 'SIMULATED_ONLY_NOT_FOR_TAX_REPORTING',
    });
    expect(snapshot).not.toHaveProperty('taxAddress');
    expect(snapshot).not.toHaveProperty('jurisdiction');
  });

  it('enables Demo pricing only when Hyperswitch is explicitly sandbox', () => {
    expect(isDemoPricingEnabled('demo', 'sandbox')).toBe(true);
    expect(isDemoPricingEnabled('demo', 'production')).toBe(false);
    expect(isDemoPricingEnabled('production', 'sandbox')).toBe(false);
    expect(isDemoPricingEnabled(undefined, 'sandbox')).toBe(false);
  });
});
