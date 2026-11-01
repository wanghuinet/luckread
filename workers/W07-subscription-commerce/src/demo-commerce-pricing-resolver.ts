import { resolveCommerceOrderItems } from './order-item-resolution.js';
import type { AuthoritativelyPricedOrder } from './order-persistence.js';
import { applyDemoTaxPricing, isDemoPricingEnabled } from './demo-tax-pricing.js';
import { applyTaxJarSandboxPricing, type TaxJarSandboxAddress } from './taxjar-sandbox-pricing.js';
import { SubscriptionRuntimeError } from './subscription-runtime.js';

export type DemoCommercePricingEnv = Readonly<{
  D1_01: D1Database;
  HYPERSWITCH_ENVIRONMENT?: string | null;
  COMMERCE_PRICING_MODE?: string | null;
  COMMERCE_DEMO_TAX_PROVIDER?: string | null;
  TAXJAR_SANDBOX_API_KEY?: string | null;
  TAXJAR_DEMO_FROM_STREET?: string | null;
  TAXJAR_DEMO_FROM_CITY?: string | null;
  TAXJAR_DEMO_FROM_STATE?: string | null;
  TAXJAR_DEMO_FROM_ZIP?: string | null;
  TAXJAR_DEMO_TO_STREET?: string | null;
  TAXJAR_DEMO_TO_CITY?: string | null;
  TAXJAR_DEMO_TO_STATE?: string | null;
  TAXJAR_DEMO_TO_ZIP?: string | null;
}>;

type DemoCommercePricingDependencies = Readonly<{
  resolveItems?: typeof resolveCommerceOrderItems;
  applyTaxJar?: typeof applyTaxJarSandboxPricing;
}>;

function address(env: DemoCommercePricingEnv, prefix: 'FROM' | 'TO'): TaxJarSandboxAddress {
  return prefix === 'FROM'
    ? {
        street: env.TAXJAR_DEMO_FROM_STREET ?? '',
        city: env.TAXJAR_DEMO_FROM_CITY ?? '',
        state: env.TAXJAR_DEMO_FROM_STATE ?? '',
        zip: env.TAXJAR_DEMO_FROM_ZIP ?? '',
      }
    : {
        street: env.TAXJAR_DEMO_TO_STREET ?? '',
        city: env.TAXJAR_DEMO_TO_CITY ?? '',
        state: env.TAXJAR_DEMO_TO_STATE ?? '',
        zip: env.TAXJAR_DEMO_TO_ZIP ?? '',
      };
}

/**
 * Shared owning-domain Demo resolver for customer-present checkout and scheduled
 * renewals. It always resolves the immutable plan/version from D1-01 first,
 * then applies the explicitly selected Demo tax adapter. It never creates
 * production prices or silently substitutes a missing tax provider.
 */
export async function resolveDemoCommercePricing(
  env: DemoCommercePricingEnv,
  input: unknown,
  dependencies: DemoCommercePricingDependencies = {},
): Promise<AuthoritativelyPricedOrder> {
  if (!isDemoPricingEnabled(env.COMMERCE_PRICING_MODE, env.HYPERSWITCH_ENVIRONMENT)) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  const resolveItems = dependencies.resolveItems ?? resolveCommerceOrderItems;
  const resolved = await resolveItems(env.D1_01, input);

  if (env.COMMERCE_DEMO_TAX_PROVIDER === 'synthetic') {
    return applyDemoTaxPricing(resolved);
  }

  if (env.COMMERCE_DEMO_TAX_PROVIDER === 'taxjar-sandbox') {
    try {
      const applyTaxJar = dependencies.applyTaxJar ?? applyTaxJarSandboxPricing;
      return await applyTaxJar(resolved, {
        apiKey: env.TAXJAR_SANDBOX_API_KEY ?? undefined,
        fromAddress: address(env, 'FROM'),
        toAddress: address(env, 'TO'),
      });
    } catch {
      // Keep vendor errors and credentials out of the Worker response.
      throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    }
  }

  // Demo pricing is closed unless the tax provider is explicitly selected.
  throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
}
