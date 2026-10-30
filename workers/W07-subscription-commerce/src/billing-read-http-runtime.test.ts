import { describe, expect, it } from 'vitest';
import { handleCommerceBillingReadRequest } from './billing-read-http-runtime.js';

const CUSTOMER_ID = 'customer_history_001';

type Dependencies = NonNullable<Parameters<typeof handleCommerceBillingReadRequest>[3]>;

function createFixture() {
  const calls = {
    documents: [] as unknown[][],
    payments: [] as unknown[][],
    refunds: [] as unknown[][],
  };
  const page = {
    items: [],
    nextCursor: null,
    hasMore: false,
  };
  const dependencies: Dependencies = {
    listBillingDocuments: async (...args) => {
      calls.documents.push(args);
      return page;
    },
    listPaymentHistory: async (...args) => {
      calls.payments.push(args);
      return page;
    },
    listRefundHistory: async (...args) => {
      calls.refunds.push(args);
      return page;
    },
  };
  const env = { D1_04: {} as D1Database };
  return { calls, dependencies, env };
}

describe('W07 customer billing and payment history reads', () => {
  it('does not claim unrelated routes or non-GET routes', async () => {
    const f = createFixture();
    await expect(
      handleCommerceBillingReadRequest(
        new Request('https://luckread-w07.internal/commerce/orders'),
        CUSTOMER_ID,
        f.env,
        f.dependencies,
      ),
    ).resolves.toBeNull();

    const response = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/payments/history', { method: 'POST' }),
      CUSTOMER_ID,
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(405);
    expect(f.calls.payments).toHaveLength(0);
  });

  it('lists payment history within the server-derived customer scope using bounded keyset pagination', async () => {
    const f = createFixture();
    const response = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/payments/history?limit=10&cursor=eyJ0aW1lc3RhbXAiOiIyMDI2LTEwLTMwVDEwOjAwOjAwLjAwMFoiLCJpZCI6InBheF8xIn0'),
      CUSTOMER_ID,
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(200);
    expect(f.calls.payments).toHaveLength(1);
    expect(f.calls.payments[0]?.slice(1)).toEqual([CUSTOMER_ID, 10, 'eyJ0aW1lc3RhbXAiOiIyMDI2LTEwLTMwVDEwOjAwOjAwLjAwMFoiLCJpZCI6InBheF8xIn0']);
    expect(response?.headers.get('cache-control')).toBe('no-store');
  });

  it('lists refunds and invoices from their dedicated customer-scoped D1-04 queries', async () => {
    const f = createFixture();
    const refund = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/payments/refunds?limit=5'),
      CUSTOMER_ID,
      f.env,
      f.dependencies,
    );
    const documents = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/billing/documents?limit=7'),
      CUSTOMER_ID,
      f.env,
      f.dependencies,
    );
    expect(refund?.status).toBe(200);
    expect(documents?.status).toBe(200);
    expect(f.calls.refunds[0]?.slice(1)).toEqual([CUSTOMER_ID, 5, null]);
    expect(f.calls.documents[0]?.slice(1)).toEqual([CUSTOMER_ID, 7, null]);
  });

  it('rejects unsupported query parameters, malformed page sizes and oversized cursors before any D1 query', async () => {
    for (const url of [
      'https://luckread-w07.internal/commerce/payments/history?offset=100',
      'https://luckread-w07.internal/commerce/payments/history?limit=51',
      'https://luckread-w07.internal/commerce/billing/documents?cursor=' + 'a'.repeat(513),
    ]) {
      const f = createFixture();
      const response = await handleCommerceBillingReadRequest(new Request(url), CUSTOMER_ID, f.env, f.dependencies);
      expect(response?.status).toBe(400);
      expect(f.calls.documents).toHaveLength(0);
      expect(f.calls.payments).toHaveLength(0);
      expect(f.calls.refunds).toHaveLength(0);
    }
  });

  it('maps persistence validation failures to sanitized responses', async () => {
    const f = createFixture();
    f.dependencies.listRefundHistory = async () => {
      throw new Error('database table name and raw SQL must not be exposed');
    };
    const response = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/payments/refunds'),
      CUSTOMER_ID,
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(503);
    const body = await response!.text();
    expect(body).toContain('SERVICE_UNAVAILABLE');
    expect(body).not.toContain('database table name');
    expect(body).not.toContain('raw SQL');
  });
});
