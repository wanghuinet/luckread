export const MIN_SCHEDULE_LEAD_TIME_MS = 60_000;

/** Default to one hour ahead, with seconds removed for a clean picker value. */
export function getDefaultScheduledPublishDate(now = new Date()): Date {
  const target = new Date(now.getTime() + 60 * 60 * 1000);
  target.setSeconds(0, 0);
  return target;
}

/** Convert a device-local Date into the UTC timestamp sent to W03. */
export function toScheduledPublishISO(
  value: Date,
  now = new Date(),
): string | null {
  if (!(value instanceof Date)) return null;
  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp) ||
      timestamp <= now.getTime() + MIN_SCHEDULE_LEAD_TIME_MS) {
    return null;
  }
  return value.toISOString();
}
