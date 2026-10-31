import { describe, expect, it } from 'vitest';
import {
  handleCommercePaymentIntentRequest,
} from './payment-intent-http-runtime.js';
import {
  HyperswitchClientError,
  type CreateHyperswitchCustomerInitiatedSetupInput,
  type HyperswitchClientConfig,
  type HyperswitchPayment,
} from './hyperswitch-client.js';
import {
  PaymentPersistenceError,
  type PaymentAttemptCreation,
  type PaymentAttemptDto,
} from './payment-persistence.js';

const CUSTOMER_ID = 'verified-user-001';
const ORDER_ID = 'ord_test_001';
const PAYMENT_ID = 'pay_' + 'a'.repeat(26);
const MERCHANT_ID = 'merchant_test';
const CLIENT_IDEMPOTENCY_KEY = 'browser-checkout-001';
const NOW = '2026-10-28T10:00:00.000Z';

const paymentDto: PaymentAttemptDto = {
  paymentId: PAYMENT_ID,
  orderId: ORDER_ID,
  amountMinor: 1299,
  currency: 'USD',
  status: 'INITIATING',
  version: 1,
  providerUpdatedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const providerPayment: HyperswitchPayment = {
  paymentId: PAYMENT_ID,
  merchantId: MERCHANT_ID,
  amount: 1299,
  currency: 'USD',
  status: 'requires_payment_method',
  clientSecret: 'provider-client-secret-test',
};

type RuntimeDependencies = NonNullable<Parameters<typeof handleCommercePaymentIntentRequest>[3]>;

function createFixture(options: {
  attempt?: PaymentAttemptCreation;
  providerPayment?: HyperswitchPayment;
  createAttemptError?: Error;
  createProviderError?: Error;
  recordIntentError?: Error;
  env?: Record<string, unknown>;
  orderLines?: Array<Record<string, unknown>>;
  reservation?: Record<string, unknown> | null;
} = {}) {
  const calls = {
    createAttempt: [] as unknown[][],
    createProviderIntent: [] as unknown[][],
    recordIntent: [] as unknown[][],
  };

  const attempt = options.attempt ?? { payment: paymentDto, replayed: false, pricingMode: 'live' };
  const remotePayment = options.providerPayment ?? providerPayment;
  const d1_04 = {
    prepare() {
      return {
        bind() {
          return {
            async all() { return { results: options.orderLines ?? [] }; },
          };
        },
      };
    },
  } as unknown as D1Database;
  const d1_01 = {
    prepare() {
      return {
        bind() {
          return {
            async first() { return options.reservation ?? null; },
          };
        },
      };
    },
  } as unknown as D1Database;
  const env = {
    D1_01: d1_01,
    D1_04: d1_04,
    HYPERSWITCH_ENVIRONMENT: 'sandbox',
    HYPERSWITCH_API_KEY: 'sandbox-api-key',
    HYPERSWITCH_MERCHANT_ID: MERCHANT_ID,
    ...options.env,
  } as Parameters<typeof handleCommercePaymentIntentRequest>[2];

  const dependencies: RuntimeDependencies = {
    createAttempt: async (...args) => {
      calls.createAttempt.push(args);
      if (options.createAttemptError) throw options.createAttemptError;
      return attempt;
    },
    createProviderIntent: async (...args) => {
      calls.createProviderIntent.push(args);
      if (options.createProviderError) throw options.createProviderError;
      return remotePayment;
    },
    recordIntent: async (...args) => {
      calls.recordIntent.push(args);
      if (options.recordIntentError) throw options.recordIntentError;
      return {
        ...paymentDto,
        status: remotePayment.status,
        version: 2,
        updatedAt: '2026-10-28T10:00:01.000Z',
      };
    },
  };

  return { env, dependencies, calls };
}

function request(options: { body?: string; method?: string; idempotencyKey?: string } = {}): Request {
  const headers = new Headers();
  if (options.idempotencyKey !== undefined) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  return new Request(
    `https://luckread-w07.internal/commerce/orders/${ORDER_ID}/payment-intent`,
    {
      method: options.method ?? 'POST',
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
    },
  );
}

describe('W07 internal payment-intent runtime', () => {
  it('does not claim unrelated routes', async () => {
    const fixture = createFixture();
    const unrelated = new Request('https://luckread-w07.internal/commerce/orders', { method: 'POST' });
    await expect(
      handleCommercePaymentIntentRequest(unrelated, CUSTOMER_ID, fixture.env, fixture.dependencies),
    ).resolves.toBeNull();
    expect(fixture.calls.createAttempt).toHaveLength(0);
  });

  it('rejects a caller-supplied body instead of accepting amount or provider fields', async () => {
    const fixture = createFixture();
    const response = await handleCommercePaymentIntentRequest(
      request({ body: JSON.stringify({ amount: 1, currency: 'USD', merchantId: MERCHANT_ID }) }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(fixture.calls.createAttempt).toHaveLength(0);
    expect(fixture.calls.createProviderIntent).toHaveLength(0);
  });

  it('rejects an upgrade Order without its D1-01 reservation before creating a payment attempt', async () => {
    const planId = 'plan_' + 'b'.repeat(64);
    const fixture = createFixture({
      orderLines: [{
        order_line_id: 'line_upgrade_1',
        item_type: 'MEMBERSHIP_PLAN',
        item_ref: planId,
        item_version: '2',
        item_snapshot_json: JSON.stringify({
          planId,
          planVersion: 2,
          membershipUpgrade: {
            version: 1,
            subscriptionId: 'sub_upgrade_1',
            sourcePlanId: 'plan_' + 'a'.repeat(64),
            sourcePlanVersion: 1,
            targetPlanId: planId,
            targetPlanVersion: 2,
            expectedSubscriptionVersion: 4,
            currentPeriodStart: '2026-10-01T00:00:00.000Z',
            currentPeriodEnd: '2026-11-01T00:00:00.000Z',
            requestHash: 'd'.repeat(64),
          },
        }),
      }],
    });
    const response = await handleCommercePaymentIntentRequest(
      request({ idempotencyKey: CLIENT_IDEMPOTENCY_KEY }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ error: { code: 'UPGRADE_RESERVATION_REQUIRED' } });
    expect(fixture.calls.createAttempt).toHaveLength(0);
    expect(fixture.calls.createProviderIntent).toHaveLength(0);
  });

  it('permits an upgrade PaymentIntent only when the D1-01 reservation matches the immutable Order snapshot', async () => {
    const planId = 'plan_' + 'b'.repeat(64);
    const upgrade = {
      version: 1,
      subscriptionId: 'sub_upgrade_1',
      sourcePlanId: 'plan_' + 'a'.repeat(64),
      sourcePlanVersion: 1,
      targetPlanId: planId,
      targetPlanVersion: 2,
      expectedSubscriptionVersion: 4,
      currentPeriodStart: '2026-10-01T00:00:00.000Z',
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
      requestHash: 'd'.repeat(64),
    };
    const fixture = createFixture({
      orderLines: [{
        order_line_id: 'line_upgrade_1',
        item_type: 'MEMBERSHIP_PLAN',
        item_ref: planId,
        item_version: '2',
        item_snapshot_json: JSON.stringify({ planId, planVersion: 2, membershipUpgrade: upgrade }),
      }],
      reservation: {
        subscription_id: upgrade.subscriptionId,
        subscriber_id: CUSTOMER_ID,
        source_plan_id: upgrade.sourcePlanId,
        source_plan_version: upgrade.sourcePlanVersion,
        target_plan_id: upgrade.targetPlanId,
        target_plan_version: upgrade.targetPlanVersion,
        expected_subscription_version: upgrade.expectedSubscriptionVersion,
        current_period_start: upgrade.currentPeriodStart,
        current_period_end: upgrade.currentPeriodEnd,
        order_id: ORDER_ID,
        request_hash: upgrade.requestHash,
        status: 'PENDING_PAYMENT',
        payment_id: null,
      },
    });
    const response = await handleCommercePaymentIntentRequest(
      request({ idempotencyKey: CLIENT_IDEMPOTENCY_KEY }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(201);
    expect(fixture.calls.createAttempt).toHaveLength(1);
    expect(fixture.calls.createProviderIntent).toHaveLength(1);
  });

  it('uses server-owned order totals and a stable provider key, persisting before returning checkout data', async () => {
    const fixture = createFixture();
    const response = await handleCommercePaymentIntentRequest(
      request({ idempotencyKey: CLIENT_IDEMPOTENCY_KEY }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );

    expect(response?.status).toBe(201);
    expect(fixture.calls.createAttempt).toHaveLength(1);
    expect(fixture.calls.createAttempt[0]?.slice(1)).toEqual([
      CUSTOMER_ID,
      ORDER_ID,
      CLIENT_IDEMPOTENCY_KEY,
      MERCHANT_ID,
      { paymentEnvironment: 'sandbox' },
    ]);
    expect(fixture.calls.createProviderIntent).toHaveLength(1);
    expect(fixture.calls.createProviderIntent[0]?.[0]).toEqual({
      environment: 'sandbox',
      apiKey: 'sandbox-api-key',
      expectedMerchantId: MERCHANT_ID,
    } satisfies HyperswitchClientConfig);
    expect(fixture.calls.createProviderIntent[0]?.[1]).toEqual({
      paymentId: PAYMENT_ID,
      amount: 1299,
      currency: 'USD',
      idempotencyKey: 'lr_' + PAYMENT_ID,
      customerId: CUSTOMER_ID,
    } satisfies CreateHyperswitchCustomerInitiatedSetupInput);
    expect(fixture.calls.recordIntent).toHaveLength(1);

    const body = await response!.json() as { data: Record<string, unknown>; requestId: string };
    expect(body.data).toMatchObject({
      paymentId: PAYMENT_ID,
      orderId: ORDER_ID,
      amountMinor: 1299,
      currency: 'USD',
      status: 'requires_payment_method',
      version: 2,
      clientSecret: 'provider-client-secret-test',
    });
    expect(body.data).not.toHaveProperty('apiKey');
    expect(body.data).not.toHaveProperty('merchantId');
    expect(body.requestId).toMatch(/^req_/);
  });

  it('uses the same provider idempotency key on a client retry and returns HTTP 200 for replay', async () => {
    const fixture = createFixture({
      attempt: {
        payment: { ...paymentDto, status: 'requires_payment_method', version: 2 },
        replayed: true,
        pricingMode: 'live',
      },
    });
    const response = await handleCommercePaymentIntentRequest(
      request({ idempotencyKey: CLIENT_IDEMPOTENCY_KEY }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(200);
    expect(fixture.calls.createProviderIntent[0]?.[1]).toMatchObject({
      paymentId: PAYMENT_ID,
      idempotencyKey: 'lr_' + PAYMENT_ID,
      customerId: CUSTOMER_ID,
    });
  });

  it('does not re-open a payment attempt whose state has advanced', async () => {
    const fixture = createFixture({
      attempt: { payment: { ...paymentDto, status: 'succeeded', version: 3 }, replayed: true, pricingMode: 'live' },
    });
    const response = await handleCommercePaymentIntentRequest(
      request({ idempotencyKey: CLIENT_IDEMPOTENCY_KEY }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(409);
    expect(await response?.json()).toMatchObject({ error: { code: 'PAYMENT_STATE_ADVANCED' } });
    expect(fixture.calls.createProviderIntent).toHaveLength(0);
  });

  it('returns a sanitized 503 when the provider is unavailable and never returns a client secret', async () => {
    const fixture = createFixture({
      createProviderError: new HyperswitchClientError('UPSTREAM_UNAVAILABLE', 'sanitized test error'),
    });
    const response = await handleCommercePaymentIntentRequest(
      request({ idempotencyKey: CLIENT_IDEMPOTENCY_KEY }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(503);
    const body = await response!.text();
    expect(body).toContain('SERVICE_UNAVAILABLE');
    expect(body).not.toContain('sandbox-api-key');
    expect(body).not.toContain('provider-client-secret-test');
  });

  it('does not claim checkout readiness when the provider omits client_secret', async () => {
    const fixture = createFixture({ providerPayment: { ...providerPayment, clientSecret: null } });
    const response = await handleCommercePaymentIntentRequest(
      request({ idempotencyKey: CLIENT_IDEMPOTENCY_KEY }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(503);
    expect(fixture.calls.recordIntent).toHaveLength(1);
    expect((await response!.text())).not.toContain('clientSecret');
  });

  it('fails closed before creating a local payment attempt when provider config is missing', async () => {
    const fixture = createFixture({ env: { HYPERSWITCH_API_KEY: undefined } });
    const response = await handleCommercePaymentIntentRequest(
      request({ idempotencyKey: CLIENT_IDEMPOTENCY_KEY }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(503);
    expect(fixture.calls.createAttempt).toHaveLength(0);
  });

  it('maps idempotency preconditions to a safe client error', async () => {
    const fixture = createFixture({
      createAttemptError: new PaymentPersistenceError('PRECONDITION_REQUIRED', 428),
    });
    const response = await handleCommercePaymentIntentRequest(
      request(),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(428);
    expect(await response?.json()).toMatchObject({ error: { code: 'PRECONDITION_REQUIRED' } });
    expect(fixture.calls.createProviderIntent).toHaveLength(0);
  });
});
