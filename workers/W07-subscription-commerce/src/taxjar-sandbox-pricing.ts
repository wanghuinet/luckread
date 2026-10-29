import type { ResolvedCommerceOrderItems } from './order-item-resolution.js';
import type { AuthoritativelyPricedOrder } from './order-persistence.js';

export const TAXJAR_SANDBOX_TAX_PROVIDER = 'taxjar-sandbox';
const TAXJAR_SANDBOX_TAXES_URL = 'https://api.sandbox.taxjar.com/v2/taxes';
const TAXJAR_API_VERSION = '2022-01-24';
const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export type TaxJarSandboxAddress = Readonly<{
  street: string;
  city: string;
  state: string;
  zip: string;
}>;

export type TaxJarSandboxPricingConfig = Readonly<{
  apiKey?: string;
  fromAddress?: TaxJarSandboxAddress;
  toAddress?: TaxJarSandboxAddress;
  fetchImpl?: typeof fetch;
}>;

export class TaxJarSandboxPricingError extends Error {
  constructor() {
    // Do not include vendor response bodies, addresses, or credentials in errors.
    super('TaxJar sandbox tax calculation is unavailable');
    this.name = 'TaxJarSandboxPricingError';
  }
}

type TaxJarLineTax = Readonly<{
  id?: unknown;
  tax_collectable?: unknown;
}>;

type TaxJarResponse = Readonly<{
  tax?: Readonly<{
    amount_to_collect?: unknown;
    has_nexus?: unknown;
    rate?: unknown;
    breakdown?: Readonly<{ line_items?: unknown }>;
  }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredAddress(address: TaxJarSandboxAddress | undefined): TaxJarSandboxAddress {
  if (!address) throw new TaxJarSandboxPricingError();
  const fields = [address.street, address.city, address.state, address.zip];
  if (fields.some((value) => typeof value !== 'string' || value !== value.trim() ||
      value.length < 1 || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value))) {
    throw new TaxJarSandboxPricingError();
  }
  if (!/^[A-Z]{2}$/.test(address.state) || !/^\d{5}(?:-\d{4})?$/.test(address.zip)) {
    throw new TaxJarSandboxPricingError();
  }
  return address;
}

function toMinor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      value > MAX_MINOR / 100) {
    throw new TaxJarSandboxPricingError();
  }
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor)) throw new TaxJarSandboxPricingError();
  return minor;
}

function snapshotWithTax(
  rawSnapshot: string,
  taxMinor: number,
  nexus: boolean | null,
  rate: number | null,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSnapshot) as unknown;
  } catch {
    throw new TaxJarSandboxPricingError();
  }
  if (!isRecord(parsed)) throw new TaxJarSandboxPricingError();
  return JSON.stringify({
    ...parsed,
    luckreadPricing: {
      mode: 'demo',
      taxProvider: TAXJAR_SANDBOX_TAX_PROVIDER,
      taxMinor,
      taxNexus: nexus,
      taxRate: rate,
      disclaimer: 'SANDBOX_ONLY_NOT_FOR_TAX_REPORTING',
    },
  });
}

/**
 * Calls the TaxJar sandbox calculation endpoint for the explicitly gated Demo
 * checkout path. It must never be wired into production pricing or filing flows.
 * Address input is demo configuration only and is not included in the order snapshot.
 */
export async function applyTaxJarSandboxPricing(
  resolved: ResolvedCommerceOrderItems,
  config: TaxJarSandboxPricingConfig,
): Promise<AuthoritativelyPricedOrder> {
  if (!config.apiKey || config.apiKey !== config.apiKey.trim() || config.apiKey.length > 4096 ||
      /[\u0000-\u001f\u007f]/.test(config.apiKey) ||
      resolved.currency !== 'USD' || !Array.isArray(resolved.items) ||
      resolved.items.length < 1 || resolved.items.length > 50) {
    throw new TaxJarSandboxPricingError();
  }

  const from = requiredAddress(config.fromAddress);
  const to = requiredAddress(config.toAddress);
  let subtotalMinor = 0;
  const lineItems = resolved.items.map((item, index) => {
    if (!Number.isSafeInteger(item.unitAmountMinor) || item.unitAmountMinor < 0 ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 ||
        item.currency !== 'USD') {
      throw new TaxJarSandboxPricingError();
    }
    const lineSubtotalMinor = item.unitAmountMinor * item.quantity;
    subtotalMinor += lineSubtotalMinor;
    if (!Number.isSafeInteger(lineSubtotalMinor) || !Number.isSafeInteger(subtotalMinor) ||
        subtotalMinor > MAX_MINOR) {
      throw new TaxJarSandboxPricingError();
    }
    return {
      id: String(index + 1),
      quantity: item.quantity,
      unit_price: item.unitAmountMinor / 100,
      discount: 0,
    };
  });

  const fetchImpl = config.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(TAXJAR_SANDBOX_TAXES_URL, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + config.apiKey,
        'content-type': 'application/json',
        'x-api-version': TAXJAR_API_VERSION,
      },
      body: JSON.stringify({
        from_country: 'US',
        from_zip: from.zip,
        from_state: from.state,
        from_city: from.city,
        from_street: from.street,
        to_country: 'US',
        to_zip: to.zip,
        to_state: to.state,
        to_city: to.city,
        to_street: to.street,
        amount: subtotalMinor / 100,
        shipping: 0,
        line_items: lineItems,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new TaxJarSandboxPricingError();
  }
  if (!response.ok) throw new TaxJarSandboxPricingError();

  let raw: unknown;
  try {
    raw = await response.json() as unknown;
  } catch {
    throw new TaxJarSandboxPricingError();
  }
  if (!isRecord(raw) || !isRecord(raw.tax)) throw new TaxJarSandboxPricingError();
  const tax = raw.tax as unknown as TaxJarResponse['tax'];
  if (!tax) throw new TaxJarSandboxPricingError();
  const totalTaxMinor = toMinor(tax.amount_to_collect);
  if (typeof tax.has_nexus !== 'boolean' || typeof tax.rate !== 'number' ||
      !Number.isFinite(tax.rate) || tax.rate < 0 || tax.rate > 1) {
    throw new TaxJarSandboxPricingError();
  }
  const nexus = tax.has_nexus;
  const rate = tax.rate;

  const breakdown = tax.breakdown;
  if (!breakdown || !Array.isArray(breakdown.line_items)) {
    // TaxJar documents a no-nexus response without a line breakdown. Accept it
    // only when the provider explicitly confirms there is no tax to collect.
    if (nexus !== false || totalTaxMinor !== 0) throw new TaxJarSandboxPricingError();
    return {
      currency: 'USD',
      pricingMode: 'demo',
      items: resolved.items.map((item) => ({
        ...item,
        lineDiscountMinor: 0,
        lineTaxMinor: 0,
        itemSnapshotJson: snapshotWithTax(item.itemSnapshotJson, 0, false, rate),
      })),
    };
  }

  const byId = new Map<string, number>();
  for (const rawLine of breakdown.line_items) {
    if (!isRecord(rawLine)) throw new TaxJarSandboxPricingError();
    const line = rawLine as TaxJarLineTax;
    if (typeof line.id !== 'string' || !/^\d+$/.test(line.id) || byId.has(line.id)) {
      throw new TaxJarSandboxPricingError();
    }
    byId.set(line.id, toMinor(line.tax_collectable));
  }
  if (byId.size !== resolved.items.length) throw new TaxJarSandboxPricingError();

  let sumLineTaxMinor = 0;
  const items = resolved.items.map((item, index) => {
    const key = String(index + 1);
    if (!byId.has(key)) throw new TaxJarSandboxPricingError();
    const taxMinor = byId.get(key)!;
    sumLineTaxMinor += taxMinor;
    if (!Number.isSafeInteger(sumLineTaxMinor)) throw new TaxJarSandboxPricingError();
    return {
      ...item,
      lineDiscountMinor: 0,
      lineTaxMinor: taxMinor,
      itemSnapshotJson: snapshotWithTax(item.itemSnapshotJson, taxMinor, nexus, rate),
    };
  });
  if (sumLineTaxMinor !== totalTaxMinor) throw new TaxJarSandboxPricingError();

  return { currency: 'USD', pricingMode: 'demo', items };
}
