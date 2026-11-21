/**
 * D1-owned timestamps in the commerce runtime use one canonical UTC form.
 * Date.parse alone can normalize impossible dates, so round-trip before use.
 */
const CANONICAL_UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

export function parseCanonicalUtcTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !CANONICAL_UTC_TIMESTAMP.test(value)) return null;
  const year = Number(value.slice(0, 4));
  if (year < 1) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value ? millis : null;
}

/**
 * Return a strictly increasing canonical UTC timestamp, or null when either
 * persisted/current input is malformed or advancing would leave the supported
 * four-digit-year representation. Never normalize corrupted stored state.
 */
export function strictlyAfterCanonicalUtcTimestamp(now: unknown, previous: unknown): string | null {
  const nowMillis = parseCanonicalUtcTimestamp(now);
  const previousMillis = parseCanonicalUtcTimestamp(previous);
  if (nowMillis === null || previousMillis === null) return null;
  if (nowMillis > previousMillis) return now as string;

  const next = new Date(previousMillis + 1);
  if (!Number.isFinite(next.getTime())) return null;
  const nextIso = next.toISOString();
  return parseCanonicalUtcTimestamp(nextIso) === null ? null : nextIso;
}
