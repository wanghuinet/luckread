import { describe, expect, it } from 'vitest';
import {
  createRefundReservationPostgres,
  findExistingRefundReservationPostgres,
  recordHyperswitchRefundAcknowledgementPostgres,
  resolveRefundPaymentReferencePostgres,
} from './refund-postgres-persistence.js';
import { RefundPersistenceError } from './refund-persistence.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import type { HyperswitchRefund } from './hyperswitch-client.js';

const NOW = '2026-11-01T10:00:00.000Z';
const LATER = '2026-11-01T10:00:01.000Z';
const CUSTOMER = 'customer_001';
const MERCHANT = 'merchant_test';
const PAYMENT = 'pay_' + 'a'.repeat(26);
const ORDER = 'ord_1';
const REFUND = 'ref_' + 'r'.repeat(26);
const KEY = 'refund_1';

type StoredRefund = {
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

function fixture() {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const payment = {
    payment_id: PAYMENT,
    order_id: ORDER,
    customer_id: CUSTOMER,
    merchant_id: MERCHANT,
    provider: 'hyperswitch',
    amount_minor: 1000,
    currency: 'USD',
    status: 'succeeded',
  };
  let refund: StoredRefund | null = null;

  const pool: W07WebhookPostgresPool = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values: unknown[] = [],
    ) {
      statements.push({ sql, values });
      let rows: Record<string, unknown>[] = [];
      if (sql.includes('FROM payments')) {
        if (payment.payment_id === values[0] && payment.customer_id === values[1]) rows = [payment];
      } else if (sql.includes('FROM refunds') && sql.includes('customer_id = $1')) {
        if (refund?.customer_id === values[0] && refund.idempotency_key === values[1]) rows = [refund];
      } else if (sql.includes('FROM refunds') && sql.includes('refund_id = $2')) {
        if (refund?.refund_id === values[1] && values[0] === 'hyperswitch') rows = [refund];
      } else if (sql.startsWith('INSERT INTO refunds')) {
        const [refundId, provider, merchantId, customerId, orderId, paymentId, amountMinor,
          capturedAmountMinor, currency, reason, idempotencyKey, requestHash, createdAt] = values;
        refund = {
          refund_id: String(refundId),
          merchant_id: String(merchantId),
          customer_id: String(customerId),
          order_id: String(orderId),
          payment_id: String(paymentId),
          amount_minor: Number(amountMinor),
          captured_amount_minor: Number(capturedAmountMinor),
          currency: String(currency),
          status: 'REQUESTED',
          reason: reason == null ? null : String(reason),
          idempotency_key: String(idempotencyKey),
          request_hash: String(requestHash),
          provider_updated_at: null,
          outcome_code: null,
          version: 1,
          created_at: String(createdAt),
          updated_at: String(createdAt),
        };
        rows = [{ refund_id: String(refundId), provider }];
      } else if (sql.startsWith('UPDATE refunds')) {
        const [status, outcomeCode, updatedAt, refundId, version] = values;
        if (refund && refund.refund_id === refundId && refund.version === version &&
            ['REQUESTED', 'RECONCILIATION_REQUIRED'].includes(refund.status)) {
          refund = {
            ...refund,
            status: String(status),
            outcome_code: outcomeCode == null ? null : String(outcomeCode),
            version: refund.version + 1,
            updated_at: String(updatedAt),
          };
          rows = [{ refund_id: refund.refund_id }];
        }
      } else {
        throw new Error('Unexpected PostgreSQL query: ' + sql);
      }
      return { rows: rows as Row[], rowCount: rows.length };
    },
    async connect() {
      throw new Error('refund persistence uses single-statement writes and database triggers');
    },
  };

  return { pool, statements, readRefund: () => refund };
}

const lookup = {
  customerId: CUSTOMER,
  paymentId: PAYMENT,
  amountMinor: 300,
  currency: 'USD',
  reason: 'Customer request',
  idempotencyKey: KEY,
  expectedMerchantId: MERCHANT,
};

const reservation = {
  ...lookup,
  capturedAmountMinor: 700,
};

const providerRefund: HyperswitchRefund = {
  refundId: REFUND,
  paymentId: PAYMENT,
  amount: 300,
  currency: 'USD',
  status: 'pending',
  updatedAt: LATER,
};

describe('W07 native PostgreSQL refund persistence', () => {
  it('resolves only a customer-owned captured payment with the expected merchant', async () => {
    const f = fixture();
    await expect(resolveRefundPaymentReferencePostgres(
      f.pool, CUSTOMER, PAYMENT, MERCHANT,
    )).resolves.toEqual({
      paymentId: PAYMENT,
      orderId: ORDER,
      amountMinor: 1000,
      currency: 'USD',
      merchantId: MERCHANT,
    });
    expect(f.statements[0]?.sql).toContain('FROM payments WHERE payment_id = $1 AND customer_id = $2');
    expect(f.statements[0]?.sql).not.toContain('?');
  });

  it('reserves an idempotent refund and replays the stable refund ID without a second insert', async () => {
    const f = fixture();
    const created = await createRefundReservationPostgres(f.pool, reservation, {
      now: () => new Date(NOW),
      createRefundId: () => REFUND,
    });
    expect(created).toMatchObject({
      replayed: false,
      refund: {
        refundId: REFUND,
        paymentId: PAYMENT,
        orderId: ORDER,
        amountMinor: 300,
        capturedAmountMinor: 700,
        status: 'REQUESTED',
        version: 1,
      },
    });
    expect(f.statements.some((entry) => entry.sql.startsWith('INSERT INTO refunds'))).toBe(true);
    const replay = await findExistingRefundReservationPostgres(f.pool, lookup);
    expect(replay).toMatchObject({ replayed: true, refund: { refundId: REFUND } });
    expect(f.statements.filter((entry) => entry.sql.startsWith('INSERT INTO refunds'))).toHaveLength(1);
  });

  it('records provider acceptance as PENDING with a PostgreSQL version CAS, not as final success', async () => {
    const f = fixture();
    await createRefundReservationPostgres(f.pool, reservation, {
      now: () => new Date(NOW),
      createRefundId: () => REFUND,
    });
    const saved = await recordHyperswitchRefundAcknowledgementPostgres(
      f.pool, providerRefund, { now: () => new Date(LATER) },
    );
    expect(saved).toMatchObject({
      refundId: REFUND,
      status: 'PENDING',
      version: 2,
      updatedAt: LATER,
    });
    expect(f.statements.at(-2)?.sql).toContain('UPDATE refunds SET status = $1');
    expect(f.statements.at(-2)?.sql).toContain('version = version + 1');
    expect(f.statements.at(-2)?.sql).toContain('RETURNING refund_id');
  });

  it('rejects provider acknowledgement identity mismatches without mutating the reservation', async () => {
    const f = fixture();
    await createRefundReservationPostgres(f.pool, reservation, {
      now: () => new Date(NOW),
      createRefundId: () => REFUND,
    });
    await expect(recordHyperswitchRefundAcknowledgementPostgres(
      f.pool, { ...providerRefund, amount: 1 }, { now: () => new Date(LATER) },
    )).rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 });
    expect(f.readRefund()?.status).toBe('REQUESTED');
  });

  it('rejects invalid refund idempotency keys before any database read', async () => {
    const f = fixture();
    await expect(findExistingRefundReservationPostgres(f.pool, {
      ...lookup,
      idempotencyKey: 'invalid key',
    })).rejects.toBeInstanceOf(RefundPersistenceError);
    expect(f.statements).toHaveLength(0);
  });
});
