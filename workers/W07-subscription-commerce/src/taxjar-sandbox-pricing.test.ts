import { describe, expect, it, vi } from 'vitest';
import {
  applyTaxJarSandboxPricing,
  TAXJAR_SANDBOX_TAX_PROVIDER,
  TaxJarSandboxPricingError,
  type TaxJarSandboxAddress,
} from './taxjar-sandbox-pricing.js';

const address: TaxJarSandboxAddress = {
  street: '123 Demo Test Way',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
};

const resolved = {
  currency: 'USD',
  items: [{
    itemType: 'MEMBERSHIP_PLAN' as const,
    itemRef: 'plan_' + 'a'.repeat(64),
    itemVersion: '3',
    quantity: 1 as const,
    unitAmountMinor: 1200,
    currency: 'USD',
    itemSnapshotJson: JSON.stringify({ planId: 'plan_' + 'a'.repeat(64), planVersion: 3 }),
  }],
};

function fetchResponse(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

describe('TaxJar sandbox demo pricing adapter', () => {
  it('uses only the fixed TaxJar sandbox endpoint and records provider-calculated minor-unit tax', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        tax: {
          amount_to_collect: 0.96,
          has_nexus: true,
          rate: 0.08,
          breakdown: { line_items: [{ id: '1', tax_collectable: 0.96 }] },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const priced = await applyTaxJarSandboxPricing(resolved, {
      apiKey: 'sandbox-token',
      fromAddress: address,
      toAddress: { ...address, zip: '78702' },
      fetchImpl,
    });

    expect(requestUrl).toBe('https://api.sandbox.taxjar.com/v2/taxes');
    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.redirect).toBe('error');
    const headers = new Headers(requestInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer sandbox-token');
    expect(headers.get('x-api-version')).toBe('2022-01-24');
    const requestBody = JSON.parse(String(requestInit?.body)) as Record<string, any>;
    expect(requestBody).toMatchObject({
      from_country: 'US',
      from_state: 'TX',
      from_zip: '78701',
      to_country: 'US',
      to_state: 'TX',
      to_zip: '78702',
      amount: 12,
      shipping: 0,
      line_items: [{ id: '1', quantity: 1, unit_price: 12, discount: 0 }],
    });

    expect(priced).toMatchObject({
      pricingMode: 'demo',
      currency: 'USD',
      items: [{ lineDiscountMinor: 0, lineTaxMinor: 96 }],
    });
    const snapshot = JSON.parse(priced.items[0]!.itemSnapshotJson) as Record<string, any>;
    expect(snapshot.luckreadPricing).toMatchObject({
      mode: 'demo',
      taxProvider: TAXJAR_SANDBOX_TAX_PROVIDER,
      taxMinor: 96,
      taxNexus: true,
      taxRate: 0.08,
      disclaimer: 'SANDBOX_ONLY_NOT_FOR_TAX_REPORTING',
    });
    expect(snapshot).not.toHaveProperty('taxAddress');
    expect(snapshot).not.toHaveProperty('to_street');
  });

  it('accepts an explicit no-nexus, zero-tax response without inventing tax', async () => {
    const fetchImpl = fetchResponse({ tax: { amount_to_collect: 0, has_nexus: false, rate: 0 } });
    const priced = await applyTaxJarSandboxPricing(resolved, {
      apiKey: 'sandbox-token',
      fromAddress: address,
      toAddress: address,
      fetchImpl,
    });
    expect(priced.items[0]!.lineTaxMinor).toBe(0);
    expect(JSON.parse(priced.items[0]!.itemSnapshotJson)).toMatchObject({
      luckreadPricing: { taxNexus: false, taxMinor: 0 },
    });
  });

  it('fails closed before network access if key or demo addresses are missing or malformed', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(applyTaxJarSandboxPricing(resolved, {
      fromAddress: address, toAddress: address, fetchImpl,
    })).rejects.toBeInstanceOf(TaxJarSandboxPricingError);
    await expect(applyTaxJarSandboxPricing(resolved, {
      apiKey: 'sandbox-token',
      fromAddress: { ...address, zip: 'not-a-zip' },
      toAddress: address,
      fetchImpl,
    })).rejects.toBeInstanceOf(TaxJarSandboxPricingError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects non-USD membership plans before calling TaxJar', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(applyTaxJarSandboxPricing({
      ...resolved, currency: 'EUR',
    }, {
      apiKey: 'sandbox-token', fromAddress: address, toAddress: address, fetchImpl,
    })).rejects.toBeInstanceOf(TaxJarSandboxPricingError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when TaxJar fails or line totals disagree with its order tax', async () => {
    await expect(applyTaxJarSandboxPricing(resolved, {
      apiKey: 'sandbox-token', fromAddress: address, toAddress: address,
      fetchImpl: fetchResponse({ error: 'secret provider detail' }, 401),
    })).rejects.toThrow('TaxJar sandbox tax calculation is unavailable');

    await expect(applyTaxJarSandboxPricing(resolved, {
      apiKey: 'sandbox-token', fromAddress: address, toAddress: address,
      fetchImpl: fetchResponse({
        tax: {
          amount_to_collect: 1.01,
          has_nexus: true,
          rate: 0.08,
          breakdown: { line_items: [{ id: '1', tax_collectable: 0.96 }] },
        },
      }),
    })).rejects.toBeInstanceOf(TaxJarSandboxPricingError);
  });
});
