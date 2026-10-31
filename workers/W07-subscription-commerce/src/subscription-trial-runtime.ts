/// <reference types="@cloudflare/workers-types" />
import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js'
import { etagForVersion, SubscriptionRuntimeError, validateIdempotencyKey, validatePrincipal } from './subscription-runtime.js'

type TrialPlanRow = Readonly<{
  plan_id: string
  owner_id: string
  current_version: number
  status: string
  visibility: string
  name: string
  tier: string
  billing_interval: 'MONTHLY' | 'YEARLY'
  price_minor: number
  currency: string
  trial_period_days: number
}>

type TrialSubscriptionRow = Readonly<{
  subscription_id: string
  subscriber_id: string
  plan_id: string
  plan_version: number
  creator_id: string
  status: string
  started_at: string
  current_period_start: string
  current_period_end: string
  trial_started_at: string | null
  trial_ends_at: string | null
  trial_converted_at: string | null
  created_at: string
  updated_at: string
  version: number
}>

type TrialEnv = Readonly<{ D1_01: D1Database; W06_GOVERNANCE?: Fetcher }>
type TrialDependencies = Readonly<{ now?: () => Date }>

function iso(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  return date.toISOString()
}

function addTrialDays(start: string, days: number): string {
  const parsed = new Date(start)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== start ||
      !Number.isSafeInteger(days) || days < 1 || days > 30) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const end = new Date(parsed.getTime() + days * 86_400_000)
  if (!Number.isFinite(end.getTime()) || end <= parsed) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  return end.toISOString()
}

function parsePlanId(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  const value = input as Record<string, unknown>
  if (Object.keys(value).length !== 1 || typeof value.planId !== 'string' ||
      !/^plan_[a-f0-9]{64}$/.test(value.planId) || value.planId.trim() !== value.planId) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  return value.planId
}

async function trialSubscriptionId(subscriberId: string, key: string): Promise<string> {
  try {
    const digest = await sha256BytesToHex(new TextEncoder().encode(
      'membership-trial-start-v1\u0000' + subscriberId + '\u0000' + key,
    ))
    return 'sub_' + digest
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

async function readTrialSubscription(db: D1Database, subscriptionId: string): Promise<TrialSubscriptionRow | null> {
  try {
    return await db.prepare(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, started_at, ' +
      'current_period_start, current_period_end, trial_started_at, trial_ends_at, trial_converted_at, ' +
      'created_at, updated_at, version FROM membership_subscriptions WHERE subscription_id = ? LIMIT 1',
    ).bind(subscriptionId).first<TrialSubscriptionRow>()
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

function publicTrial(row: TrialSubscriptionRow, replayed: boolean) {
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
  }
}

async function auditTrialStarted(
  env: TrialEnv,
  row: TrialSubscriptionRow,
  trialPeriodDays: number,
): Promise<void> {
  if (!env.W06_GOVERNANCE || !row.trial_started_at || !row.trial_ends_at) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  const eventId = 'evt_subscription_trial_started_' + row.subscription_id
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
  }
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
    ))
    const result: unknown = await response.json().catch((): null => null)
    if ((response.status !== 200 && response.status !== 201) ||
        !result || typeof result !== 'object' || Array.isArray(result) ||
        (result as { eventId?: unknown }).eventId !== eventId ||
        (result as { action?: unknown }).action !== 'subscription.trial_started' ||
        (result as { targetId?: unknown }).targetId !== row.subscription_id) {
      throw new Error('trial audit not confirmed')
    }
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

/**
 * Starts a creator-configured free trial without order/payment creation. D1-01
 * records the entitlement window; W06 audit confirmation precedes TRIALING
 * activation. One trial per subscriber+creator is enforced by a partial unique
 * index, while idempotent replay resumes an interrupted audit/activation.
 */
export async function startSubscriptionTrial(
  env: TrialEnv,
  subscriberIdInput: string,
  input: unknown,
  idempotencyKeyInput: string | null,
  dependencies: TrialDependencies = {},
) {
  const subscriberId = validatePrincipal(subscriberIdInput)
  const planId = parsePlanId(input)
  const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput)
  const subscriptionId = await trialSubscriptionId(subscriberId, idempotencyKey)
  const now = iso((dependencies.now ?? (() => new Date()))())

  let existing = await readTrialSubscription(env.D1_01, subscriptionId)
  if (existing) {
    if (existing.subscriber_id !== subscriberId || existing.plan_id !== planId ||
        !existing.trial_started_at || !existing.trial_ends_at) {
      throw new SubscriptionRuntimeError('CONFLICT', 409)
    }
    if (existing.status !== 'PENDING') return publicTrial(existing, true)
    const plan = await env.D1_01.prepare(
      'SELECT trial_period_days FROM membership_plan_versions WHERE plan_id = ? AND plan_version = ? LIMIT 1',
    ).bind(existing.plan_id, existing.plan_version).first<{ trial_period_days: number }>()
    if (!plan || !Number.isSafeInteger(plan.trial_period_days) || plan.trial_period_days < 1 || plan.trial_period_days > 30) {
      throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
    }
    await auditTrialStarted(env, existing, plan.trial_period_days)
    const activated = await env.D1_01.prepare(
      "UPDATE membership_subscriptions SET status = 'TRIALING', updated_at = ?, version = version + 1 " +
      "WHERE subscription_id = ? AND subscriber_id = ? AND status = 'PENDING' AND version = ? " +
      'AND trial_started_at = ? AND trial_ends_at = ?',
    ).bind(now, subscriptionId, subscriberId, existing.version, existing.trial_started_at, existing.trial_ends_at).run()
    if (Number(activated.meta?.changes ?? 0) !== 1) {
      existing = await readTrialSubscription(env.D1_01, subscriptionId)
      if (!existing || existing.status !== 'TRIALING') throw new SubscriptionRuntimeError('CONFLICT', 409)
      return publicTrial(existing, true)
    }
    existing = await readTrialSubscription(env.D1_01, subscriptionId)
    if (!existing || existing.status !== 'TRIALING') throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
    return publicTrial(existing, true)
  }

  let plan: TrialPlanRow | null
  try {
    plan = await env.D1_01.prepare(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, v.name, v.tier, ' +
      'v.billing_interval, v.price_minor, v.currency, v.trial_period_days ' +
      'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      "WHERE p.plan_id = ? AND p.owner_type = 'CREATOR' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC' LIMIT 1",
    ).bind(planId).first<TrialPlanRow>()
  } catch {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (!plan || !/^plan_[a-f0-9]{64}$/.test(plan.plan_id) || !plan.owner_id ||
      !Number.isSafeInteger(plan.current_version) || plan.current_version < 1 ||
      !Number.isSafeInteger(plan.trial_period_days) || plan.trial_period_days < 1 || plan.trial_period_days > 30 ||
      (plan.billing_interval !== 'MONTHLY' && plan.billing_interval !== 'YEARLY') ||
      !/^[A-Z]{3}$/.test(plan.currency) || !Number.isSafeInteger(plan.price_minor) || plan.price_minor < 1) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  }
  const trialEndsAt = addTrialDays(now, plan.trial_period_days)

  let inserted: D1Result
  try {
    inserted = await env.D1_01.prepare(
      "INSERT INTO membership_subscriptions (" +
      "subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, started_at, " +
      "current_period_start, current_period_end, trial_started_at, trial_ends_at, trial_converted_at, " +
      "cancel_at, entitlement_snapshot_ref, created_at, updated_at, version) " +
      "SELECT ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1 " +
      "WHERE EXISTS (SELECT 1 FROM membership_plans p WHERE p.plan_id = ? AND p.current_version = ? " +
      "AND p.owner_type = 'CREATOR' AND p.owner_id = ? AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC') " +
      "AND NOT EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscriber_id = ? AND s.creator_id = ? " +
      "AND s.trial_started_at IS NOT NULL) " +
      "AND NOT EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscriber_id = ? AND s.creator_id = ? " +
      "AND s.status IN ('ACTIVE','TRIALING','PAST_DUE','PAUSED') AND (s.cancel_at IS NULL OR s.cancel_at > ?))",
    ).bind(
      subscriptionId, subscriberId, plan.plan_id, plan.current_version, plan.owner_id,
      now, now, trialEndsAt, now, trialEndsAt, now, now,
      plan.plan_id, plan.current_version, plan.owner_id,
      subscriberId, plan.owner_id, subscriberId, plan.owner_id, now,
    ).run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/unique/i.test(message)) throw new SubscriptionRuntimeError('CONFLICT', 409)
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  if (Number(inserted.meta?.changes ?? 0) !== 1) {
    const raced = await readTrialSubscription(env.D1_01, subscriptionId)
    if (raced && raced.subscriber_id === subscriberId && raced.plan_id === planId &&
        raced.trial_started_at && raced.trial_ends_at) {
      return startSubscriptionTrial(env, subscriberId, input, idempotencyKey, { now: () => new Date(now) })
    }
    throw new SubscriptionRuntimeError('CONFLICT', 409)
  }

  const pending = await readTrialSubscription(env.D1_01, subscriptionId)
  if (!pending || pending.status !== 'PENDING' || !pending.trial_started_at || !pending.trial_ends_at) {
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
  await auditTrialStarted(env, pending, plan.trial_period_days)
  const activated = await env.D1_01.prepare(
    "UPDATE membership_subscriptions SET status = 'TRIALING', updated_at = ?, version = version + 1 " +
    "WHERE subscription_id = ? AND subscriber_id = ? AND status = 'PENDING' AND version = 1 " +
    'AND trial_started_at = ? AND trial_ends_at = ?',
  ).bind(now, subscriptionId, subscriberId, pending.trial_started_at, pending.trial_ends_at).run()
  if (Number(activated.meta?.changes ?? 0) !== 1) throw new SubscriptionRuntimeError('CONFLICT', 409)

  const active = await readTrialSubscription(env.D1_01, subscriptionId)
  if (!active || active.status !== 'TRIALING') throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  return publicTrial(active, false)
}
