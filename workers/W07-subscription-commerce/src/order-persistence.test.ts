import { describe, expect, it } from 'vitest';
import {
  createCommerceOrder,
  getCommerceOrder,
  OrderPersistenceError,
  type AuthoritativelyPricedOrder,
  type OrderPersistenceDependencies,
} from './order-persistence.js';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const request = { items: [{ itemRef: 'plan_abc', quantity: 1 }] };

type IdemRow = {
  id: string; customer_id: string; operation_key: string; idempotency_key: string;
  request_hash: string; state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_status: number | null; response_json: string | null; created_at: string; expires_at: string;
};
type Row = Record<string, unknown>;
type State = { idempotency: IdemRow[]; orders: Row[]; lines: Row[] };

const clone = <T>(value: T): T => structuredClone(value);
const scopeKey = (customer: unknown, operation: unknown, key: unknown): string =>
  JSON.stringify([customer, operation, key]);

class MemoryStatement {
  values: unknown[] = [];
  constructor(readonly db: MemoryD1, readonly sql: string) {}
  bind(...values: unknown[]): D1PreparedStatement { this.values = values; return this as unknown as D1PreparedStatement; }
  async first<T>(): Promise<T | null> { return this.db.first<T>(this.sql, this.values); }
  async all<T>(): Promise<D1Result<T[]>> { return this.db.all<T>(this.sql, this.values); }
  async run<T>(): Promise<D1Result<T>> { throw new Error('Unexpected standalone run in persistence candidate'); }
}

class MemoryD1 {
  state: State = { idempotency: [], orders: [], lines: [] };
  failOnLineInsert = false;
  firstCalls = 0;
  batchCalls = 0;
  prepare(sql: string): D1PreparedStatement {
    return new MemoryStatement(this, sql) as unknown as D1PreparedStatement;
  }

  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    this.firstCalls += 1;
    if (sql.includes('FROM order_create_idempotency')) {
      const [customer, operation, key] = values;
      const row = this.state.idempotency.find((r) =>
        scopeKey(r.customer_id, r.operation_key, r.idempotency_key) === scopeKey(customer, operation, key));
      return row ? clone(row) as T : null;
    }
    if (sql.includes('FROM orders WHERE order_id = ? AND customer_id = ?')) {
      const [orderId, customer] = values;
      const row = this.state.orders.find((r) => r.order_id === orderId && r.customer_id === customer);
      return row ? clone(row) as T : null;
    }
    throw new Error('Unexpected first query: ' + sql);
  }

  async all<T>(sql: string, values: unknown[]): Promise<D1Result<T[]>> {
    if (!sql.includes('FROM order_lines WHERE order_id = ?')) throw new Error('Unexpected all query: ' + sql);
    const [orderId] = values;
    const results = this.state.lines.filter((r) => r.order_id === orderId)
      .sort((a, b) => String(a.order_line_id).localeCompare(String(b.order_line_id)));
    return { success: true, results: clone(results) as T[], meta: {} } as D1Result<T[]>;
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCalls += 1;
    const working = clone(this.state);
    const results: D1Result[] = [];
    for (const unknownStatement of statements as unknown as MemoryStatement[]) {
      const { sql, values } = unknownStatement;
      let changes = 0;
      if (sql.includes('pay002:expire')) {
        const [customer, operation, key, now] = values as string[];
        const before = working.idempotency.length;
        working.idempotency = working.idempotency.filter((r) =>
          !(r.customer_id === customer && r.operation_key === operation &&
            r.idempotency_key === key && r.expires_at <= now));
        changes = before - working.idempotency.length;
      } else if (sql.includes('pay002:claim')) {
        const [id, customer_id, operation_key, idempotency_key, request_hash, created_at, expires_at] = values as string[];
        const exists = working.idempotency.some((r) =>
          scopeKey(r.customer_id, r.operation_key, r.idempotency_key) === scopeKey(customer_id, operation_key, idempotency_key));
        if (!exists) {
          working.idempotency.push({ id, customer_id, operation_key, idempotency_key, request_hash,
            state: 'IN_PROGRESS', response_status: null, response_json: null, created_at, expires_at });
          changes = 1;
        }
      } else if (sql.includes('pay002:complete')) {
        const [response_json, id, customer, operation, key, request_hash] = values as string[];
        const row = working.idempotency.find((r) => r.id === id && r.customer_id === customer &&
          r.operation_key === operation && r.idempotency_key === key && r.request_hash === request_hash &&
          r.state === 'IN_PROGRESS');
        if (row) { row.state = 'COMPLETED'; row.response_status = 201; row.response_json = response_json; changes = 1; }
      } else if (sql.includes('pay002:order')) {
        const [order_id, customer_id, currency, subtotal_minor, discount_minor, tax_minor,
          total_minor, created_at, updated_at, idemId, idemCustomer, operation, key, requestHash, responseJson] = values;
        const claim = working.idempotency.find((r) => r.id === idemId && r.customer_id === idemCustomer &&
          r.operation_key === operation && r.idempotency_key === key && r.request_hash === requestHash &&
          r.state === 'COMPLETED' && r.response_json === responseJson);
        if (claim) {
          working.orders.push({ order_id, customer_id, status: 'CREATED', version: 1, currency,
            subtotal_minor, discount_minor, tax_minor, total_minor, created_at, updated_at,
            confirmed_at: null, cancelled_at: null, failure_code: null });
          changes = 1;
        }
      } else if (sql.includes('pay002:line')) {
        if (this.failOnLineInsert) throw new Error('Injected database constraint failure');
        const [order_line_id, order_id, item_type, item_ref, item_version, quantity, unit_amount_minor,
          line_subtotal_minor, line_discount_minor, line_tax_minor, line_total_minor, item_snapshot_json,
          created_at, parentId, parentCustomer] = values;
        if (working.orders.some((r) => r.order_id === parentId && r.customer_id === parentCustomer)) {
          working.lines.push({ order_line_id, order_id, item_type, item_ref, item_version, quantity,
            unit_amount_minor, line_subtotal_minor, line_discount_minor, line_tax_minor,
            line_total_minor, item_snapshot_json, created_at });
          changes = 1;
        }
      } else {
        throw new Error('Unexpected batch statement: ' + sql);
      }
      results.push({ success: true, meta: { changes } } as D1Result);
    }
    this.state = working;
    return results;
  }
}

const pricingFor = async (req: { items: readonly { itemRef: string; quantity: number }[] }): Promise<AuthoritativelyPricedOrder> => ({
  currency: 'USD',
  items: req.items.map((item) => ({
    itemType: 'MEMBERSHIP_PLAN',
    itemRef: item.itemRef,
    itemVersion: '1',
    quantity: item.quantity,
    unitAmountMinor: 1200,
    currency: 'USD',
    lineDiscountMinor: 0, // Explicitly supplied by the pricing authority for this test fixture.
    lineTaxMinor: 0, // Explicitly supplied by the pricing authority for this test fixture.
    itemSnapshotJson: JSON.stringify({ planId: item.itemRef, planVersion: 1 }),
  })),
});

const deterministicDependencies = (prefix: string, time = NOW): OrderPersistenceDependencies => {
  let id = 0;
  return { now: () => new Date(time), createId: (kind) => prefix + '_' + kind + '_' + (++id) };
};

const errorCode = (error: unknown): string => error instanceof OrderPersistenceError ? error.code : 'unexpected';

describe('PAY-002 atomic D1-04 order persistence candidate', () => {
  it('creates the Order, immutable priced lines and completed replay record in one batch', async () => {
    const db = new MemoryD1();
    const result = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'key_1', request,
      pricingFor, deterministicDependencies('one'));
    expect(result.status).toBe(201);
    expect(result.replayed).toBe(false);
    expect(result.data.totalMinor).toBe(1200);
    expect(db.batchCalls).toBe(1);
    expect(db.state.orders).toHaveLength(1);
    expect(db.state.lines).toHaveLength(1);
    expect(db.state.idempotency).toHaveLength(1);
    expect(db.state.idempotency[0]?.state).toBe('COMPLETED');
    expect(JSON.parse(db.state.idempotency[0]?.response_json ?? '{}')).toEqual(result.data);
    expect(JSON.stringify(db.state.idempotency[0]?.response_json)).not.toContain('requestId');
    expect(JSON.stringify(db.state.idempotency[0]?.response_json)).not.toContain('customerId');
  });

  it('stores and reads Demo pricing mode from immutable line snapshots', async () => {
    const db = new MemoryD1();
    const demoPricing: typeof pricingFor = async (req) => ({
      currency: 'USD',
      pricingMode: 'demo',
      items: req.items.map((item) => ({
        itemType: 'MEMBERSHIP_PLAN',
        itemRef: item.itemRef,
        itemVersion: '1',
        quantity: item.quantity,
        unitAmountMinor: 1200,
        currency: 'USD',
        lineDiscountMinor: 0,
        lineTaxMinor: 60,
        itemSnapshotJson: JSON.stringify({
          planId: item.itemRef,
          planVersion: 1,
          luckreadPricing: { mode: 'demo', taxProvider: 'luckread-demo-fixed-rate', taxMinor: 60 },
        }),
      })),
    });
    const result = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'demo_key', request,
      demoPricing, deterministicDependencies('demo'));
    expect(result.data).not.toHaveProperty('pricingMode');
    expect(result.data.taxMinor).toBe(60);
    expect(db.state.lines).toHaveLength(1);
    const storedSnapshot = JSON.parse(String(db.state.lines[0]?.item_snapshot_json)) as Record<string, any>;
    expect(storedSnapshot.luckreadPricing).toMatchObject({ mode: 'demo', taxProvider: 'luckread-demo-fixed-rate', taxMinor: 60 });
    const fetched = await getCommerceOrder(db as unknown as D1Database, 'user_1', result.data.orderId);
    expect(fetched).not.toHaveProperty('pricingMode');
    expect(fetched.taxMinor).toBe(60);
  });

  it('replays a completed request without resolving a now-retired offer or writing again', async () => {
    const db = new MemoryD1();
    const first = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'key_1', request,
      pricingFor, deterministicDependencies('first'));
    let resolverCalls = 0;
    const replay = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'key_1', request,
      async () => { resolverCalls += 1; throw new Error('offer should not be re-resolved on a replay'); },
      deterministicDependencies('second'));
    expect(replay.replayed).toBe(true);
    expect(replay.data.orderId).toBe(first.data.orderId);
    expect(replay.data).toEqual(first.data);
    expect(resolverCalls).toBe(0);
    expect(db.batchCalls).toBe(1);
    expect(db.state.orders).toHaveLength(1);
  });

  it('replays the same basket when the client changes item array order', async () => {
    const db = new MemoryD1();
    const firstRequest = { items: [
      { itemRef: 'plan_b', quantity: 1 },
      { itemRef: 'plan_a', quantity: 2 },
    ] };
    const reorderedRequest = { items: [
      { itemRef: 'plan_a', quantity: 2 },
      { itemRef: 'plan_b', quantity: 1 },
    ] };
    let resolverCalls = 0;
    const resolver = async (req: { items: readonly { itemRef: string; quantity: number }[] }) => {
      resolverCalls += 1;
      return pricingFor(req);
    };

    const first = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'basket_order',
      firstRequest, resolver, deterministicDependencies('first'));
    const replay = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'basket_order',
      reorderedRequest, resolver, deterministicDependencies('retry'));

    expect(replay.replayed).toBe(true);
    expect(replay.data).toEqual(first.data);
    expect(resolverCalls).toBe(1);
    expect(db.batchCalls).toBe(1);
    expect(db.state.orders).toHaveLength(1);
    expect(db.state.lines).toHaveLength(2);
  });

  it('rejects same-key semantic payload changes before authoritative resolution', async () => {
    const db = new MemoryD1();
    await createCommerceOrder(db as unknown as D1Database, 'user_1', 'key_1', request,
      pricingFor, deterministicDependencies('first'));
    let resolverCalls = 0;
    const error = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'key_1',
      { items: [{ itemRef: 'plan_abc', quantity: 2 }] },
      async () => { resolverCalls += 1; return await pricingFor(request); },
      deterministicDependencies('second')).then(() => null, (e: unknown) => e);
    expect(errorCode(error)).toBe('IDEMPOTENCY_KEY_REUSE_CONFLICT');
    expect(resolverCalls).toBe(0);
    expect(db.state.orders).toHaveLength(1);
  });

  it('does not expose another customer order through owner-scoped reads', async () => {
    const db = new MemoryD1();
    const created = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'key_1', request,
      pricingFor, deterministicDependencies('first'));
    const error = await getCommerceOrder(db as unknown as D1Database, 'user_2', created.data.orderId)
      .then(() => null, (e: unknown) => e);
    expect(errorCode(error)).toBe('RESOURCE_NOT_FOUND');
    expect(await getCommerceOrder(db as unknown as D1Database, 'user_1', created.data.orderId)).toEqual(created.data);
  });

  it('rolls back the claim and order if any line insert fails in the atomic batch', async () => {
    const db = new MemoryD1();
    db.failOnLineInsert = true;
    const error = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'key_1', request,
      pricingFor, deterministicDependencies('fail')).then(() => null, (e: unknown) => e);
    expect(error).not.toBeNull();
    expect(db.state.idempotency).toHaveLength(0);
    expect(db.state.orders).toHaveLength(0);
    expect(db.state.lines).toHaveLength(0);
    db.failOnLineInsert = false;
    const retry = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'key_1', request,
      pricingFor, deterministicDependencies('retry'));
    expect(retry.replayed).toBe(false);
    expect(db.state.orders).toHaveLength(1);
  });

  it('serializes concurrent identical submissions to one durable Order', async () => {
    const db = new MemoryD1();
    const asyncPricing = async (req: { items: readonly { itemRef: string; quantity: number }[] }) => {
      await Promise.resolve();
      return pricingFor(req);
    };
    const results = await Promise.all([
      createCommerceOrder(db as unknown as D1Database, 'user_1', 'same_key', request, asyncPricing, deterministicDependencies('a')),
      createCommerceOrder(db as unknown as D1Database, 'user_1', 'same_key', request, asyncPricing, deterministicDependencies('b')),
    ]);
    expect(db.state.orders).toHaveLength(1);
    expect(db.state.lines).toHaveLength(1);
    expect(results[1].data.orderId).toBe(results[0].data.orderId);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
  });

  it('rejects missing idempotency keys and malformed DTOs without touching D1', async () => {
    const db = new MemoryD1();
    const noKey = await createCommerceOrder(db as unknown as D1Database, 'user_1', null, request, pricingFor)
      .then(() => null, (e: unknown) => e);
    expect(errorCode(noKey)).toBe('PRECONDITION_REQUIRED');
    const badBody = await createCommerceOrder(db as unknown as D1Database, 'user_1', 'key_1',
      { items: [], customerId: 'attacker' }, pricingFor).then(() => null, (e: unknown) => e);
    expect(errorCode(badBody)).toBe('VALIDATION_FAILED');
    expect(db.firstCalls).toBe(0);
    expect(db.batchCalls).toBe(0);
  });
});
