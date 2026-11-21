export const MIN_POLL_DURATION_MINUTES = 5;
export const MAX_POLL_DURATION_MINUTES = 7 * 24 * 60;
export const DEFAULT_POLL_DURATION_MINUTES = 24 * 60;

export type PollDurationParts = {
  days: string;
  hours: string;
  minutes: string;
};

export function getPollDurationParts(durationMinutes: number): PollDurationParts {
  const safeDuration = Number.isSafeInteger(durationMinutes) &&
    durationMinutes >= MIN_POLL_DURATION_MINUTES &&
    durationMinutes <= MAX_POLL_DURATION_MINUTES
    ? durationMinutes
    : DEFAULT_POLL_DURATION_MINUTES;
  const days = Math.floor(safeDuration / 1440);
  const remainder = safeDuration % 1440;
  const hours = Math.floor(remainder / 60);
  const minutes = remainder % 60;
  return {
    days: String(days),
    hours: String(hours),
    minutes: String(minutes),
  };
}

/** Returns null while any field is incomplete or outside X-compatible bounds. */
export function getPollDurationMinutes(parts: PollDurationParts): number | null {
  const parsePart = (value: string, max: number): number | null => {
    if (!/^\d{1,2}$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
  };
  const days = parsePart(parts.days, 7);
  const hours = parsePart(parts.hours, 23);
  const minutes = parsePart(parts.minutes, 59);
  if (days === null || hours === null || minutes === null) return null;
  const total = days * 1440 + hours * 60 + minutes;
  return total >= MIN_POLL_DURATION_MINUTES && total <= MAX_POLL_DURATION_MINUTES
    ? total
    : null;
}
