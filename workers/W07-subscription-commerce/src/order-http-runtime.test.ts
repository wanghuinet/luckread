import { describe, expect, it } from 'vitest';
import {
  createCommerceOrder,
  getCommerceOrder,
  OrderPersistenceError,
  type CreateOrderResult,
  type CommerceOrderData,
  type AuthoritativelyPricedOrder,
} from './order-persistence.js';
import { handleCommerceOrderRequest } from './order-http-runtime.js';
import { issueInvoiceForOrder } from './billing-persistence.js';

const env = {
  D1_01: {} as D1Database,
  D1_04: {} as D1Database,
};

const orderData: CommerceOrderData = {
  orderId: 'ord_test_1',
  status: 'CREATED',
  version: 1,
  currency: 'USD',
  subtotalMinor: 1200,
  discountMinor: 0,
  taxMinor: 0,
  totalMinor: 1200,
  items: [{
    itemRef: 'plan_' + 'a'.repeat(64),
    quantity: 1,
    unitAmountMinor: 1200,
    lineSubtotalMinor: 1200,
    lineDiscountMinor: 0,
    lineTaxMinor: 0,
    lineTotalMinor: 1200,
  }],
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
};

const createResult: CreateOrderResult = { data: orderData, status: 201, replayed: false };

// Only supplied in tests. Production remains fail-closed until a reviewed
// authoritative discount/tax assessment adapter is wired into W07.
const explicitTestPricing: AuthoritativelyPricedOrder = {
  currency: 'USD',
  items: [{
    itemType: 'MEMBERSHIP_PLAN',
    itemRef: 'plan_' + 'a'.repeat(64),
    itemVersion: '1',
    quantity: 1,
    unitAmountMinor: 1200,
    currency: 'USD',
    lineDiscountMinor: 0,
    lineTaxMinor: 0,
    itemSnapshotJson: JSON.stringify({ planId: 'plan_' + 'a'.repeat(64), planVersion: 1 }),
  }],
};

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://luckread-w07.internal/commerce/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function parseResponse(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('private W07 commerce order HTTP handler', () => {
  it('does not claim routes outside the commerce order namespace', async () => {
    expect(await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/plans'),
      'user_1',
      env,
    )).toBeNull();
  });

  it('creates an order using the authenticated principal, bounded request body, and forwarded idempotency key', async () => {
    let captured: Parameters<typeof createCommerceOrder> | undefined;
    let invoiceCall: Parameters<typeof issueInvoiceForOrder> | undefined;
    const mockCreate = (async (...args: Parameters<typeof createCommerceOrder>) => {
      captured = args;
      return createResult;
    }) as typeof createCommerceOrder;
    const mockInvoice = (async (...args: Parameters<typeof issueInvoiceForOrder>) => {
      invoiceCall = args;
      return {} as Awaited<ReturnType<typeof issueInvoiceForOrder>>;
    }) as typeof issueInvoiceForOrder;

    const response = await handleCommerceOrderRequest(
      postRequest({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] }, {
        'Idempotency-Key': 'purchase_attempt_01',
      }),
      'user_42',
      env,
      { createOrder: mockCreate, issueInvoice: mockInvoice, resolvePricing: async () => explicitTestPricing },
    );

    expect(response?.status).toBe(201);
    expect(captured?.[1]).toBe('user_42');
    expect(captured?.[2]).toBe('purchase_attempt_01');
    expect(captured?.[3]).toEqual({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] })
    expect(invoiceCall?.slice(0, 2)).toEqual([env.D1_04, 'user_42'])
    expect(invoiceCall?.[2]).toBe(orderData.orderId);
    const envelope = await parseResponse(response!);
    expect(envelope.data).toEqual(orderData);
    expect(envelope.requestId).toMatch(/^req_/);
    expect(JSON.stringify(envelope)).not.toContain('customerId');
    expect(JSON.stringify(envelope)).not.toContain('itemSnapshotJson');
  });

  it('keeps order creation disabled when no authoritative discount/tax pricing adapter is wired', async () => {
    let writes = 0;
    const mockCreate = (async () => {
      writes += 1;
      return createResult;
    }) as unknown as typeof createCommerceOrder;
    const response = await handleCommerceOrderRequest(
      postRequest({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] }, {
        'Idempotency-Key': 'purchase_attempt_02',
      }),
      'user_42',
      env,
      { createOrder: mockCreate },
    );

    expect(response?.status).toBe(503);
    expect(await parseResponse(response!)).toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(writes).toBe(0);
  });

  it('fails closed on missing Idempotency-Key before attempting any D1 access', async () => {
    const response = await handleCommerceOrderRequest(
      postRequest({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] }),
      'user_42',
      env,
    );

    expect(response?.status).toBe(428);
    expect(await parseResponse(response!)).toMatchObject({
      error: { code: 'PRECONDITION_REQUIRED' },
    });
  });

  it('rejects malformed JSON and non-JSON content types before calling persistence', async () => {
    const malformed = new Request('https://luckread-w07.internal/commerce/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'key_01' },
      body: '{"items":',
    });
    const malformedResponse = await handleCommerceOrderRequest(malformed, 'user_42', env);
    expect(malformedResponse?.status).toBe(400);
    expect(await parseResponse(malformedResponse!)).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });

    const wrongType = new Request('https://luckread-w07.internal/commerce/orders', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'Idempotency-Key': 'key_01' },
      body: '{"items":[]}',
    });
    expect((await handleCommerceOrderRequest(wrongType, 'user_42', env))?.status).toBe(400);
  });

  it('rejects oversized streamed bodies before invoking order persistence', async () => {
    let writes = 0;
    const mockCreate = (async () => {
      writes += 1;
      return createResult;
    }) as unknown as typeof createCommerceOrder;
    const response = await handleCommerceOrderRequest(
      postRequest({ padded: 'x'.repeat(17_000) }, { 'Idempotency-Key': 'key_01' }),
      'user_42',
      env,
      { createOrder: mockCreate },
    );
    expect(response?.status).toBe(400);
    expect(writes).toBe(0);
  });

  it('reads an order using the authenticated owner scope and emits only the admitted DTO', async () => {
    let captured: Parameters<typeof getCommerceOrder> | undefined;
    const mockGet = (async (...args: Parameters<typeof getCommerceOrder>) => {
      captured = args;
      return orderData;
    }) as typeof getCommerceOrder;
    const response = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders/ord_test_1'),
      'user_42',
      env,
      { getOrder: mockGet },
    );

    expect(response?.status).toBe(200);
    expect(captured?.[1]).toBe('user_42');
    expect(captured?.[2]).toBe('ord_test_1');
    const envelope = await parseResponse(response!);
    expect(envelope.data).toEqual(orderData);
    expect(JSON.stringify(envelope)).not.toContain('customer_id');
    expect(JSON.stringify(envelope)).not.toContain('item_snapshot_json');
  });

  it('maps owner-scoped not-found without leaking whether another user owns the order', async () => {
    const mockGet = (async () => {
      throw new OrderPersistenceError('RESOURCE_NOT_FOUND', 404);
    }) as unknown as typeof getCommerceOrder;
    const response = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders/ord_other'),
      'user_42',
      env,
      { getOrder: mockGet },
    );
    expect(response?.status).toBe(404);
    expect(await parseResponse(response!)).toMatchObject({
      error: { code: 'RESOURCE_NOT_FOUND', message: 'Order not found' },
    });
  });

  it('returns not-found for methods and paths outside the admitted create/read operations', async () => {
    const badMethod = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders/ord_test_1', { method: 'DELETE' }),
      'user_42',
      env,
    );
    expect(badMethod?.status).toBe(404);

    const badShape = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders'),
      'user_42',
      env,
    );
    expect(badShape?.status).toBe(404); // GET collection/list is not admitted by PAY-002.
  });

  it('maps an uninitialized remote schema to a generic unavailable response without leaking SQL details', async () => {
    const brokenD1 = {
      prepare() { throw new Error('no such table: orders; sensitive SQL'); },
    } as unknown as D1Database;
    const response = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders/ord_test_1'),
      'user_42',
      { ...env, D1_04: brokenD1 },
    );
    expect(response?.status).toBe(503);
    const envelope = await parseResponse(response!);
    expect(envelope).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(JSON.stringify(envelope)).not.toContain('no such table');
  });
});
