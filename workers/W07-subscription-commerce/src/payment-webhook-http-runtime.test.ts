import { describe, expect, it, vi } from 'vitest';
import { handleHyperswitchWebhookRequest } from './payment-webhook-http-runtime.js';
import {
  PaymentPersistenceError,
  type WebhookReceiptResult,
  type ReceiveHyperswitchWebhookInput,
} from './payment-contracts.js';
import {
  syncRenewalCycleOutcomeForPayment,
  type RenewalOutcomeSyncResult,
} from './subscription-renewal-outcome.js';
import {
  fulfillPaidMembershipOrder,
  type PaidMembershipPurchaseFulfillmentResult,
} from './paid-membership-order-fulfillment.js';
import type { BillingDocumentDto } from './billing-contracts.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';

const SECRET = 'hyperswitch-webhook-test-secret';
const MERCHANT = 'merchant_test';
const CORRELATION_ID = 'corr_test_001';
const BODY = JSON.stringify({
  event_id: 'evt_test_001',
  merchant_id: 'merchant_test',
  event_type: 'mandate_active',
  content: {
    type: 'mandate_details',
    object: { mandate_id: 'provider_mandate_001', payment_method_id: 'pm_test_001', status: 'active' },
  },
});

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

type OutcomeEnv = Parameters<typeof syncRenewalCycleOutcomeForPayment>[0];
type FulfillmentEnv = Parameters<typeof fulfillPaidMembershipOrder>[0];

function eventContentType(input: ReceiveHyperswitchWebhookInput): string | null {
  try {
    const envelope: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody));
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) return null;
    const row = envelope as Record<string, unknown>;
    const content = typeof row.content === 'object' && row.content !== null && !Array.isArray(row.content)
      ? row.content as Record<string, unknown>
      : null;
    const value = row.content_type ?? content?.type;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function fixture(options: {
  result?: WebhookReceiptResult;
  error?: Error;
  syncResult?: RenewalOutcomeSyncResult;
  pendingRecoveryResult?: Readonly<{ scanned: number; applied: number; reconciliationRequired: number; pendingRetry: number }>;
  purchaseFulfillmentResult?: PaidMembershipPurchaseFulfillmentResult;
  poolAvailable?: boolean;
  nativeRefundResult?: WebhookReceiptResult;
  nativePaymentResult?: WebhookReceiptResult;
  nativeMandateResult?: WebhookReceiptResult;
} = {}) {
  const syncCalls: Array<{ env: OutcomeEnv; paymentId: string; merchantId: string }> = [];
  const pendingRecoveryCalls: Array<{ env: OutcomeEnv; options?: Readonly<{ limit?: number }> }> = [];
  const purchaseFulfillmentCalls: Array<{ env: FulfillmentEnv; paymentId: string; merchantId: string }> = [];
  const postgresCalls: Array<{ pool: unknown; input: ReceiveHyperswitchWebhookInput }> = [];
  const postgresPaymentCalls: Array<{ pool: unknown; input: ReceiveHyperswitchWebhookInput }> = [];
  const postgresMandateCalls: Array<{ pool: unknown; input: ReceiveHyperswitchWebhookInput }> = [];
  const postgresReceiptCalls: Array<{ pool: unknown; paymentId: string; merchantId: string }> = [];
  const postgresPool = {} as W07WebhookPostgresPool;
  const membershipPostgresPool = { marker: 'neon-membership-pool' } as unknown as W07WebhookPostgresPool;
  const nativeUpgradeExpiryCalls: Array<{ financePool: unknown; membershipPool: unknown; paymentId: string; merchantId: string }> = [];
  const foundingCommitCalls: Array<{ membershipPool: unknown; financePool: unknown; paymentId: string; merchantId: string; eventId: string }> = [];

  const syncRenewalOutcome = async (
    env: OutcomeEnv,
    paymentId: string,
    merchantId: string,
  ): Promise<RenewalOutcomeSyncResult> => {
    syncCalls.push({ env, paymentId, merchantId });
    return options.syncResult ?? { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' };
  };
  const syncPendingOutcomes = async (
    env: OutcomeEnv,
    recoveryOptions?: Readonly<{ limit?: number }>,
  ) => {
    pendingRecoveryCalls.push({ env, options: recoveryOptions });
    return options.pendingRecoveryResult ?? { scanned: 0, applied: 0, reconciliationRequired: 0, pendingRetry: 0 };
  };
  const fulfillPaidOrder = async (
    env: FulfillmentEnv,
    paymentId: string,
    merchantId: string,
  ): Promise<PaidMembershipPurchaseFulfillmentResult> => {
    purchaseFulfillmentCalls.push({ env, paymentId, merchantId });
    return options.purchaseFulfillmentResult ?? { outcome: 'NOT_APPLICABLE', fulfilledCount: 0 };
  };

  const env = {
    W07_DATABASE_DRIVER: 'neon',
    W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
    HYPERSWITCH_WEBHOOK_SECRET: SECRET,
    HYPERSWITCH_MERCHANT_ID: MERCHANT,
  };
  const getWebhookPostgresPool = vi.fn(() =>
    options.poolAvailable === false ? undefined : postgresPool,
  );
  const dependencies = {
    getWebhookPostgresPool,
    getMembershipPostgresPool: () => membershipPostgresPool,
    receiveRefundWebhookPostgres: async (
      pool: W07WebhookPostgresPool,
      input: ReceiveHyperswitchWebhookInput,
    ) => {
      if (eventContentType(input) !== 'refund_details') return null;
      postgresCalls.push({ pool, input });
      if (options.error) throw options.error;
      return options.nativeRefundResult ?? options.result ?? receipt();
    },
    receivePaymentWebhookPostgres: async (
      pool: W07WebhookPostgresPool,
      input: ReceiveHyperswitchWebhookInput,
    ) => {
      if (eventContentType(input) !== 'payment_details') return null;
      postgresPaymentCalls.push({ pool, input });
      if (options.error) throw options.error;
      return options.nativePaymentResult ?? options.result ?? receipt();
    },
    receiveMandateWebhookPostgres: async (
      pool: W07WebhookPostgresPool,
      input: ReceiveHyperswitchWebhookInput,
    ) => {
      if (eventContentType(input) !== 'mandate_details') return null;
      postgresMandateCalls.push({ pool, input });
      if (options.error) throw options.error;
      return options.nativeMandateResult ?? options.result ?? receipt();
    },
    issueReceiptPostgres: async (
      pool: W07WebhookPostgresPool,
      paymentId: string,
      merchantId: string,
    ) => {
      postgresReceiptCalls.push({ pool, paymentId, merchantId });
      return {} as BillingDocumentDto;
    },
    syncRenewalOutcome,
    syncPendingOutcomes,
    fulfillPaidOrder,
    commitFoundingReservation: async (
      membershipPool: W07WebhookPostgresPool,
      financePool: W07WebhookPostgresPool,
      paymentId: string,
      merchantId: string,
      eventId: string,
    ) => {
      foundingCommitCalls.push({ membershipPool, financePool, paymentId, merchantId, eventId });
      return null;
    },
    expirePendingPlanUpgradePostgres: async (
      financePool: W07WebhookPostgresPool,
      membershipPool: W07WebhookPostgresPool,
      paymentId: string,
      merchantId: string,
    ) => {
      nativeUpgradeExpiryCalls.push({ financePool, membershipPool, paymentId, merchantId });
    },
  };
  return {
    env,
    dependencies,
    postgresPool,
    membershipPostgresPool,
    syncCalls,
    pendingRecoveryCalls,
    purchaseFulfillmentCalls,
    postgresCalls,
    postgresPaymentCalls,
    postgresMandateCalls,
    postgresReceiptCalls,
    nativeUpgradeExpiryCalls,
    foundingCommitCalls,
  };
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

function paymentEvent(
  paymentId: string,
  eventType = 'payment_succeeded',
  nested = false,
) {
  return JSON.stringify({
    event_id: 'evt_' + paymentId,
    event_type: eventType,
    merchant_id: MERCHANT,
    ...(nested
      ? { content: { type: 'payment_details', object: { payment_id: paymentId, merchant_id: MERCHANT, status: 'succeeded', amount: 300, currency: 'USD' } } }
      : { content_type: 'payment_details', resource: { payment_id: paymentId } }),
  });
}

describe('W07 Hyperswitch webhook HTTP receiver', () => {
  it('does not claim unrelated routes or accept calls outside the W01 service binding', async () => {
    const f = fixture();
    await expect(
      handleHyperswitchWebhookRequest(request({ pathname: '/memberships/subscriptions' }), f.env, f.dependencies),
    ).resolves.toBeNull();
    const denied = await handleHyperswitchWebhookRequest(
      request({ caller: 'internet-client' }),
      f.env,
      f.dependencies,
    );
    expect(denied?.status).toBe(403);
    expect(f.dependencies.getWebhookPostgresPool).not.toHaveBeenCalled();
  });

  it('passes the exact bounded raw bytes and provider signature to the native Neon mandate store', async () => {
    const f = fixture();
    const signature = 'b'.repeat(128);
    const rawBody = JSON.stringify({
      event_id: 'evt_mandate_raw',
      merchant_id: MERCHANT,
      content: {
        type: 'mandate_details',
        object: { mandate_id: 'provider_mandate_001', payment_method_id: 'pm_test_001', status: 'active' },
      },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body: rawBody, signature }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(200);
    expect(f.dependencies.getWebhookPostgresPool).toHaveBeenCalledOnce();
    expect(f.postgresMandateCalls).toHaveLength(1);
    const input = f.postgresMandateCalls[0]!.input;
    expect(new TextDecoder().decode(input.rawBody)).toBe(rawBody);
    expect(input.signatureHeader).toBe(signature);
    expect(input.webhookSecret).toBe(SECRET);
    expect(input.expectedMerchantId).toBe(MERCHANT);
    expect(f.postgresMandateCalls[0]!.pool).toBe(f.postgresPool);
  });

  it('synchronizes signed renewal payments using independent finance and membership Neon pools', async () => {
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
    const response = await handleHyperswitchWebhookRequest(
      request({ body: paymentEvent(paymentId, 'payment_succeeded', true), signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(202);
    expect(f.postgresPaymentCalls).toHaveLength(1);
    expect(f.postgresPaymentCalls[0]?.pool).toBe(f.postgresPool);
    expect(f.syncCalls).toMatchObject([{
      env: {
        W07_DATABASE_DRIVER: 'neon',
        W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
      },
      paymentId,
      merchantId: MERCHANT,
    }]);
    expect(f.nativeUpgradeExpiryCalls).toMatchObject([{
      financePool: f.postgresPool,
      membershipPool: f.membershipPostgresPool,
      paymentId,
      merchantId: MERCHANT,
    }]);
    expect(await response?.json()).toMatchObject({
      data: {
        outcome: 'APPLIED',
        subscriptionSync: 'RECONCILIATION_REQUIRED',
        subscriptionSyncReason: 'SUBSCRIPTION_PERIOD_CAS_MISMATCH',
        subscriptionId: 'sub_test',
      },
    });
  });

  it('issues a receipt and fulfills an initial creator membership only after a durable signed payment success', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
      purchaseFulfillmentResult: { outcome: 'APPLIED', fulfilledCount: 1 },
    });
    const paymentId = 'pay_' + 'c'.repeat(26);
    const response = await handleHyperswitchWebhookRequest(
      request({ body: paymentEvent(paymentId), signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(200);
    expect(f.postgresReceiptCalls).toMatchObject([{ pool: f.postgresPool, paymentId, merchantId: MERCHANT }]);
    expect(f.purchaseFulfillmentCalls).toMatchObject([{
      env: {
        W07_DATABASE_DRIVER: 'neon',
        W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
      },
      paymentId,
      merchantId: MERCHANT,
    }]);
    expect(f.nativeUpgradeExpiryCalls).toMatchObject([{
      financePool: f.postgresPool,
      membershipPool: f.membershipPostgresPool,
      paymentId,
      merchantId: MERCHANT,
    }]);
    expect(await response?.json()).toMatchObject({
      data: {
        subscriptionSync: 'NO_RENEWAL_CYCLE',
        membershipPurchaseFulfillment: { outcome: 'APPLIED', fulfilledCount: 1 },
      },
    });
  });

  it('retries a duplicate signed success by reusing the same Neon persistence and idempotent fulfillment', async () => {
    const f = fixture({
      result: receipt('DUPLICATE'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
      purchaseFulfillmentResult: { outcome: 'ALREADY_APPLIED', fulfilledCount: 1 },
    });
    const paymentId = 'pay_' + 'd'.repeat(26);
    const response = await handleHyperswitchWebhookRequest(
      request({ body: paymentEvent(paymentId), signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(200);
    expect(f.postgresReceiptCalls).toMatchObject([{ pool: f.postgresPool, paymentId, merchantId: MERCHANT }]);
    expect(f.purchaseFulfillmentCalls).toHaveLength(1);
    expect(await response?.json()).toMatchObject({
      data: {
        outcome: 'DUPLICATE',
        subscriptionSync: 'NO_RENEWAL_CYCLE',
        membershipPurchaseFulfillment: { outcome: 'ALREADY_APPLIED', fulfilledCount: 1 },
      },
    });
  });

  it('does not fulfill failed payments and does not run pending recovery without an applied renewal', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
    });
    const failed = await handleHyperswitchWebhookRequest(
      request({
        body: paymentEvent('pay_' + 'e'.repeat(26), 'payment_failed'),
        signature: 'signed-provider-event',
      }),
      f.env,
      f.dependencies,
    );
    expect(failed?.status).toBe(200);
    expect(f.purchaseFulfillmentCalls).toHaveLength(0);
    expect(f.postgresReceiptCalls).toHaveLength(0);
    expect(f.pendingRecoveryCalls).toHaveLength(0);
  });

  it('runs bounded pending renewal recovery after successful cycle synchronization', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: 'rcy_' + 'f'.repeat(26), outcome: 'APPLIED', subscriptionId: 'sub_test' },
      pendingRecoveryResult: { scanned: 10, applied: 8, reconciliationRequired: 1, pendingRetry: 1 },
    });
    const response = await handleHyperswitchWebhookRequest(
      request({ body: paymentEvent('pay_' + 'f'.repeat(26), 'payment_succeeded'), signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(202);
    expect(f.pendingRecoveryCalls).toMatchObject([{
      env: {
        W07_DATABASE_DRIVER: 'neon',
        W07_MEMBERSHIP_DATABASE_DRIVER: 'neon',
      },
      options: { limit: 10 },
    }]);
  });

  it('uses the native PostgreSQL stores for refund and mandate lifecycle events', async () => {
    const mandate = fixture();
    const mandateResponse = await handleHyperswitchWebhookRequest(
      request(),
      mandate.env,
      mandate.dependencies,
    );
    expect(mandateResponse?.status).toBe(200);
    expect(mandate.postgresMandateCalls).toHaveLength(1);
    expect(mandate.postgresPaymentCalls).toHaveLength(0);
    expect(mandate.postgresCalls).toHaveLength(0);

    const refund = fixture();
    const refundBody = JSON.stringify({
      event_id: 'evt_refund_native_01',
      event_type: 'refund_succeeded',
      merchant_id: MERCHANT,
      content: {
        type: 'refund_details',
        object: {
          refund_id: 'ref_' + 'r'.repeat(26),
          payment_id: 'pay_' + 'p'.repeat(26),
          amount: 300,
          currency: 'USD',
          status: 'succeeded',
          updated_at: '2026-11-18T12:00:01.000Z',
        },
      },
    });
    const refundResponse = await handleHyperswitchWebhookRequest(
      request({ body: refundBody, signature: 'signed-provider-event' }),
      refund.env,
      refund.dependencies,
    );
    expect(refundResponse?.status).toBe(200);
    expect(refund.postgresCalls).toHaveLength(1);
    expect(refund.postgresPaymentCalls).toHaveLength(0);
    expect(refund.postgresMandateCalls).toHaveLength(0);
    expect(refund.syncCalls).toHaveLength(0);
  });

  it('rejects unknown provider event content and missing Neon pool without any D1 fallback', async () => {
    const unknown = fixture();
    const unknownResponse = await handleHyperswitchWebhookRequest(
      request({
        body: JSON.stringify({
          event_id: 'evt_unknown_001',
          merchant_id: MERCHANT,
          content: { type: 'unknown_details', object: {} },
        }),
        signature: 'signed-provider-event',
      }),
      unknown.env,
      unknown.dependencies,
    );
    expect(unknownResponse?.status).toBe(400);
    expect(unknown.postgresCalls).toHaveLength(0);
    expect(unknown.postgresMandateCalls).toHaveLength(0);
    expect(unknown.postgresPaymentCalls).toHaveLength(0);

    const unavailable = fixture({ poolAvailable: false });
    const unavailableResponse = await handleHyperswitchWebhookRequest(
      request(),
      unavailable.env,
      unavailable.dependencies,
    );
    expect(unavailableResponse?.status).toBe(503);
    expect(unavailable.postgresCalls).toHaveLength(0);
    expect(unavailable.postgresMandateCalls).toHaveLength(0);
    expect(unavailable.postgresPaymentCalls).toHaveLength(0);
  });

  it('rejects non-Neon selection and missing webhook configuration before database access', async () => {
    const wrongDriver = fixture();
    const wrongDriverResponse = await handleHyperswitchWebhookRequest(
      request(),
      { ...wrongDriver.env, W07_DATABASE_DRIVER: 'd1' },
      wrongDriver.dependencies,
    );
    expect(wrongDriverResponse?.status).toBe(503);
    expect(wrongDriver.dependencies.getWebhookPostgresPool).not.toHaveBeenCalled();

    const unconfigured = fixture();
    const configResponse = await handleHyperswitchWebhookRequest(
      request(),
      { ...unconfigured.env, HYPERSWITCH_WEBHOOK_SECRET: undefined },
      unconfigured.dependencies,
    );
    expect(configResponse?.status).toBe(503);
    expect(unconfigured.dependencies.getWebhookPostgresPool).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid provider signature without exposing secret material', async () => {
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

  it('commits a founding seat only after a verified successful initial membership payment', async () => {
    const f = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
    });
    const paymentId = 'pay_' + 'h'.repeat(26);
    const response = await handleHyperswitchWebhookRequest(
      request({ body: paymentEvent(paymentId), signature: 'signed-provider-event' }),
      f.env,
      f.dependencies,
    );
    expect(response?.status).toBe(200);
    expect(f.purchaseFulfillmentCalls).toHaveLength(1);
    expect(f.foundingCommitCalls).toEqual([{
      membershipPool: f.membershipPostgresPool,
      financePool: f.postgresPool,
      paymentId,
      merchantId: MERCHANT,
      eventId: 'evt_test_001',
    }]);
  });

  it('returns 202 for durable reconciliation and 503 when post-commit fulfillment must retry', async () => {
    const reconciliation = fixture({ result: receipt('RECONCILIATION_REQUIRED') });
    const reconciliationResponse = await handleHyperswitchWebhookRequest(
      request(),
      reconciliation.env,
      reconciliation.dependencies,
    );
    expect(reconciliationResponse?.status).toBe(202);

    const retry = fixture({
      result: receipt('APPLIED'),
      syncResult: { cycleId: '', outcome: 'NO_RENEWAL_CYCLE' },
    });
    retry.dependencies.fulfillPaidOrder = async () => {
      throw new Error('temporary Neon membership write failure');
    };
    const retryResponse = await handleHyperswitchWebhookRequest(
      request({ body: paymentEvent('pay_' + 'g'.repeat(26)), signature: 'signed-provider-event' }),
      retry.env,
      retry.dependencies,
    );
    expect(retryResponse?.status).toBe(503);
    expect(await retryResponse?.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  it('rejects declared and streamed request bodies over the 1 MiB cap before Neon access', async () => {
    const declared = fixture();
    const declaredResponse = await handleHyperswitchWebhookRequest(
      request({ contentLength: String(1024 * 1024 + 1) }),
      declared.env,
      declared.dependencies,
    );
    expect(declaredResponse?.status).toBe(413);
    expect(declared.dependencies.getWebhookPostgresPool).not.toHaveBeenCalled();

    const streamed = fixture();
    const streamedResponse = await handleHyperswitchWebhookRequest(
      request({ body: new Uint8Array(1024 * 1024 + 1) }),
      streamed.env,
      streamed.dependencies,
    );
    expect(streamedResponse?.status).toBe(413);
    expect(streamed.dependencies.getWebhookPostgresPool).not.toHaveBeenCalled();
  });
});
