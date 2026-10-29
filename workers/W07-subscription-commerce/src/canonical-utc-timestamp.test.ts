import { describe, expect, it } from 'vitest';
import { parseCanonicalUtcTimestamp, strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js';

describe('canonical UTC timestamp validation', () => {
  it('accepts exact canonical UTC timestamps and real leap days', () => {
    expect(parseCanonicalUtcTimestamp('2024-02-29T12:34:56.789Z')).not.toBeNull();
    expect(parseCanonicalUtcTimestamp('2026-10-29T12:34:56.789Z')).not.toBeNull();
  });

  it.each([
    '2026-02-31T12:00:00.000Z',
    '2026-02-29T12:00:00.000Z',
    '2026-10-29T25:00:00.000Z',
    '2026-10-29T12:00:60.000Z',
    '2026-10-29T12:00:00Z',
    '2026-10-29T12:00:00.000+00:00',
    '0000-01-01T00:00:00.000Z',
  ])('rejects malformed or non-canonical persisted timestamp %s', (value) => {
    expect(parseCanonicalUtcTimestamp(value)).toBeNull();
  });

  it('chooses now when it is later and increments the prior timestamp by one millisecond otherwise', () => {
    expect(strictlyAfterCanonicalUtcTimestamp(
      '2026-10-29T12:00:00.002Z',
      '2026-10-29T12:00:00.001Z',
    )).toBe('2026-10-29T12:00:00.002Z');
    expect(strictlyAfterCanonicalUtcTimestamp(
      '2026-10-29T12:00:00.001Z',
      '2026-10-29T12:00:00.001Z',
    )).toBe('2026-10-29T12:00:00.002Z');
  });

  it('fails closed rather than normalizing invalid prior state or overflowing the canonical representation', () => {
    expect(strictlyAfterCanonicalUtcTimestamp(
      '2026-10-29T12:00:00.000Z',
      '2026-02-31T12:00:00.000Z',
    )).toBeNull();
    expect(strictlyAfterCanonicalUtcTimestamp(
      '9999-12-31T23:59:59.999Z',
      '9999-12-31T23:59:59.999Z',
    )).toBeNull();
  });
});
