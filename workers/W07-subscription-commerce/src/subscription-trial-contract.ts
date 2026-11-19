import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';
import {
  etagForVersion,
  SubscriptionRuntimeError,
  validateIdempotencyKey,
  validatePrincipal,
} from './subscription-runtime.js';

export type TrialPlanRow = Readonly<{
  plan_id: string;
  owner_id: string;
  current_version: number;
  status: string;
  visibility: string;
  name: string;
  tier: string;
  billing_interval: 'MONTHLY' | 'YEARLY';
  price_minor: number;
  currency: string;
  trial_period_days: number;
}>;

export type TrialSubscriptionRow = Readonly<{
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  creator_id: string;
  status: string;
  started_at: string;
  current_period_start: string;
  current_period_end: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_converted_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}>;

export type TrialEnv = Readonly<{ W06_GOVERNANCE?: Fetcher }>;
export type TrialDependencies = Readonly<{ now?: () => Date }>;

export function iso(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return date.toISOString();
}

export function addTrialDays(start: string, days: number): string {
  const parsed = new Date(start);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== start ||
      !Number.isSafeInteger(days) || days < 1 || days > 30) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const end = new Date(parsed.getTime() + days * 86_400_000);
  if (!Number.isFinite(end.getTime()) || end <= parsed) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  return end.toISOString();
}

export function parsePlanId(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 1 || typeof value.planId !== 'string' ||
      !/^plan_[a-f0-9]{64}$/.test(value.planId) || value.planId.trim() !== value.planId) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  return value.planId;
}

export async function trialSubscriptionId(subscriberId: string, key: string): Promise<string> {
  const principal = validatePrincipal(subscriberId);
  const idempotencyKey = validateIdempotencyKey(key);
  try {
    const digest = await sha256BytesToHex(new TextEncoder().encode(
      'membership-trial-start-v1\u0000' + principal + '\u0000' + idempotencyKey,
    ));
    return 'sub_' + digest;
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}

export function publicTrial(row: TrialSubscriptionRow, replayed: boolean) {
  return {
    subscriptionId: row.subscription_id,
    subscriberId: row.subscriber_id,
    planId: row.plan_id,
    planVersion: row.plan_version,
    creatorId: row.creator_id,
    status: row.status,
    startedAt: row.started_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    trialStartedAt: row.trial_started_at,
    trialEndsAt: row.trial_ends_at,
    trialConvertedAt: row.trial_converted_at,
    version: row.version,
    etag: etagForVersion(row.version),
    replayed,
  };
}

export async function auditTrialStarted(
  env: TrialEnv,
  row: TrialSubscriptionRow,
  trialPeriodDays: number,
): Promise<void> {
  if (!env.W06_GOVERNANCE || !row.trial_started_at || !row.trial_ends_at) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const eventId = 'evt_subscription_trial_started_' + row.subscription_id;
  const payload = {
    eventId,
    subscriptionId: row.subscription_id,
    subscriberId: row.subscriber_id,
    creatorId: row.creator_id,
    planId: row.plan_id,
    planVersion: row.plan_version,
    trialStartedAt: row.trial_started_at,
    trialEndsAt: row.trial_ends_at,
    trialPeriodDays,
    occurredAt: row.created_at,
  };
  try {
    const response = await env.W06_GOVERNANCE.fetch(new Request(
      'https://luckread-w06.internal/internal/audit-events/subscription-trial-started',
      {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W07',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Correlation-Id': 'subscription-trial:' + row.subscription_id,
          'X-LuckRead-Request-Id': 'req_' + row.subscription_id.slice('sub_'.length),
          'X-LuckRead-Principal-User-Id': row.subscriber_id,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      },
    ));
    const result: unknown = await response.json().catch((): null => null);
    if ((response.status !== 200 && response.status !== 201) ||
        !result || typeof result !== 'object' || Array.isArray(result) ||
        (result as { eventId?: unknown }).eventId !== eventId ||
        (result as { action?: unknown }).action !== 'subscription.trial_started' ||
        (result as { targetId?: unknown }).targetId !== row.subscription_id) {
      throw new Error('trial audit not confirmed');
    }
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}
