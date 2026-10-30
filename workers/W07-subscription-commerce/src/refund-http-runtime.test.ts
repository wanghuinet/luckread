import { describe, expect, it } from 'vitest';
import {
  handleCommerceRefundRequest,
} from './refund-http-runtime.js';
import {
  HyperswitchClientError,
  type HyperswitchClientConfig,
  type HyperswitchPayment,
  type HyperswitchRefund,
} from './hyperswitch-client.js';
import {
  RefundPersistenceError,
  type RefundDto,
  type RefundReservation,
} from './refund-persistence.js';

const CUSTOMER_ID = 'customer_001';
const PAYMENT_ID = 'pay_' + 'a'.repeat(26);
const ORDER_ID = 'ord_test_001';
const REFUND_ID = 'ref_' + 'r'.repeat(26);
const MERCHANT_ID = 'merchant_test';
const IDEMPOTENCY_KEY = 'refund_client_001';
const NOW = '2026-10-30T10:00:00.000Z';
const LATER = '2026-10-30T10:00:01.000Z';

const paymentReference = {
  paymentId: PAYMENT_ID,
  orderId: ORDER_ID,
  amountMinor: 1000,
  currency: 'USD',
  merchantId: MERCHANT_ID,
};

const providerPayment: HyperswitchPayment = {
  paymentId: PAYMENT_ID,
  merchantId: MERCHANT_ID,
  amount: 1000,
  currency: 'USD',
  status: 'succeeded',
  clientSecret: null,
  amountCaptured: 700,
};

const requestedRefund: RefundDto = {
  refundId: REFUND_ID,
  paymentId: PAYMENT_ID,
  orderId: ORDER_ID,
  amountMinor: 300,
  capturedAmountMinor: 700,
  currency: 'USD',
  status: 'REQUESTED',
  reason: 'Customer request',
  version: 1,
  providerUpdatedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

type RuntimeDependencies = NonNullable<Parameters<typeof handleCommerceRefundRequest>[3]>;

function createFixture(options: {
  reference?: typeof paymentReference;
  providerPayment?: HyperswitchPayment;
  reservation?: RefundReservation;
  providerRefund?: HyperswitchRefund;
  acknowledgedRefund?: RefundDto;
  retrieveError?: Error;
  reserveError?: Error;
  createProviderError?: Error;
  env?: Record<string, unknown>;
} = {}) {
  const calls = {
    resolvePayment: [] as unknown[][],
    retrievePayment: [] as unknown[][],
    reserve: [] as unknown[][],
    createProviderRefund: [] as unknown[][],
    recordAcknowledgement: [] as unknown[][],
  };

  const reservation: RefundReservation = options.reservation ?? {
    refund: requestedRefund,
    replayed: false,
  };
  const remotePayment = options.providerPayment ?? providerPayment;
  const remoteRefund: HyperswitchRefund = options.providerRefund ?? {
    refundId: REFUND_ID,
    paymentId: PAYMENT_ID,
    amount: 300,
    currency: 'USD',
    status: 'pending',
    updatedAt: LATER,
  };
  const acknowledged: RefundDto = options.acknowledgedRefund ?? {
    ...requestedRefund,
    status: 'PENDING',
    version: 2,
    providerUpdatedAt: LATER,
    updatedAt: LATER,
  };
  const env = {
    D1_04: {} as D1Database,
    HYPERSWITCH_ENVIRONMENT: 'sandbox',
    HYPERSWITCH_API_KEY: 'sandbox-api-key',
    HYPERSWITCH_MERCHANT_ID: MERCHANT_ID,
    ...options.env,
  } as Parameters<typeof handleCommerceRefundRequest>[2];

  const dependencies: RuntimeDependencies = {
    resolvePayment: async (...args) => {
      calls.resolvePayment.push(args);
      return options.reference ?? paymentReference;
    },
    retrievePayment: async (...args) => {
      calls.retrievePayment.push(args);
      if (options.retrieveError) throw options.retrieveError;
      return remotePayment;
    },
    reserve: async (...args) => {
      calls.reserve.push(args);
      if (options.reserveError) throw options.reserveError;
      return reservation;
    },
    createProviderRefund: async (...args) => {
      calls.createProviderRefund.push(args);
      if (options.createProviderError) throw options.createProviderError;
      return remoteRefund;
    },
    recordAcknowledgement: async (...args) => {
      calls.recordAcknowledgement.push(args);
      return acknowledged;
    },
  };
  return { env, dependencies, calls };
}

function request(options: {
  body?: unknown;
  method?: string;
  idempotencyKey?: string;
} = {}): Request {
  const headers = new Headers();
  if (options.idempotencyKey !== undefined) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  return new Request('https://luckread-w07.internal/commerce/payments/refunds', {
    method: options.method ?? 'POST',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

describe('W07 internal customer refund runtime', () => {
  it('does not claim unrelated routes', async () => {
    const fixture = createFixture();
    await expect(
      handleCommerceRefundRequest(
        new Request('https://luckread-w07.internal/commerce/orders', { method: 'POST' }),
        CUSTOMER_ID,
        fixture.env,
        fixture.dependencies,
      ),
    ).resolves.toBeNull();
    expect(fixture.calls.resolvePayment).toHaveLength(0);
  });

  it('uses a customer-owned D1-04 payment, then provider-authoritative captured amount, then reserves before the refund POST', async () => {
    const fixture = createFixture();
    const response = await handleCommerceRefundRequest(
      request({
        idempotencyKey: IDEMPOTENCY_KEY,
        body: {
          paymentId: PAYMENT_ID,
          amountMinor: 300,
          currency: 'USD',
          reason: 'Customer request',
        },
      }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );

    expect(response?.status).toBe(202);
    expect(fixture.calls.resolvePayment).toHaveLength(1);
    expect(fixture.calls.resolvePayment[0]?.slice(1)).toEqual([
      CUSTOMER_ID,
      PAYMENT_ID,
      MERCHANT_ID,
    ]);
    expect(fixture.calls.retrievePayment).toHaveLength(1);
    expect(fixture.calls.retrievePayment[0]?.[1]).toBe(PAYMENT_ID);
    expect(fixture.calls.reserve).toHaveLength(1);
    expect(fixture.calls.reserve[0]?.[1]).toMatchObject({
      customerId: CUSTOMER_ID,
      paymentId: PAYMENT_ID,
      amountMinor: 300,
      currency: 'USD',
      capturedAmountMinor: 700,
      idempotencyKey: IDEMPOTENCY_KEY,
      reason: 'Customer request',
      expectedMerchantId: MERCHANT_ID,
    });
    expect(fixture.calls.createProviderRefund).toHaveLength(1);
    expect(fixture.calls.createProviderRefund[0]?.[0]).toEqual({
      environment: 'sandbox',
      apiKey: 'sandbox-api-key',
      expectedMerchantId: MERCHANT_ID,
    } satisfies HyperswitchClientConfig);
    expect(fixture.calls.createProviderRefund[0]?.[1]).toEqual({
      paymentId: PAYMENT_ID,
      refundId: REFUND_ID,
      amount: 300,
      currency: 'USD',
      reason: 'Customer request',
    });
    expect(fixture.calls.recordAcknowledgement).toHaveLength(1);

    const body = await response!.json() as { data: Record<string, unknown>; requestId: string };
    expect(body.data).toMatchObject({
      refundId: REFUND_ID,
      paymentId: PAYMENT_ID,
      orderId: ORDER_ID,
      amountMinor: 300,
      capturedAmountMinor: 700,
      currency: 'USD',
      status: 'PENDING',
      replayed: false,
    });
    expect(body.data).not.toHaveProperty('merchantId');
    expect(body.data).not.toHaveProperty('apiKey');
    expect(body.requestId).toMatch(/^req_/);
    expect(response?.headers.get('cache-control')).toBe('no-store');
  });

  it('does not reserve or call Hyperswitch when captured amount is absent or invalid', async () => {
    for (const amountCaptured of [null, undefined, 0, -1, 700.5, 1001]) {
      const invalidPayment = {
        ...providerPayment,
        amountCaptured: amountCaptured as number | null | undefined,
      };
      const fixture = createFixture({ providerPayment: invalidPayment });
      const response = await handleCommerceRefundRequest(
        request({
          idempotencyKey: IDEMPOTENCY_KEY,
          body: { paymentId: PAYMENT_ID, amountMinor: 300, currency: 'USD' },
        }),
        CUSTOMER_ID,
        fixture.env,
        fixture.dependencies,
      );
      expect(response?.status).toBe(409);
      expect(await response?.json()).toMatchObject({
        error: { code: 'REFUND_CAPTURE_NOT_CONFIRMED' },
      });
      expect(fixture.calls.reserve).toHaveLength(0);
      expect(fixture.calls.createProviderRefund).toHaveLength(0);
    }
  });

  it('returns an existing accepted refund without creating another provider refund', async () => {
    const fixture = createFixture({
      reservation: {
        refund: { ...requestedRefund, status: 'PENDING', version: 2, updatedAt: LATER },
        replayed: true,
      },
    });
    const response = await handleCommerceRefundRequest(
      request({
        idempotencyKey: IDEMPOTENCY_KEY,
        body: { paymentId: PAYMENT_ID, amountMinor: 300, currency: 'USD' },
      }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(202);
    expect(fixture.calls.reserve).toHaveLength(1);
    expect(fixture.calls.createProviderRefund).toHaveLength(0);
    expect(fixture.calls.recordAcknowledgement).toHaveLength(0);
    expect(await response?.json()).toMatchObject({
      data: { refundId: REFUND_ID, status: 'PENDING', replayed: true },
    });
  });

  it('keeps the stable REQUESTED refund reservation after an ambiguous provider timeout', async () => {
    const fixture = createFixture({
      createProviderError: new HyperswitchClientError('UPSTREAM_UNAVAILABLE', 'sanitized provider timeout'),
    });
    const response = await handleCommerceRefundRequest(
      request({
        idempotencyKey: IDEMPOTENCY_KEY,
        body: { paymentId: PAYMENT_ID, amountMinor: 300, currency: 'USD' },
      }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(fixture.calls.reserve).toHaveLength(1);
    expect(fixture.calls.createProviderRefund[0]?.[1]).toMatchObject({ refundId: REFUND_ID });
    expect(fixture.calls.recordAcknowledgement).toHaveLength(0);
  });

  it('rejects an invalid browser amount before any ownership, provider, or D1 operation', async () => {
    const fixture = createFixture();
    const response = await handleCommerceRefundRequest(
      request({
        idempotencyKey: IDEMPOTENCY_KEY,
        body: { paymentId: PAYMENT_ID, amountMinor: 0, currency: 'USD' },
      }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(fixture.calls.resolvePayment).toHaveLength(0);
    expect(fixture.calls.retrievePayment).toHaveLength(0);
    expect(fixture.calls.reserve).toHaveLength(0);
    expect(fixture.calls.createProviderRefund).toHaveLength(0);
  });

  it('requires the same client Idempotency-Key and fails closed on provider or persistence errors', async () => {
    const missingKey = createFixture();
    const missingKeyResponse = await handleCommerceRefundRequest(
      request({ body: { paymentId: PAYMENT_ID, amountMinor: 300, currency: 'USD' } }),
      CUSTOMER_ID,
      missingKey.env,
      missingKey.dependencies,
    );
    expect(missingKeyResponse?.status).toBe(428);
    expect(await missingKeyResponse?.json()).toMatchObject({ error: { code: 'PRECONDITION_REQUIRED' } });
    expect(missingKey.calls.resolvePayment).toHaveLength(0);
    expect(missingKey.calls.retrievePayment).toHaveLength(0);
    expect(missingKey.calls.reserve).toHaveLength(0);
    expect(missingKey.calls.createProviderRefund).toHaveLength(0);

    const conflict = createFixture({
      reserveError: new RefundPersistenceError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409),
    });
    const conflictResponse = await handleCommerceRefundRequest(
      request({
        idempotencyKey: IDEMPOTENCY_KEY,
        body: { paymentId: PAYMENT_ID, amountMinor: 300, currency: 'USD' },
      }),
      CUSTOMER_ID,
      conflict.env,
      conflict.dependencies,
    );
    expect(conflictResponse?.status).toBe(409);
    expect(conflict.calls.createProviderRefund).toHaveLength(0);
  });
});
