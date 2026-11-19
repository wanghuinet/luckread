import { describe, expect, it } from 'vitest';
import {
  createPaymentAttemptPostgres,
  recordHyperswitchMerchantInitiatedSubmissionPostgres,
  recordUnconfirmedHyperswitchIntentPostgres,
} from './payment-intent-postgres-persistence.js';
import { PaymentPersistenceError } from './payment-persistence.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';
import type { HyperswitchPayment } from './hyperswitch-client.js';

const NOW = '2026-11-01T10:00:00.000Z';
const LATER = '2026-11-01T10:00:01.000Z';
const CUSTOMER = 'user_1';
const ORDER = 'ord_1';
const MERCHANT = 'merchant_test';
const PAYMENT = 'pay_' + 'a'.repeat(26);
const IDEMPOTENCY = 'checkout_1';

type StoredPayment = {
  payment_id: string;
  order_id: string;
  customer_id: string;
  provider: string;
  merchant_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  version: number;
  idempotency_key: string;
  request_hash: string;
  provider_updated_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
};

function fixture() {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const order = {
    order_id: ORDER,
    customer_id: CUSTOMER,
    status: 'CREATED',
    currency: 'USD',
    total_minor: 1299,
    has_demo_pricing: 0,
  };
  let payment: StoredPayment | null = null;

  const pool: W07WebhookPostgresPool = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      values: unknown[] = [],
    ) {
      statements.push({ sql, values });
      let rows: Record<string, unknown>[] = [];
      if (sql.includes('FROM orders AS o')) {
        if (values[0] === ORDER && values[1] === CUSTOMER) rows = [order];
      } else if (sql.includes('FROM payments') && sql.includes('idempotency_key = $2')) {
        if (payment?.customer_id === values[0] && payment.idempotency_key === values[1]) rows = [payment];
      } else if (sql.includes('FROM payments') && sql.includes('order_id = $2')) {
        if (payment?.customer_id === values[0] && payment.order_id === values[1] &&
            !['failed', 'cancelled', 'cancelled_post_capture', 'expired'].includes(payment.status)) rows = [payment];
      } else if (sql.includes('FROM payments') && sql.includes('payment_id = $1')) {
        if (payment?.payment_id === values[0] && payment.customer_id === values[1]) rows = [payment];
      } else if (sql.startsWith('INSERT INTO payments')) {
        const [paymentId, orderId, customerId, merchantId, amount, currency, key, requestHash, createdAt] = values;
        payment = {
          payment_id: String(paymentId),
          order_id: String(orderId),
          customer_id: String(customerId),
          provider: 'hyperswitch',
          merchant_id: String(merchantId),
          amount_minor: Number(amount),
          currency: String(currency),
          status: 'INITIATING',
          version: 1,
          idempotency_key: String(key),
          request_hash: String(requestHash),
          provider_updated_at: null,
          failure_code: null,
          created_at: String(createdAt),
          updated_at: String(createdAt),
        };
        rows = [{ payment_id: payment.payment_id }];
      } else if (sql.startsWith('UPDATE payments SET status')) {
        const [status, updatedAt, paymentId, customerId, merchantId, amount, currency] = values;
        if (payment && payment.payment_id === paymentId && payment.customer_id === customerId &&
            payment.merchant_id === merchantId && payment.amount_minor === amount &&
            payment.currency === currency && payment.status === 'INITIATING' && payment.version === 1) {
          payment = { ...payment, status: String(status), version: 2, updated_at: String(updatedAt) };
          rows = [{ payment_id: payment.payment_id }];
        }
      } else {
        throw new Error('Unexpected PostgreSQL query: ' + sql);
      }
      return { rows: rows as Row[], rowCount: rows.length };
    },
    async connect() {
      throw new Error('payment-intent flow must not open a transaction for a single-row CAS');
    },
  };

  return {
    pool,
    statements,
    readPayment: () => payment,
    setPayment: (next: Partial<StoredPayment>) => {
      if (!payment) throw new Error('payment fixture has not been created');
      payment = { ...payment, ...next };
    },
  };
}

const providerPayment: HyperswitchPayment = {
  paymentId: PAYMENT,
  merchantId: MERCHANT,
  amount: 1299,
  currency: 'USD',
  status: 'requires_payment_method',
  clientSecret: 'must-not-persist',
  sdkAuthorization: 'must-not-persist',
};

describe('W07 native PostgreSQL payment-intent persistence', () => {
  it('creates a finance-domain payment attempt from the server-owned order total and replays by customer idempotency key', async () => {
    const f = fixture();
    const dependencies = {
      now: () => new Date(NOW),
      createPaymentId: () => PAYMENT,
      paymentEnvironment: 'sandbox' as const,
    };

    const created = await createPaymentAttemptPostgres(
      f.pool, CUSTOMER, ORDER, IDEMPOTENCY, MERCHANT, dependencies,
    );
    expect(created).toMatchObject({
      replayed: false,
      pricingMode: 'live',
      payment: { paymentId: PAYMENT, amountMinor: 1299, currency: 'USD', status: 'INITIATING', version: 1 },
    });
    expect(f.statements[0]?.sql).toContain("item_snapshot_json::jsonb #>> '{luckreadPricing,mode}'");
    expect(f.statements[2]?.sql).toContain('INSERT INTO payments');
    expect(f.statements[2]?.sql).toContain('RETURNING payment_id');
    expect(f.statements.every((entry) => !entry.sql.includes('?'))).toBe(true);

    const replay = await createPaymentAttemptPostgres(
      f.pool, CUSTOMER, ORDER, IDEMPOTENCY, MERCHANT, dependencies,
    );
    expect(replay).toMatchObject({ replayed: true, payment: { paymentId: PAYMENT } });
    expect(f.statements.filter((entry) => entry.sql.startsWith('INSERT INTO payments'))).toHaveLength(1);
  });

  it('records only the validated non-secret provider state with a version-checked PostgreSQL update', async () => {
    const f = fixture();
    await createPaymentAttemptPostgres(f.pool, CUSTOMER, ORDER, IDEMPOTENCY, MERCHANT, {
      now: () => new Date(NOW),
      createPaymentId: () => PAYMENT,
    });

    const persisted = await recordUnconfirmedHyperswitchIntentPostgres(
      f.pool, CUSTOMER, PAYMENT, MERCHANT, providerPayment, { now: () => new Date(LATER) },
    );
    expect(persisted).toMatchObject({
      paymentId: PAYMENT,
      status: 'requires_payment_method',
      version: 2,
      updatedAt: LATER,
    });
    expect(f.readPayment()).not.toHaveProperty('client_secret');
    expect(f.readPayment()).not.toHaveProperty('sdk_authorization');
    expect(f.statements.at(-1)?.sql).toContain('RETURNING payment_id');
  });

  it('records a merchant-initiated provider response through Neon without treating it as settlement evidence', async () => {
    const f = fixture();
    await createPaymentAttemptPostgres(f.pool, CUSTOMER, ORDER, IDEMPOTENCY, MERCHANT, {
      now: () => new Date(NOW),
      createPaymentId: () => PAYMENT,
    });

    const persisted = await recordHyperswitchMerchantInitiatedSubmissionPostgres(
      f.pool,
      CUSTOMER,
      PAYMENT,
      MERCHANT,
      'pm_saved_1',
      {
        ...providerPayment,
        status: 'processing',
        customerId: CUSTOMER,
        paymentMethodId: 'pm_saved_1',
      },
      { now: () => new Date(LATER) },
    );

    expect(persisted).toMatchObject({
      paymentId: PAYMENT,
      status: 'processing',
      version: 2,
      updatedAt: LATER,
    });
    expect(f.readPayment()).not.toHaveProperty('client_secret');
    expect(f.readPayment()).not.toHaveProperty('sdk_authorization');
    expect(f.statements.at(-2)?.sql).toContain("provider = 'hyperswitch'");
    expect(f.statements.at(-2)?.sql).toContain("status = 'INITIATING' AND version = 1");
    expect(f.statements.every((entry) => !entry.sql.includes('?'))).toBe(true);
  });

  it('does not regress a payment already advanced by a signed webhook', async () => {
    const f = fixture();
    await createPaymentAttemptPostgres(f.pool, CUSTOMER, ORDER, IDEMPOTENCY, MERCHANT, {
      now: () => new Date(NOW),
      createPaymentId: () => PAYMENT,
    });
    f.setPayment({ status: 'succeeded', version: 2, updated_at: LATER });

    const persisted = await recordHyperswitchMerchantInitiatedSubmissionPostgres(
      f.pool,
      CUSTOMER,
      PAYMENT,
      MERCHANT,
      'pm_saved_1',
      { ...providerPayment, status: 'processing', customerId: CUSTOMER, paymentMethodId: 'pm_saved_1' },
      { now: () => new Date(LATER) },
    );

    expect(persisted).toMatchObject({ status: 'succeeded', version: 2, updatedAt: LATER });
    expect(f.statements.some((entry) => entry.sql.startsWith('UPDATE payments SET status'))).toBe(false);
  });

  it('rejects a mismatched MIT payment method before querying PostgreSQL', async () => {
    const f = fixture();
    await expect(recordHyperswitchMerchantInitiatedSubmissionPostgres(
      f.pool,
      CUSTOMER,
      PAYMENT,
      MERCHANT,
      'pm_saved_expected',
      { ...providerPayment, paymentMethodId: 'pm_saved_other' },
    )).rejects.toMatchObject({ code: 'WEBHOOK_REJECTED', status: 400 });
    expect(f.statements).toHaveLength(0);
  });

  it('rejects mismatched provider identity without changing payment state', async () => {
    const f = fixture();
    await createPaymentAttemptPostgres(f.pool, CUSTOMER, ORDER, IDEMPOTENCY, MERCHANT, {
      now: () => new Date(NOW),
      createPaymentId: () => PAYMENT,
    });
    await expect(recordUnconfirmedHyperswitchIntentPostgres(
      f.pool, CUSTOMER, PAYMENT, MERCHANT,
      { ...providerPayment, amount: 1 },
      { now: () => new Date(LATER) },
    )).rejects.toMatchObject({
      code: 'WEBHOOK_REJECTED',
      status: 400,
    });
    expect(f.readPayment()?.status).toBe('INITIATING');
  });

  it('rejects malformed idempotency input before querying PostgreSQL', async () => {
    const f = fixture();
    await expect(createPaymentAttemptPostgres(f.pool, CUSTOMER, ORDER, 'bad key', MERCHANT))
      .rejects.toBeInstanceOf(PaymentPersistenceError);
    expect(f.statements).toHaveLength(0);
  });
});
