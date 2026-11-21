import { describe, expect, it } from 'vitest';
import {
  createCommerceOrder,
  OrderPersistenceError,
  type AuthoritativelyPricedOrder,
  type OrderCreateIdempotencyRow,
  type OrderCreatePersistenceStore,
  type OrderCreateTransactionInput,
  type OrderPersistenceDependencies,
} from './order-persistence.js';

const NOW = new Date('2026-11-19T12:00:00.000Z');
const request = { items: [{ itemRef: 'plan_abc', quantity: 1 }] };

const pricingFor = async (
  input: { items: readonly { itemRef: string; quantity: number }[] },
): Promise<AuthoritativelyPricedOrder> => ({
  currency: 'USD',
  items: input.items.map((item) => ({
    itemType: 'MEMBERSHIP_PLAN',
    itemRef: item.itemRef,
    itemVersion: '1',
    quantity: item.quantity,
    unitAmountMinor: 1200,
    currency: 'USD',
    lineDiscountMinor: 0,
    lineTaxMinor: 0,
    itemSnapshotJson: JSON.stringify({ planId: item.itemRef, planVersion: 1 }),
  })),
});

function deterministicDependencies(prefix: string): OrderPersistenceDependencies {
  let id = 0;
  return {
    now: () => new Date(NOW),
    createId: (kind) => prefix + '_' + kind + '_' + (++id),
  };
}

function memoryStore(options: { loseClaim?: boolean } = {}) {
  let row: OrderCreateIdempotencyRow | null = null;
  let persistCalls = 0;
  let lastInput: OrderCreateTransactionInput | null = null;

  const store: OrderCreatePersistenceStore = {
    async readIdempotencyRow(customerId, idempotencyKey) {
      if (!row || row.customer_id !== customerId || row.idempotency_key !== idempotencyKey) return null;
      return { ...row };
    },
    async persistNewOrder(input) {
      persistCalls += 1;
      lastInput = input;
      row = {
        id: input.idempotencyId,
        customer_id: input.customerId,
        operation_key: input.operationKey,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        state: 'COMPLETED',
        response_status: 201,
        response_json: input.responseJson,
        created_at: input.createdAt,
        expires_at: input.expiresAt,
      };
      return {
        statementCount: input.lines.length + 4,
        expireChanges: 0,
        claimChanges: options.loseClaim ? 0 : 1,
        completionChanges: options.loseClaim ? 0 : 1,
        orderChanges: options.loseClaim ? 0 : 1,
        lineChanges: options.loseClaim ? [] : input.lines.map(() => 1),
      };
    },
  };

  return {
    store,
    get persistCalls() { return persistCalls; },
    get lastInput() { return lastInput; },
    get row() { return row ? { ...row } : null; },
  };
}

describe('PAY-002 order creation with the Neon persistence contract', () => {
  it('persists authoritative order values and a completed replay record through the injected store', async () => {
    const fixture = memoryStore();
    const result = await createCommerceOrder(
      fixture.store, 'customer_1', 'key_1', request, pricingFor, deterministicDependencies('first'),
    );

    expect(result).toMatchObject({
      status: 201,
      replayed: false,
      data: { status: 'CREATED', currency: 'USD', totalMinor: 1200 },
    });
    expect(fixture.persistCalls).toBe(1);
    expect(fixture.lastInput?.order.totalMinor).toBe(1200);
    expect(fixture.lastInput?.lines).toHaveLength(1);
    expect(fixture.row).toMatchObject({
      state: 'COMPLETED',
      response_status: 201,
      response_json: JSON.stringify(result.data),
    });
    expect(fixture.row?.response_json).not.toContain('customerId');
    expect(fixture.row?.response_json).not.toContain('requestId');
  });

  it('replays the persisted response without resolving prices or writing again', async () => {
    const fixture = memoryStore();
    const first = await createCommerceOrder(
      fixture.store, 'customer_1', 'key_1', request, pricingFor, deterministicDependencies('first'),
    );
    const replay = await createCommerceOrder(
      fixture.store,
      'customer_1',
      'key_1',
      request,
      async () => { throw new Error('pricing must not run for an idempotent replay'); },
      deterministicDependencies('replay'),
    );

    expect(replay).toEqual({ ...first, replayed: true });
    expect(fixture.persistCalls).toBe(1);
  });

  it('rejects reuse of one idempotency key for a different canonical basket', async () => {
    const fixture = memoryStore();
    await createCommerceOrder(
      fixture.store, 'customer_1', 'key_1', request, pricingFor, deterministicDependencies('first'),
    );

    await expect(createCommerceOrder(
      fixture.store,
      'customer_1',
      'key_1',
      { items: [{ itemRef: 'plan_other', quantity: 1 }] },
      pricingFor,
      deterministicDependencies('second'),
    )).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT',
      status: 409,
    });
    expect(fixture.persistCalls).toBe(1);
  });

  it('returns the winner response when a concurrent transaction claims the idempotency key first', async () => {
    const fixture = memoryStore({ loseClaim: true });
    const result = await createCommerceOrder(
      fixture.store, 'customer_1', 'key_1', request, pricingFor, deterministicDependencies('race'),
    );

    expect(result.status).toBe(201);
    expect(result.replayed).toBe(true);
    expect(fixture.persistCalls).toBe(1);
  });

  it('rejects zero-payable orders before asking the store to persist', async () => {
    const fixture = memoryStore();
    const zeroPricing: typeof pricingFor = async (input) => ({
      currency: 'USD',
      items: input.items.map((item) => ({
        itemType: 'MEMBERSHIP_PLAN',
        itemRef: item.itemRef,
        itemVersion: '1',
        quantity: item.quantity,
        unitAmountMinor: 0,
        currency: 'USD',
        lineDiscountMinor: 0,
        lineTaxMinor: 0,
        itemSnapshotJson: JSON.stringify({ planId: item.itemRef, planVersion: 1 }),
      })),
    });

    await expect(createCommerceOrder(
      fixture.store, 'customer_1', 'zero_key', request, zeroPricing, deterministicDependencies('zero'),
    )).rejects.toBeInstanceOf(OrderPersistenceError);
    expect(fixture.persistCalls).toBe(0);
  });

  it('fails closed for an in-progress idempotency record', async () => {
    const fixture = memoryStore();
    await createCommerceOrder(
      fixture.store, 'customer_1', 'key_1', request, pricingFor, deterministicDependencies('first'),
    );
    const current = fixture.row!;
    current.state = 'IN_PROGRESS';
    const inProgressStore: OrderCreatePersistenceStore = {
      readIdempotencyRow: async () => ({ ...current }),
      persistNewOrder: async () => { throw new Error('an in-progress key must not be written again'); },
    };

    await expect(createCommerceOrder(
      inProgressStore, 'customer_1', 'key_1', request, pricingFor, deterministicDependencies('blocked'),
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS', status: 409 });
  });
});
