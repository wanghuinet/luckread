import { describe, expect, it } from 'vitest';
import {
  handleHyperswitchWebhookRequest,
} from './payment-webhook-http-runtime.js';
import {
  PaymentPersistenceError,
  type WebhookReceiptResult,
} from './payment-persistence.js';
import type { ReceiveHyperswitchWebhookInput } from './payment-persistence.js';
import type { RenewalOutcomeSyncResult } from './subscription-renewal-outcome.js';
import type { PaidMembershipPurchaseFulfillmentResult } from './paid-membership-order-fulfillment.js';
import { type BillingDocumentDto } from './billing-persistence.js';

const SECRET = 'hyperswitch-webhook-test-secret';
const MERCHANT = 'merchant_test';
const CORRELATION_ID = 'corr_test_001';
const BODY = '{"event_id":"evt_test_001","merchant_id":"merchant_test"}';

const receipt = (
  outcome: WebhookReceiptResult['outcome'] = 'APPLIED',
): WebhookReceiptResult => ({
  outcome,
  eventId: 'evt_test_001',
  receiptId: 'evtrow_test_001',
  state: outcome === 'APPLIED' || outcome === 'DUPLICATE' ? 'APPLIED' : 'RECONCILIATION_REQUIRED',
  payloadSha256: 'a'.repeat(64),
  ...(outcome === 'PAYLOAD_CONFLICT' ? { conflictId: 'evtconf_test_001' } : {}),
});

type Receiver = NonNullable<Parameters<typeof handleHyperswitchWebhookRequest>[2]>['receive'];

function fixture(options: {
  result?: WebhookReceiptResult;
  error?: Error;
  syncResult?: RenewalOutcomeSyncResult;
  pendingRecoveryResult?: Readonly<{ scanned: number; applied: number; reconciliationRequired: number; pendingRetry: number }>;
  purchaseFulfillmentResult?: PaidMembershipPurchaseFulfillmentResult;
} = {}) {
  const calls: Array<{ db: unknown; input: ReceiveHyperswitchWebhookInput }> = [];
  const syncCalls: Array<{ env: unknown; paymentId: string; merchantId: string }> = [];
  const pendingRecoveryCalls: Array<{ env: unknown; options?: Readonly<{ limit?: number }> }> = [];
  const purchaseFulfillmentCalls: Array<{ env: unknown; paymentId: string; merchantId: string }> = [];
  const receiptCalls: Array<{ db: unknown; paymentId: string; merchantId: string }> = [];
  const receive: Receiver = async (db, input) => {
    calls.push({ db, input });
    if (options.error) throw options.error;
    return options.result ?? receipt();
  };
  const syncRenewalOutcome = async (
    env: { D1_01: D1Database; D1_04: D1Database },
    paymentId: string,
    merchantId: string,
  ): Promise<RenewalOutcomeSyncResult> => {
    syncCalls.push({ env, paymentId, merchantId });
    return options.syncResult ?? { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' };
  };
  const syncPendingOutcomes = async (
    env: { D1_01: D1Database; D1_04: D1Database },
    recoveryOptions?: Readonly<{ limit?: number }>,
  ) => {
    pendingRecoveryCalls.push({ env, options: recoveryOptions });
    return options.pendingRecoveryResult ?? { scanned: 0, applied: 0, reconciliationRequired: 0, pendingRetry: 0 };
  };
  const fulfillPaidOrder = async (
    env: { D1_01: D1Database; D1_04: D1Database },
    paymentId: string,
    merchantId: string,
  ): Promise<PaidMembershipPurchaseFulfillmentResult> => {
    purchaseFulfillmentCalls.push({ env, paymentId, merchantId });
    return options.purchaseFulfillmentResult ?? { outcome: 'NOT_APPLICABLE', fulfilledCount: 0 };
  };
  const issueReceipt = async (
    db: D1Database,
    paymentId: string,
    merchantId: string,
  ): Promise<BillingDocumentDto> => {
    receiptCalls.push({ db, paymentId, merchantId });
    return {} as BillingDocumentDto;
  };
  const env = {
    D1_01: { marker: 'd1-01' } as unknown as D1Database,
    D1_04: { marker: 'd1-04' } as unknown as D1Database,
    HYPERSWITCH_WEBHOOK_SECRET: SECRET,
    HYPERSWITCH_MERCHANT_ID: MERCHANT,
  };
  return { env, calls, syncCalls, pendingRecoveryCalls, purchaseFulfillmentCalls, receiptCalls, dependencies: { receive, syncRenewalOutcome, syncPendingOutcomes, fulfillPaidOrder, issueReceipt } };
}

function request(options: {
  pathname?: string;
  method?: string;
  body?: BodyInit | null;
  signature?: string;
  caller?: string;
  version?: string;
  correlation?: string;
  contentLength?: string;
} = {}): Request {
  const headers = new Headers({
    'X-LuckRead-Caller': options.caller ?? 'W01',
    'X-LuckRead-Transport-Version': options.version ?? '1.0',
    'X-LuckRead-Correlation-Id': options.correlation ?? CORRELATION_ID,
    'content-type': 'application/json',
  });
  if (options.signature !== undefined) headers.set('X-Webhook-Signature-512', options.signature);
  if (options.contentLength !== undefined) headers.set('content-length', options.contentLength);
  return new Request(
    `https://luckread-w07.internal${options.pathname ?? '/internal/webhooks/hyperswitch'}`,
    {
      method: options.method ?? 'POST',
      headers,
      ...(options.body !== undefined ? { body: options.body } : { body: BODY }),
    },
  );
}

describe('W07 Hyperswitch webhook HTTP receiver', () => {
  it('does not claim unrelated routes', async () => {
    const f = fixture();
    await expect(
      handleHyperswitchWebhookRequest(request({ pathname: '/memberships/subscriptions' }), f.env, f.dependencies),
    ).resolves.toBeNull();
    expect(f.calls).toHaveLength(0);
  });

  it('requires the private W01 service-binding envelope without a browser principal', async () => {
    const f = fixture();
    const response = await handleHyperswitchWebhookRequest(
      request({ caller: 'internet-client' }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    expect(f.calls).toHaveLength(0);
  });

  it('streams within the 1 MiB cap and sends exact raw bytes plus the signature to persistence', async () => {
    const f = fixture();
    const signature = 'b'.repeat(128);
    const rawRequestBody = '{"event_id":"evt_test_001", "merchant_id":"merchant_test"}';
    const response = await handleHyperswitchWebhookRequest(
      request({ body: rawRequestBody, signature }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(200);
    expect(f.calls).toHaveLength(1);
    expect(new TextDecoder().decode(f.calls[0]!.input.rawBody)).toBe(rawRequestBody);
    expect(f.calls[0]!.input.signatureHeader).toBe(signature);
    expect(f.calls[0]!.input.webhookSecret).toBe(SECRET);
    expect(f.calls[0]!.input.expectedMerchantId).toBe(MERCHANT);
    expect(f.calls[0]!.db).toBe(f.env.D1_04);
    expect(await response?.json()).toMatchObject({ data: { outcome: 'APPLIED', state: 'APPLIED' } });
  });

  it('synchronizes a signed, applied renewal payment into D1-01 and reports reconciliation when needed', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: {
        cycleId: 'rcy_' + 'a'.repeat(26),
        subscriptionId: 'sub_test',
        outcome: 'RECONCILIATION_REQUIRED',
        reasonCode: 'SUBSCRIPTION_PERIOD_CAS_MISMATCH',
      },
    });
    const paymentId = 'pay_' + 'b'.repeat(26);
    const body = JSON.stringify({
      event_id: 'evt_test_001',
      merchant_id: MERCHANT,
      content_type: 'payment_details',
      resource: { payment_id: paymentId },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body, signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(202);
    expect(f.syncCalls).toHaveLength(1);
    expect(f.syncCalls[0]).toMatchObject({
      env: { D1_01: f.env.D1_01, D1_04: f.env.D1_04 },
      paymentId,
      merchantId: MERCHANT,
    });
    expect(await response?.json()).toMatchObject({
      data: {
        outcome: 'APPLIED',
        subscriptionSync: 'RECONCILIATION_REQUIRED',
        subscriptionSyncReason: 'SUBSCRIPTION_PERIOD_CAS_MISMATCH',
        subscriptionId: 'sub_test',
      },
    });
  });

  it('runs a bounded pending-outcome recovery batch after a successfully synchronized renewal payment', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: 'rcy_' + 'a'.repeat(26), outcome: 'APPLIED', subscriptionId: 'sub_test' },
      pendingRecoveryResult: { scanned: 10, applied: 8, reconciliationRequired: 1, pendingRetry: 1 },
    });
    const body = JSON.stringify({
      event_id: 'evt_test_001',
      merchant_id: MERCHANT,
      content_type: 'payment_details',
      resource: { payment_id: 'pay_' + 'b'.repeat(26) },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body, signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );

    expect(response?.status).toBe(202);
    expect(f.pendingRecoveryCalls).toHaveLength(1);
    expect(f.pendingRecoveryCalls[0]).toMatchObject({
      env: { D1_01: f.env.D1_01, D1_04: f.env.D1_04 },
      options: { limit: 10 },
    });
    expect(await response?.json()).toMatchObject({
      data: {
        subscriptionSync: 'APPLIED',
        pendingRenewalRecovery: { scanned: 10, applied: 8, reconciliationRequired: 1, pendingRetry: 1 },
      },
    });
  });

  it('fulfills an initial membership purchase only after a verified payment_succeeded receipt has no renewal cycle', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
      purchaseFulfillmentResult: { outcome: 'APPLIED', fulfilledCount: 1 },
    });
    const paymentId = 'pay_' + 'c'.repeat(26);
    const body = JSON.stringify({
      event_id: 'evt_test_001',
      event_type: 'payment_succeeded',
      merchant_id: MERCHANT,
      content_type: 'payment_details',
      resource: { payment_id: paymentId },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body, signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );

    expect(response?.status).toBe(200);
    expect(f.receiptCalls).toHaveLength(1);
    expect(f.receiptCalls[0]).toMatchObject({ paymentId, merchantId: MERCHANT });
    expect(f.purchaseFulfillmentCalls).toHaveLength(1);
    expect(f.purchaseFulfillmentCalls[0]).toMatchObject({
      env: { D1_01: f.env.D1_01, D1_04: f.env.D1_04 },
      paymentId,
      merchantId: MERCHANT,
    });
    expect(await response?.json()).toMatchObject({
      data: {
        subscriptionSync: 'NO_RENEWAL_CYCLE',
        membershipPurchaseFulfillment: { outcome: 'APPLIED', fulfilledCount: 1 },
      },
    });
  });

  it('retries initial membership fulfillment from a duplicate signed success event', async () => {
    const f = fixture({
      result: receipt('DUPLICATE'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
      purchaseFulfillmentResult: { outcome: 'ALREADY_APPLIED', fulfilledCount: 1 },
    });
    const paymentId = 'pay_' + 'e'.repeat(26);
    const body = JSON.stringify({
      event_id: 'evt_test_replayed',
      event_type: 'payment_succeeded',
      merchant_id: MERCHANT,
      content_type: 'payment_details',
      resource: { payment_id: paymentId },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body, signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );

    expect(response?.status).toBe(200);
    expect(f.purchaseFulfillmentCalls).toHaveLength(1);
    expect(f.purchaseFulfillmentCalls[0]).toMatchObject({ paymentId, merchantId: MERCHANT });
    await expect(response?.json()).resolves.toMatchObject({
      data: {
        outcome: 'DUPLICATE',
        subscriptionSync: 'NO_RENEWAL_CYCLE',
        membershipPurchaseFulfillment: { outcome: 'ALREADY_APPLIED', fulfilledCount: 1 },
      },
    });
  });

  it('returns retryable service unavailable when paid-order fulfillment fails after payment was durably accepted', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
    });
    f.dependencies.fulfillPaidOrder = async () => {
      throw new Error('temporary D1-01 write failure');
    };
    const body = JSON.stringify({
      event_id: 'evt_test_fulfillment_retry',
      event_type: 'payment_succeeded',
      merchant_id: MERCHANT,
      content_type: 'payment_details',
      resource: { payment_id: 'pay_' + 'f'.repeat(26) },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body, signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
  });

  it('does not fulfill an ordinary failed payment as an initial membership purchase', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
      purchaseFulfillmentResult: { outcome: 'APPLIED', fulfilledCount: 1 },
    });
    const body = JSON.stringify({
      event_id: 'evt_test_001',
      event_type: 'payment_failed',
      merchant_id: MERCHANT,
      content_type: 'payment_details',
      resource: { payment_id: 'pay_' + 'd'.repeat(26) },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body, signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );

    expect(response?.status).toBe(200);
    expect(f.syncCalls).toHaveLength(1);
    expect(f.purchaseFulfillmentCalls).toHaveLength(0);
  });

  it('does not scan pending renewal outcomes for an ordinary payment with no renewal cycle', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
    });
    const body = JSON.stringify({
      event_id: 'evt_test_001',
      merchant_id: MERCHANT,
      content_type: 'payment_details',
      resource: { payment_id: 'pay_' + 'b'.repeat(26) },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body, signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );

    expect(response?.status).toBe(200);
    expect(f.syncCalls).toHaveLength(1);
    expect(f.pendingRecoveryCalls).toHaveLength(0);
    expect(await response?.json()).not.toMatchObject({ data: { pendingRenewalRecovery: expect.anything() } });
  });

  it('retries subscription outcome synchronization on a duplicate signed provider event', async () => {
    const f = fixture({
      result: receipt('DUPLICATE'),
      syncResult: { cycleId: 'rcy_' + 'a'.repeat(26), outcome: 'APPLIED', subscriptionId: 'sub_test' },
    });
    const body = JSON.stringify({
      event_id: 'evt_test_001',
      merchant_id: MERCHANT,
      content_type: 'payment_details',
      resource: { payment_id: 'pay_' + 'b'.repeat(26) },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body, signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(200);
    expect(f.syncCalls).toHaveLength(1);
    expect(await response?.json()).toMatchObject({ data: { outcome: 'DUPLICATE', subscriptionSync: 'APPLIED' } });
  });

  it('returns 202 for a durable reconciliation outcome rather than causing blind provider retries', async () => {
    const f = fixture({ result: receipt('RECONCILIATION_REQUIRED') });
    const response = await handleHyperswitchWebhookRequest(request(), f.env, f.dependencies);
    expect(response?.status).toBe(202);
    expect(await response?.json()).toMatchObject({
      data: { outcome: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED' },
    });
  });

  it('acknowledges the same signed event as a duplicate', async () => {
    const f = fixture({ result: receipt('DUPLICATE') });
    const response = await handleHyperswitchWebhookRequest(request(), f.env, f.dependencies);
    expect(response?.status).toBe(200);
    expect(await response?.json()).toMatchObject({ data: { outcome: 'DUPLICATE' } });
  });

  it('fails closed when the declared or streamed body is larger than 1 MiB', async () => {
    const declared = fixture();
    const declaredResponse = await handleHyperswitchWebhookRequest(
      request({ contentLength: String(1024 * 1024 + 1) }),
      declared.env,
      declared.dependencies,
    );
    expect(declaredResponse?.status).toBe(413);
    expect(declared.calls).toHaveLength(0);

    const streamed = fixture();
    const largeBody = new Uint8Array(1024 * 1024 + 1);
    const streamedResponse = await handleHyperswitchWebhookRequest(
      request({ body: largeBody }),
      streamed.env,
      streamed.dependencies,
    );
    expect(streamedResponse?.status).toBe(413);
    expect(streamed.calls).toHaveLength(0);
  });

  it('returns 401 for an invalid provider signature without revealing secret material', async () => {
    const f = fixture({ error: new PaymentPersistenceError('INVALID_SIGNATURE', 401) });
    const response = await handleHyperswitchWebhookRequest(
      request({ signature: 'invalid' }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(401);
    const body = await response!.text();
    expect(body).toContain('INVALID_SIGNATURE');
    expect(body).not.toContain(SECRET);
  });

  it('returns 503 when webhook secret or merchant configuration is absent', async () => {
    const f = fixture();
    const response = await handleHyperswitchWebhookRequest(
      request(),
      { ...f.env, HYPERSWITCH_WEBHOOK_SECRET: undefined },
      f.dependencies,
    );
    expect(response?.status).toBe(503);
    expect(f.calls).toHaveLength(0);
  });
});
