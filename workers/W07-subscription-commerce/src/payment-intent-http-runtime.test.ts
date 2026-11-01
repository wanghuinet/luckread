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
  sdkAuthorization: 'cHJvZmlsZV9pZD10ZXN0',
};

type RuntimeDependencies = NonNullable<Parameters<typeof handleCommercePaymentIntentRequest>[3]>;

function createFixture(options: {
  attempt?: PaymentAttemptCreation;
  providerPayment?: HyperswitchPayment;
  createAttemptError?: Error;
  createProviderError?: Error;
  recordIntentError?: Error;
  env?: Record<string, unknown>;
} = {}) {
  const calls = {
    createAttempt: [] as unknown[][],
    createProviderIntent: [] as unknown[][],
    recordIntent: [] as unknown[][],
  };

  const attempt = options.attempt ?? { payment: paymentDto, replayed: false, pricingMode: 'live' };
  const remotePayment = options.providerPayment ?? providerPayment;
  const env = {
    D1_04: {} as D1Database,
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
      sdkAuthorization: 'cHJvZmlsZV9pZD10ZXN0',
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


  it('does not claim native checkout readiness when Hyperswitch omits sdk_authorization', async () => {
    const fixture = createFixture({
      providerPayment: { ...providerPayment, sdkAuthorization: null },
    });
    const response = await handleCommercePaymentIntentRequest(
      request({ idempotencyKey: CLIENT_IDEMPOTENCY_KEY }),
      CUSTOMER_ID,
      fixture.env,
      fixture.dependencies,
    );
    expect(response?.status).toBe(503);
    const body = await response!.text();
    expect(body).not.toContain('sdkAuthorization');
    expect(body).not.toContain('cHJvZmlsZV9pZD10ZXN0');
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
