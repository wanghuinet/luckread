import { describe, expect, it } from 'vitest';
import { shouldDeferWebTrialExpiry, type WebTrialExpiryCycle } from './membership-trial-runtime.js';

function cycle(overrides: Partial<WebTrialExpiryCycle> = {}): WebTrialExpiryCycle {
  return {
    state: 'PREPARED',
    attempt_number: 1,
    subscription_sync_state: 'PENDING',
    mandate_record_id: 'mnd_' + 'a'.repeat(26),
    outcome_code: null,
    payment_id: 'pay_' + 'b'.repeat(26),
    order_id: 'ord_trial_1',
    ...overrides,
  };
}

describe('web trial expiry and renewal payment safety', () => {
  it('expires an ended trial when no renewal cycle exists', () => {
    expect(shouldDeferWebTrialExpiry('CANCELED', null, false)).toBe(false);
    expect(shouldDeferWebTrialExpiry('TRIALING', null, false)).toBe(false);
  });

  it('does not expire while a provider submission or lease may still charge', () => {
    expect(shouldDeferWebTrialExpiry('CANCELED', cycle({ state: 'SUBMITTING' }), false)).toBe(true);
    expect(shouldDeferWebTrialExpiry('CANCELED', cycle({ state: 'SUBMITTED' }), false)).toBe(true);
  });

  it('waits for successful and failed payment outcomes to synchronize before closing access', () => {
    expect(shouldDeferWebTrialExpiry('CANCELED', cycle({
      state: 'SUCCEEDED',
      subscription_sync_state: 'PENDING',
    }), false)).toBe(true);
    expect(shouldDeferWebTrialExpiry('CANCELED', cycle({
      state: 'FAILED',
      subscription_sync_state: 'RECONCILIATION_REQUIRED',
    }), false)).toBe(true);
  });

  it('expires after a proven pre-submit cancellation guard with no provider charge', () => {
    for (const outcomeCode of [
      'SUBSCRIPTION_NOT_CHARGEABLE_BEFORE_ORDER',
      'SUBSCRIPTION_NOT_CHARGEABLE_AT_SUBMISSION',
      'MANDATE_NOT_ACTIVE',
      'MANDATE_NOT_ACTIVE_AT_SUBMISSION',
      'PREPARED_SNAPSHOT_INCOMPLETE',
    ]) {
      expect(shouldDeferWebTrialExpiry('CANCELED', cycle({
        state: 'RECONCILIATION_REQUIRED',
        outcome_code: outcomeCode,
        subscription_sync_state: 'PENDING',
      }), false)).toBe(false);
    }
  });

  it('keeps uncertain provider reconciliation open even without a local payment reference', () => {
    expect(shouldDeferWebTrialExpiry('CANCELED', cycle({
      state: 'RECONCILIATION_REQUIRED',
      outcome_code: 'PROVIDER_SUBMISSION_UNCERTAIN',
      payment_id: null,
    }), false)).toBe(true);
  });

  it('keeps an uncanceled trial for an active mandate or a retryable failed charge', () => {
    expect(shouldDeferWebTrialExpiry('TRIALING', cycle({
      state: 'AWAITING_MANDATE',
      mandate_record_id: null,
      payment_id: null,
      order_id: null,
    }), true)).toBe(true);
    expect(shouldDeferWebTrialExpiry('PAYMENT_FAILED', cycle({
      state: 'FAILED',
      attempt_number: 2,
      subscription_sync_state: 'APPLIED',
    }), true)).toBe(true);
    expect(shouldDeferWebTrialExpiry('PAYMENT_FAILED', cycle({
      state: 'FAILED',
      attempt_number: 5,
      subscription_sync_state: 'APPLIED',
    }), true)).toBe(false);
  });

  it('does not retain a canceled trial for a mandate wait or a non-chargeable prepared cycle', () => {
    expect(shouldDeferWebTrialExpiry('CANCELED', cycle({
      state: 'AWAITING_MANDATE',
      mandate_record_id: null,
      payment_id: null,
      order_id: null,
    }), false)).toBe(false);
    expect(shouldDeferWebTrialExpiry('CANCELED', cycle({
      state: 'PREPARED',
    }), false)).toBe(false);
  });
});
