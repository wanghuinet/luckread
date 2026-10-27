import { describe, expect, it } from 'vitest';
import type { HyperswitchWebhookEnvelope } from './hyperswitch-webhook-signature.js';
import {
  validateHyperswitchPaymentWebhook,
  type KnownHyperswitchPaymentReference,
} from './hyperswitch-webhook-payment-validation.js';

const baseReference: KnownHyperswitchPaymentReference = {
  paymentId: 'pay_mbabizu24mvu3mela5njyhpit4',
  merchantId: 'merchant_luckread_test',
  amountMinor: 1200,
  currency: 'USD',
  lastProviderUpdatedAt: '2026-10-27T09:59:00Z',
};

const resource = (overrides: Record<string, unknown> = {}) => ({
  payment_id: baseReference.paymentId,
  merchant_id: baseReference.merchantId,
  amount: baseReference.amountMinor,
  currency: baseReference.currency,
  status: 'succeeded',
  updated: '2026-10-27T10:00:00Z',
  ...overrides,
});

const envelope = (
  eventType: string = 'payment_succeeded',
  overrides: Partial<HyperswitchWebhookEnvelope> = {},
): HyperswitchWebhookEnvelope => ({
  merchantId: baseReference.merchantId,
  eventId: 'evt_payment_test_123',
  eventType: eventType as HyperswitchWebhookEnvelope['eventType'],
  contentType: 'payment_details',
  resource: resource(),
  ...overrides,
});

describe('Hyperswitch payment webhook semantic validation', () => {
  it('validates a newer, identity-matched payment_succeeded event without granting entitlement', () => {
    expect(validateHyperswitchPaymentWebhook(envelope(), baseReference)).toEqual({
      outcome: 'VALIDATED',
      eventId: 'evt_payment_test_123',
      paymentId: baseReference.paymentId,
      eventType: 'payment_succeeded',
      providerStatus: 'succeeded',
      providerUpdatedAt: '2026-10-27T10:00:00Z',
    });
  });

  it('accepts only the precise status semantics currently covered by contract tests', () => {
    const pairs = [
      ['payment_succeeded', 'succeeded'],
      ['payment_failed', 'failed'],
      ['payment_processing', 'processing'],
      ['payment_cancelled', 'cancelled'],
      ['payment_cancelled_post_capture', 'cancelled_post_capture'],
      ['payment_expired', 'expired'],
    ] as const;

    for (const [eventType, status] of pairs) {
      const result = validateHyperswitchPaymentWebhook(
        envelope(eventType, { resource: resource({ status }) }),
        baseReference,
      );
      expect(result).toMatchObject({ outcome: 'VALIDATED', eventType, providerStatus: status });
    }
  });

  it('rejects a merchant mismatch in the envelope or payment resource', () => {
    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { merchantId: 'merchant_other' }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'MERCHANT_MISMATCH' });

    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ merchant_id: 'merchant_other' }) }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'MERCHANT_MISMATCH' });
  });

  it('rejects payment ID mismatches and malformed payment identifiers', () => {
    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ payment_id: 'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa' }) }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'PAYMENT_ID_MISMATCH' });
    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ payment_id: 'not-a-payment' }) }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'PAYMENT_ID_MISMATCH' });
  });

  it('rejects amount mismatch and non-integer or non-positive resource amounts', () => {
    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ amount: 1201 }) }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'AMOUNT_MISMATCH' });

    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1200']) {
      expect(validateHyperswitchPaymentWebhook(
        envelope('payment_succeeded', { resource: resource({ amount }) }),
        baseReference,
      )).toEqual({ outcome: 'REJECT', reason: 'RESOURCE_SHAPE_INVALID' });
    }
  });

  it('rejects currency mismatch and malformed currency values', () => {
    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ currency: 'EUR' }) }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'CURRENCY_MISMATCH' });

    for (const currency of ['usd', 'US', 'USD ']) {
      expect(validateHyperswitchPaymentWebhook(
        envelope('payment_succeeded', { resource: resource({ currency }) }),
        baseReference,
      )).toEqual({ outcome: 'REJECT', reason: 'RESOURCE_SHAPE_INVALID' });
    }
  });

  it('rejects event/status contradictions rather than trusting the event name', () => {
    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ status: 'processing' }) }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'EVENT_STATUS_MISMATCH' });

    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_failed', { resource: resource({ status: 'succeeded' }) }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'EVENT_STATUS_MISMATCH' });
  });

  it('treats unknown provider statuses as reconciliation-only', () => {
    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ status: 'settled_fake' }) }),
      baseReference,
    )).toEqual({
      outcome: 'RECONCILIATION_REQUIRED',
      reason: 'UNKNOWN_PROVIDER_STATUS',
      eventId: 'evt_payment_test_123',
      paymentId: baseReference.paymentId,
    });
  });

  it('does not auto-apply authorization, partial capture, refund, dispute, payout or invoice semantics', () => {
    for (const [eventType, status] of [
      ['payment_authorized', 'requires_capture'],
      ['payment_captured', 'succeeded'],
      ['refund_succeeded', 'succeeded'],
      ['dispute_won', 'succeeded'],
      ['payout_success', 'succeeded'],
      ['invoice_paid', 'succeeded'],
    ] as const) {
      const result = validateHyperswitchPaymentWebhook(
        envelope(eventType, { resource: resource({ status }) }),
        baseReference,
      );
      expect(result).toMatchObject({
        outcome: 'RECONCILIATION_REQUIRED',
        reason: 'UNSUPPORTED_EVENT_SEMANTICS',
      });
    }
  });

  it('requires resource.updated for ordering and reconciliation', () => {
    const missing = { ...resource() };
    delete (missing as Record<string, unknown>).updated;
    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: missing }),
      baseReference,
    )).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', reason: 'MISSING_PROVIDER_UPDATED' });

    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ updated: 'yesterday' }) }),
      baseReference,
    )).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', reason: 'INVALID_PROVIDER_UPDATED' });

    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ updated: '2026-02-31T10:00:00Z' }) }),
      baseReference,
    )).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', reason: 'INVALID_PROVIDER_UPDATED' });

    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { resource: resource({ updated: `2026-10-27T10:00:00.${'1'.repeat(65)}Z` }) }),
      baseReference,
    )).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', reason: 'INVALID_PROVIDER_UPDATED' });
  });

  it('marks equal-timestamp and older events stale, preventing duplicate/out-of-order state regression', () => {
    for (const timestamp of [
      baseReference.lastProviderUpdatedAt,
      '2026-10-27T09:58:59Z',
    ]) {
      const result = validateHyperswitchPaymentWebhook(
        envelope('payment_succeeded', { resource: resource({ updated: timestamp }) }),
        baseReference,
      );
      expect(result).toMatchObject({ outcome: 'STALE', eventId: 'evt_payment_test_123' });
    }
  });

  it('requires reconciliation when stored provider timestamp is invalid', () => {
    expect(validateHyperswitchPaymentWebhook(
      envelope(),
      { ...baseReference, lastProviderUpdatedAt: 'not-a-date' },
    )).toMatchObject({
      outcome: 'RECONCILIATION_REQUIRED',
      reason: 'INVALID_STORED_PROVIDER_UPDATED',
    });
  });

  it('allows a first event only when the local reference has no stored provider timestamp', () => {
    expect(validateHyperswitchPaymentWebhook(
      envelope(),
      { ...baseReference, lastProviderUpdatedAt: null },
    )).toMatchObject({ outcome: 'VALIDATED' });
  });

  it('rejects non-payment content types', () => {
    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { contentType: 'refund_details' }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'INVALID_ENVELOPE' });
  });

  it('rejects invalid local financial references before making a decision', () => {
    for (const reference of [
      { ...baseReference, amountMinor: 0 },
      { ...baseReference, amountMinor: 1.25 },
      { ...baseReference, currency: 'usd' },
      { ...baseReference, paymentId: 'bad' },
      { ...baseReference, merchantId: ' ' },
    ]) {
      expect(validateHyperswitchPaymentWebhook(envelope(), reference)).toEqual({
        outcome: 'REJECT',
        reason: 'INVALID_LOCAL_REFERENCE',
      });
    }
  });

  it('rejects malformed envelopes and unknown event values', () => {
    expect(validateHyperswitchPaymentWebhook(null, baseReference)).toEqual({
      outcome: 'REJECT',
      reason: 'INVALID_ENVELOPE',
    });

    expect(validateHyperswitchPaymentWebhook(
      envelope('not_a_real_event'),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'INVALID_ENVELOPE' });

    expect(validateHyperswitchPaymentWebhook(
      envelope('payment_succeeded', { eventId: '   ' }),
      baseReference,
    )).toEqual({ outcome: 'REJECT', reason: 'INVALID_ENVELOPE' });
  });
});
