import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  addBillingPeriod,
  etagForVersion,
  normalizeMembershipPlanDraft,
  parseBoundedPositiveInt,
  validateIdempotencyKey,
  validateIfMatch,
  validatePrincipal,
} from './subscription-runtime.js';

describe('W07 Neon-only membership runtime contract', () => {
  it('does not expose a D1 membership runtime or compatibility API', () => {
    const runtime = readFileSync(new URL('./subscription-runtime.ts', import.meta.url), 'utf8');
    const worker = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const membershipRuntime = readFileSync(new URL('./neon/membership-database-runtime.ts', import.meta.url), 'utf8');

    expect(runtime).not.toMatch(/D1Database|D1PreparedStatement|D1Result|\.prepare\(|\.batch\(|D1_01/);
    expect(worker).not.toMatch(/D1_01\s*:/);
    expect(worker).not.toContain('getW07SelectedD101Database');
    expect(membershipRuntime).not.toMatch(/D1Database|createPostgresD1Database|D1_01\s*\?/);
    expect(membershipRuntime).toContain("configured !== 'neon'");
    expect(membershipRuntime).toContain('HYPERDRIVE_D1_01');
  });

  it('keeps calendar-accurate monthly and yearly billing periods', () => {
    expect(addBillingPeriod('2026-01-31T12:30:00.000Z', 'MONTHLY'))
      .toBe('2026-02-28T12:30:00.000Z');
    expect(addBillingPeriod('2024-02-29T12:30:00.000Z', 'YEARLY'))
      .toBe('2025-02-28T12:30:00.000Z');
  });

  it('validates bounded pagination and rejects malformed limits', () => {
    expect(parseBoundedPositiveInt(null, 20, 50)).toBe(20);
    expect(parseBoundedPositiveInt('50', 20, 50)).toBe(50);
    expect(() => parseBoundedPositiveInt('0', 20, 50)).toThrow();
    expect(() => parseBoundedPositiveInt('51', 20, 50)).toThrow();
    expect(() => parseBoundedPositiveInt('1.5', 20, 50)).toThrow();
  });

  it('validates authenticated principal, idempotency key, and optimistic ETag inputs', () => {
    expect(validatePrincipal('user_001')).toBe('user_001');
    expect(validateIdempotencyKey('request_001')).toBe('request_001');
    expect(validateIfMatch('"lr-plan-v3"')).toBe('"lr-plan-v3"');
    expect(() => validatePrincipal('  ')).toThrow();
    expect(() => validateIdempotencyKey(null)).toThrow();
    expect(() => validateIfMatch('*')).toThrow();
    expect(etagForVersion(3)).toBe('"lr-v3"');
    expect(() => etagForVersion(0)).toThrow();
  });

  it('normalizes immutable plan terms and rejects malformed commercial values', () => {
    const plan = normalizeMembershipPlanDraft({
      name: 'Supporter',
      tier: 'supporter',
      billingInterval: 'MONTHLY',
      priceMinor: 500,
      currency: 'USD',
      benefits: ['member-posts'],
      trialPeriodDays: 7,
    });
    expect(plan).toMatchObject({
      name: 'Supporter',
      tier: 'supporter',
      billingInterval: 'MONTHLY',
      priceMinor: 500,
      currency: 'USD',
      benefits: ['member-posts'],
      trialPeriodDays: 7,
    });
    expect(() => normalizeMembershipPlanDraft({
      name: 'Supporter',
      tier: 'supporter',
      billingInterval: 'MONTHLY',
      priceMinor: -1,
      currency: 'USD',
      benefits: [],
      trialPeriodDays: 0,
    })).toThrow();
  });
});
