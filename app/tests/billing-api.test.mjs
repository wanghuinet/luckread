import { beforeEach, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const calls = [];

mock.module('../lib/api-client.ts', () => ({
  apiRequest: async (path, options = {}) => {
    calls.push({ path, options });
    return {
      response: { ok: true, status: 200 },
      data: { data: { items: [], nextCursor: null, hasMore: false }, requestId: 'req_billing_test' },
      error: null,
    };
  },
}));

const {
  fetchBillingDocumentsPage,
  fetchPaymentHistoryPage,
  fetchRefundHistoryPage,
  requestPaymentRefund,
} = await import('../lib/billing-api.ts');

beforeEach(() => {
  calls.length = 0;
});

test('loads invoice and receipt snapshots through the canonical W01 route', async () => {
  const controller = new AbortController();
  await fetchBillingDocumentsPage({ limit: 10, cursor: 'opaque/cursor', signal: controller.signal });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/billing/documents?limit=10&cursor=opaque%2Fcursor');
  expect(calls[0]?.options.method).toBe('GET');
  expect(calls[0]?.options.signal).toBe(controller.signal);
});

test('loads customer-owned payment history through the canonical W01 route', async () => {
  await fetchPaymentHistoryPage({ limit: 25 });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/payments/history?limit=25');
  expect(calls[0]?.options.method).toBe('GET');
});

test('loads customer-owned refund history through the canonical W01 route', async () => {
  await fetchRefundHistoryPage({ limit: 15, cursor: 'refund-cursor' });

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/payments/refunds?limit=15&cursor=refund-cursor');
  expect(calls[0]?.options.method).toBe('GET');
});

test('requests refunds with the payment-owned resource, amount, currency and stable idempotency key', async () => {
  const paymentId = 'pay_' + 'a'.repeat(26);
  await requestPaymentRefund(paymentId, 1299, 'USD', 'refund_attempt_1');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.path).toBe('/payments/refunds');
  expect(calls[0]?.options.method).toBe('POST');
  expect(calls[0]?.options.idempotencyKey).toBe('refund_attempt_1');
  expect(JSON.parse(String(calls[0]?.options.body))).toEqual({
    paymentId,
    amountMinor: 1299,
    currency: 'USD',
  });
});

test('includes an optional bounded refund reason without allowing malformed input', async () => {
  const paymentId = 'pay_' + 'b'.repeat(26);
  await requestPaymentRefund(paymentId, 500, 'USD', 'refund_attempt_2', 'Customer request');

  expect(JSON.parse(String(calls[0]?.options.body))).toEqual({
    paymentId,
    amountMinor: 500,
    currency: 'USD',
    reason: 'Customer request',
  });
});

test('rejects malformed pagination, payment identifiers and refund values before transport', () => {
  expect(() => fetchBillingDocumentsPage({ limit: 51 })).toThrow('Billing page size');
  expect(() => fetchPaymentHistoryPage({ cursor: 'x'.repeat(513) })).toThrow('Billing cursor');
  expect(() => requestPaymentRefund('pay_invalid', 100, 'USD', 'refund_1')).toThrow('valid payment ID');
  expect(() => requestPaymentRefund('pay_' + 'a'.repeat(26), 0, 'USD', 'refund_1')).toThrow('positive integer');
  expect(() => requestPaymentRefund('pay_' + 'a'.repeat(26), 100, 'usd', 'refund_1')).toThrow('ISO currency');
  expect(() => requestPaymentRefund('pay_' + 'a'.repeat(26), 100, 'USD', 'bad key')).toThrow('idempotency key');
  expect(() => requestPaymentRefund('pay_' + 'a'.repeat(26), 100, 'USD', 'refund_1', 'bad\nreason'))
    .toThrow('Refund reason');
  expect(calls).toHaveLength(0);
});

test('connects billing history, refund requests and authenticated navigation in the APP', () => {
  const screen = readFileSync(new URL('../app/(drawer)/billing.tsx', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../app/(drawer)/_layout.tsx', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../../.github/workflows/app-mobile-ci.yml', import.meta.url), 'utf8');

  expect(screen).toContain('fetchBillingDocumentsPage');
  expect(screen).toContain('fetchPaymentHistoryPage');
  expect(screen).toContain('fetchRefundHistoryPage');
  expect(screen).toContain('requestPaymentRefund');
  expect(screen).toContain('REFUND_PENDING_STATUSES');
  expect(screen).toContain('支付服务商的签名回调');
  expect(drawer).toContain("router.push('/billing' as never)");
  expect(drawer).toContain('name="billing"');
  expect(workflow).toContain('bun run test:billing-api');
});
