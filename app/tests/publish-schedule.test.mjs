import { expect, test } from 'bun:test';
import {
  getDefaultScheduledPublishDate,
  MIN_SCHEDULE_LEAD_TIME_MS,
  toScheduledPublishISO,
} from '../lib/publish-schedule.ts';

test('default schedule time is one hour ahead and rounded to the minute', () => {
  const now = new Date('2026-11-05T10:41:28.000Z');
  expect(getDefaultScheduledPublishDate(now).toISOString()).toBe('2026-11-05T11:41:00.000Z');
});

test('scheduled time is serialized as UTC only when it remains safely in the future', () => {
  const now = new Date('2026-11-05T10:41:00.000Z');
  const selected = new Date(now.getTime() + MIN_SCHEDULE_LEAD_TIME_MS + 1);
  expect(toScheduledPublishISO(selected, now)).toBe(selected.toISOString());
  expect(toScheduledPublishISO(new Date(now.getTime() + MIN_SCHEDULE_LEAD_TIME_MS), now)).toBeNull();
  expect(toScheduledPublishISO(new Date(now.getTime() - 1), now)).toBeNull();
  expect(toScheduledPublishISO(new Date(Number.NaN), now)).toBeNull();
});

test('local offsets are normalized to the same UTC instant before submission', () => {
  const now = new Date('2026-11-05T10:00:00.000Z');
  const selected = new Date('2026-11-05T07:30:00-05:00');
  expect(toScheduledPublishISO(selected, now)).toBe('2026-11-05T12:30:00.000Z');
});
