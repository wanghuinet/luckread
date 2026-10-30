import { describe, expect, it } from 'vitest';
import {
  recordHyperswitchRefundAcknowledgement,
  type RefundDto,
} from './refund-persistence.js';
import type { HyperswitchRefund } from './hyperswitch-client.js';

const NOW = '2026-10-30T10:00:00.000Z';
const LATER = '2026-10-30T10:00:01.000Z';
const REFUND_ID = 'ref_' + 'r'.repeat(26);
const PAYMENT_ID = 'pay_' + 'p'.repeat(26);

type Row = {
  refund_id: string;
  merchant_id: string;
  customer_id: string;
  order_id: string;
  payment_id: string;
  amount_minor: number;
  captured_amount_minor: number;
  currency: string;
  status: string;
  reason: string | null;
  idempotency_key: string;
  request_hash: string;
  provider_updated_at: string | null;
  outcome_code: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

class FakeStatement {
  values: unknown[] = [];
  constructor(private readonly db: FakeD1, readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return this.db.row as T; }
  async run() {
    this.db.updateSql = this.sql;
    this.db.updateValues = this.values;
    const [status, outcomeCode, updatedAt] = this.values as [string, string | null, string];
    this.db.row = {
      ...this.db.row,
      status,
      outcome_code: outcomeCode,
      version: this.db.row.version + 1,
      updated_at: updatedAt,
    };
    return { meta: { changes: 1 } };
  }
}

class FakeD1 {
  row: Row = {
    refund_id: REFUND_ID,
    merchant_id: 'merchant_1',
    customer_id: 'customer_1',
    order_id: 'ord_1',
    payment_id: PAYMENT_ID,
    amount_minor: 300,
    captured_amount_minor: 700,
    currency: 'USD',
    status: 'REQUESTED',
    reason: null,
    idempotency_key: 'refund_key_1',
    request_hash: 'a'.repeat(64),
    provider_updated_at: null,
    outcome_code: null,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
  };
  updateSql = '';
  updateValues: unknown[] = [];
  prepare(sql: string) { return new FakeStatement(this, sql); }
}

describe('refund persistence provider authority boundary', () => {
  it('does not persist an unsigned create-API timestamp; the signed webhook owns provider_updated_at', async () => {
    const db = new FakeD1();
    const apiAcknowledgement: HyperswitchRefund = {
      refundId: REFUND_ID,
      paymentId: PAYMENT_ID,
      amount: 300,
      currency: 'USD',
      status: 'pending',
      updatedAt: NOW,
    };

    const result = await recordHyperswitchRefundAcknowledgement(
      db as unknown as D1Database,
      apiAcknowledgement,
      { now: () => new Date(LATER) },
    );

    expect(db.updateSql).toContain('UPDATE refunds SET status')
    expect(db.updateSql).not.toContain('provider_updated_at')
    expect(db.updateValues).toEqual(['PENDING', null, LATER, REFUND_ID, 1])
    expect(result).toMatchObject<Partial<RefundDto>>({
      refundId: REFUND_ID,
      status: 'PENDING',
      providerUpdatedAt: null,
      version: 2,
      updatedAt: LATER,
    })
    expect(db.row.provider_updated_at).toBeNull()
  })
})
