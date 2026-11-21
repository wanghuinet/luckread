import type { ResolvedCommerceOrderItems } from './order-item-resolution.js';
import type { AuthoritativelyPricedOrder } from './order-persistence.js';

export const DEMO_TAX_RATE_BASIS_POINTS = 500;
export const DEMO_TAX_PROVIDER = 'luckread-demo-fixed-rate';

export function isDemoPricingEnabled(mode: unknown, hyperswitchEnvironment: unknown): boolean {
  return mode === 'demo' && hyperswitchEnvironment === 'sandbox';
}

/**
 * Synthetic test tax only. This is deliberately not a tax engine and must never
 * be used for production charging, filing, or reporting. Discounts are explicitly
 * unsupported in this demo policy; each resolved offer price remains W07-owned.
 */
export function applyDemoTaxPricing(
  resolved: ResolvedCommerceOrderItems,
): AuthoritativelyPricedOrder {
  if (!resolved || !/^[A-Z]{3}$/.test(resolved.currency) ||
      !Array.isArray(resolved.items) || resolved.items.length < 1 || resolved.items.length > 50) {
    throw new TypeError('Invalid resolved order items for Demo tax pricing');
  }

  const items = resolved.items.map((item) => {
    const lineSubtotalMinor = item.unitAmountMinor * item.quantity;
    if (!Number.isSafeInteger(lineSubtotalMinor) || lineSubtotalMinor < 0) {
      throw new TypeError('Demo tax subtotal is outside the supported integer range');
    }
    const taxMinor = Number((BigInt(lineSubtotalMinor) * BigInt(DEMO_TAX_RATE_BASIS_POINTS) + 5000n) / 10000n);
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(item.itemSnapshotJson) as unknown;
    } catch {
      throw new TypeError('Resolved membership offer snapshot is invalid');
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new TypeError('Resolved membership offer snapshot is invalid');
    }
    const demoSnapshot = {
      ...(snapshot as Record<string, unknown>),
      luckreadPricing: {
        mode: 'demo',
        taxProvider: DEMO_TAX_PROVIDER,
        taxRateBasisPoints: DEMO_TAX_RATE_BASIS_POINTS,
        taxMinor,
        disclaimer: 'SIMULATED_ONLY_NOT_FOR_TAX_REPORTING',
      },
    };
    return {
      ...item,
      lineDiscountMinor: 0,
      lineTaxMinor: taxMinor,
      itemSnapshotJson: JSON.stringify(demoSnapshot),
    };
  });

  return { currency: resolved.currency, pricingMode: 'demo', items };
}
