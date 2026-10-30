import { describe, expect, it } from 'vitest';
import {
  persistHyperswitchRefundWebhook,
  type RefundWebhookReceipt,
} from './refund-webhook-persistence.js';

const MERCHANT = 'merchant_1';
const PAYMENT_ID = 'pay_' + 'a'.repeat(26);
const REFUND_ID = 'ref_' + 'r'.repeat(26);
const HASH = 'a'.repeat(64);

type RefundFixture = {
  refund_id: string;
  merchant_id: string;
  customer_id: string;
  order_id: string;
  payment_id: string;
  amount_minor: number;
  currency: string;
  status: 'REQUESTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REVIEW' | 'RECONCILIATION_REQUIRED';
  version: number;
  provider_updated_at: string | null;
};

class FakeStatement {
  values: unknown[] = [];
  constructor(readonly sql: string, readonly owner: FakeD1) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() {
    if (this.sql.includes('FROM refunds WHERE refund_id')) {
      return this.owner.refund as T | null;
    }
    if (this.sql.includes('FROM payment_provider_events')) {
      return {
        event_row_id: 'evtrow_test',
        state: this.owner.receiptState,
        outcome_code: null,
      } as T;
    }
    return null;
  }
}

class FakeD1 {
  statements: FakeStatement[] = [];
  receiptState: 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED' | 'RECEIVED' = 'RECEIVED';
  refund: RefundFixture | null;
  constructor(refund: RefundFixture | null) { this.refund = refund; }
  prepare(sql: string) {
    const statement = new FakeStatement(sql, this);
    this.statements.push(statement);
    return statement;
  }
  async batch(statements: FakeStatement[]) {
    const apply = statements.some((statement) => statement.sql.includes('UPDATE refunds SET status'));
    this.receiptState = apply ? 'APPLIED' : 'RECONCILIATION_REQUIRED';
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }
}

const refund = (overrides: Partial<RefundFixture> = {}): RefundFixture => ({
  refund_id: REFUND_ID,
  merchant_id: MERCHANT,
  customer_id: 'customer_1',
  order_id: 'ord_1',
  payment_id: PAYMENT_ID,
  amount_minor: 300,
  currency: 'USD',
  status: 'PENDING',
  version: 2,
  provider_updated_at: '2026-10-30T10:00:00.000Z',
  ...overrides,
});

const envelope = (overrides: {
  eventType?: string;
  contentType?: string;
  resource?: Record<string, unknown>;
} = {}) => ({
  merchantId: MERCHANT,
  eventId: 'evt_refund_1',
  eventType: (overrides.eventType ?? 'refund_succeeded') as 'refund_succeeded',
  contentType: (overrides.contentType ?? 'refund_details') as 'refund_details',
  resource: overrides.resource ?? {
    refund_id: REFUND_ID,
    payment_id: PAYMENT_ID,
    merchant_id: MERCHANT,
    amount: 300,
    currency: 'USD',
    status: 'succeeded',
    updated: '2026-10-30T10:00:01.000Z',
  },
});

const run = async (
  db: FakeD1,
  e = envelope(),
): Promise<RefundWebhookReceipt> => persistHyperswitchRefundWebhook(
  db as unknown as D1Database,
  e,
  HASH,
  {
    now: () => new Date('2026-10-30T10:00:02.000Z'),
    createEventRowId: () => 'evtrow_test',
  },
);

describe('D1-04 signed Hyperswitch refund webhook persistence', () => {
  it('applies a matching succeeded refund and advances the local refund version by CAS', async () => {
    const db = new FakeD1(refund());
    const result = await run(db);
    expect(result).toMatchObject({
      outcome: 'APPLIED',
      state: 'APPLIED',
      eventId: 'evt_refund_1',
      receiptId: 'evtrow_test',
    });
    const update = db.statements.find((statement) => statement.sql.includes('UPDATE refunds SET status'));
    expect(update?.values).toEqual([
      'SUCCEEDED',
      '2026-10-30T10:00:01.000Z',
      '2026-10-30T10:00:02.000Z',
      REFUND_ID,
      2,
      MERCHANT,
      PAYMENT_ID,
      300,
      'USD',
    ]);
  });

  it('persists a reconciliation receipt, not a financial state change, for an unknown refund', async () => {
    const db = new FakeD1(null);
    const result = await run(db);
    expect(result.outcome).toBe('RECONCILIATION_REQUIRED');
    expect(db.statements.some((statement) => statement.sql.includes('UPDATE refunds SET status'))).toBe(false);
  });

  it('does not apply a provider event with a different amount or payment identity', async () => {
    const db = new FakeD1(refund());
    const result = await run(db, envelope({ resource: {
      refund_id: REFUND_ID,
      payment_id: PAYMENT_ID,
      merchant_id: MERCHANT,
      amount: 301,
      currency: 'USD',
      status: 'succeeded',
      updated: '2026-10-30T10:00:01.000Z',
    } }));
    expect(result.outcome).toBe('RECONCILIATION_REQUIRED');
    expect(db.statements.some((statement) => statement.sql.includes('UPDATE refunds SET status'))).toBe(false);
  });

  it('rejects stale provider timestamps from regressing a refund', async () => {
    const db = new FakeD1(refund({ provider_updated_at: '2026-10-30T10:00:01.000Z' }));
    const result = await run(db);
    expect(result.outcome).toBe('RECONCILIATION_REQUIRED');
    expect(db.statements.some((statement) => statement.sql.includes('UPDATE refunds SET status'))).toBe(false);
  });

  it('does not allow a failed final refund to be reopened as succeeded', async () => {
    const db = new FakeD1(refund({ status: 'FAILED' }));
    const result = await run(db);
    expect(result.outcome).toBe('RECONCILIATION_REQUIRED');
    expect(db.statements.some((statement) => statement.sql.includes('UPDATE refunds SET status'))).toBe(false);
  });

  it('maps review and failed events only when the resource status agrees with the event type', async () => {
    const reviewDb = new FakeD1(refund());
    const review = await run(reviewDb, envelope({
      eventType: 'refund_review',
      resource: {
        refund_id: REFUND_ID, payment_id: PAYMENT_ID, merchant_id: MERCHANT,
        amount: 300, currency: 'USD', status: 'review', updated: '2026-10-30T10:00:01.000Z',
      },
    }));
    expect(review.outcome).toBe('APPLIED');
    const invalidDb = new FakeD1(refund());
    const invalid = await run(invalidDb, envelope({
      eventType: 'refund_failed',
      resource: {
        refund_id: REFUND_ID, payment_id: PAYMENT_ID, merchant_id: MERCHANT,
        amount: 300, currency: 'USD', status: 'succeeded', updated: '2026-10-30T10:00:01.000Z',
      },
    }));
    expect(invalid.outcome).toBe('RECONCILIATION_REQUIRED');
  });
});
