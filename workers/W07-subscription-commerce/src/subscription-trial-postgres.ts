import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError, validateIdempotencyKey, validatePrincipal } from './subscription-runtime.js'
import {
  addTrialDays,
  auditTrialStarted,
  iso,
  parsePlanId,
  publicTrial,
  trialSubscriptionId,
  type TrialDependencies,
  type TrialEnv,
  type TrialPlanRow,
  type TrialSubscriptionRow,
} from './subscription-trial-runtime.js'

type TrialPlanDbRow = TrialPlanRow & Record<string, unknown>
type TrialSubscriptionDbRow = TrialSubscriptionRow & Record<string, unknown>
type TrialIdDbRow = { subscription_id: string } & Record<string, unknown>

function failUnavailable(): never {
  throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
}

async function readTrialSubscription(
  pool: W07WebhookPostgresPool,
  subscriptionId: string,
): Promise<TrialSubscriptionRow | null> {
  try {
    const result = await pool.query<TrialSubscriptionDbRow>(
      `SELECT subscription_id, subscriber_id, plan_id, plan_version, creator_id, status,
        to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS started_at,
        to_char(current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_start,
        to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_end,
        to_char(trial_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_started_at,
        to_char(trial_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_ends_at,
        to_char(trial_converted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_converted_at,
        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
        version
      FROM membership_subscriptions
      WHERE subscription_id = $1
      LIMIT 1`,
      [subscriptionId],
    )
    return result.rows[0] ?? null
  } catch {
    return failUnavailable()
  }
}

async function readPlanTrialDays(
  pool: W07WebhookPostgresPool,
  planId: string,
  planVersion: number,
): Promise<number> {
  try {
    const result = await pool.query<{ trial_period_days: number } & Record<string, unknown>>(
      'SELECT trial_period_days FROM membership_plan_versions WHERE plan_id = $1 AND plan_version = $2 LIMIT 1',
      [planId, planVersion],
    )
    const days = result.rows[0]?.trial_period_days
    if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < 1 || days > 30) failUnavailable()
    return days
  } catch {
    return failUnavailable()
  }
}

/**
 * Starts a creator-configured free trial directly on the shared D1-01 Neon
 * PostgreSQL pool. W06 audit confirmation still precedes TRIALING activation;
 * no D1-compatible database adapter or D1-04 order/payment write is used.
 */
export async function startSubscriptionTrialPostgres(
  env: TrialEnv,
  pool: W07WebhookPostgresPool,
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

  let existing = await readTrialSubscription(pool, subscriptionId)
  if (existing) {
    if (existing.subscriber_id !== subscriberId || existing.plan_id !== planId ||
        !existing.trial_started_at || !existing.trial_ends_at) {
      throw new SubscriptionRuntimeError('CONFLICT', 409)
    }
    if (existing.status !== 'PENDING') return publicTrial(existing, true)

    const trialPeriodDays = await readPlanTrialDays(pool, existing.plan_id, existing.plan_version)
    await auditTrialStarted(env, existing, trialPeriodDays)
    let activated: string[]
    try {
      const result = await pool.query<TrialIdDbRow>(
        "UPDATE membership_subscriptions SET status = 'TRIALING', updated_at = $1::timestamptz, version = version + 1 " +
        "WHERE subscription_id = $2 AND subscriber_id = $3 AND status = 'PENDING' AND version = $4 " +
        'AND trial_started_at = $5::timestamptz AND trial_ends_at = $6::timestamptz RETURNING subscription_id',
        [now, subscriptionId, subscriberId, existing.version, existing.trial_started_at, existing.trial_ends_at],
      )
      activated = result.rows.map((row) => row.subscription_id)
    } catch {
      return failUnavailable()
    }
    if (activated.length !== 1) {
      existing = await readTrialSubscription(pool, subscriptionId)
      if (!existing || existing.status !== 'TRIALING') throw new SubscriptionRuntimeError('CONFLICT', 409)
      return publicTrial(existing, true)
    }
    existing = await readTrialSubscription(pool, subscriptionId)
    if (!existing || existing.status !== 'TRIALING') failUnavailable()
    return publicTrial(existing, true)
  }

  let plan: TrialPlanRow | null
  try {
    const result = await pool.query<TrialPlanDbRow>(
      'SELECT p.plan_id, p.owner_id, p.current_version, p.status, p.visibility, v.name, v.tier, ' +
      'v.billing_interval, v.price_minor, v.currency, v.trial_period_days ' +
      'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = p.current_version ' +
      "WHERE p.plan_id = $1 AND p.owner_type = 'CREATOR' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC' LIMIT 1",
      [planId],
    )
    plan = result.rows[0] ?? null
  } catch {
    return failUnavailable()
  }
  if (!plan || !/^plan_[a-f0-9]{64}$/.test(plan.plan_id) || !plan.owner_id ||
      !Number.isSafeInteger(plan.current_version) || plan.current_version < 1 ||
      !Number.isSafeInteger(plan.trial_period_days) || plan.trial_period_days < 1 || plan.trial_period_days > 30 ||
      (plan.billing_interval !== 'MONTHLY' && plan.billing_interval !== 'YEARLY') ||
      !/^[A-Z]{3}$/.test(plan.currency) || !Number.isSafeInteger(plan.price_minor) || plan.price_minor < 1) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409)
  }

  const trialEndsAt = addTrialDays(now, plan.trial_period_days)
  let inserted: string[]
  try {
    const result = await pool.query<TrialIdDbRow>(
      "INSERT INTO membership_subscriptions (" +
      "subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, started_at, " +
      "current_period_start, current_period_end, trial_started_at, trial_ends_at, trial_converted_at, " +
      "cancel_at, entitlement_snapshot_ref, created_at, updated_at, version) " +
      "SELECT $1, $2, $3, $4, $5, 'PENDING', $6::timestamptz, $7::timestamptz, $8::timestamptz, " +
      "$9::timestamptz, $10::timestamptz, NULL, NULL, NULL, $11::timestamptz, $12::timestamptz, 1 " +
      "WHERE EXISTS (SELECT 1 FROM membership_plans p WHERE p.plan_id = $13 AND p.current_version = $14 " +
      "AND p.owner_type = 'CREATOR' AND p.owner_id = $15 AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC') " +
      "AND NOT EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscriber_id = $16 AND s.creator_id = $17 " +
      "AND s.trial_started_at IS NOT NULL) " +
      "AND NOT EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscriber_id = $18 AND s.creator_id = $19 " +
      "AND s.status IN ('ACTIVE','TRIALING','PAST_DUE','PAUSED') AND (s.cancel_at IS NULL OR s.cancel_at > $20::timestamptz)) " +
      'RETURNING subscription_id',
      [
        subscriptionId, subscriberId, plan.plan_id, plan.current_version, plan.owner_id,
        now, now, trialEndsAt, now, trialEndsAt, now, now,
        plan.plan_id, plan.current_version, plan.owner_id,
        subscriberId, plan.owner_id, subscriberId, plan.owner_id, now,
      ],
    )
    inserted = result.rows.map((row) => row.subscription_id)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : ''
    if (code === '23505') throw new SubscriptionRuntimeError('CONFLICT', 409)
    return failUnavailable()
  }

  if (inserted.length !== 1) {
    const raced = await readTrialSubscription(pool, subscriptionId)
    if (raced && raced.subscriber_id === subscriberId && raced.plan_id === planId &&
        raced.trial_started_at && raced.trial_ends_at) {
      return startSubscriptionTrialPostgres(
        env, pool, subscriberId, input, idempotencyKey, { now: () => new Date(now) },
      )
    }
    throw new SubscriptionRuntimeError('CONFLICT', 409)
  }

  const pending = await readTrialSubscription(pool, subscriptionId)
  if (!pending || pending.status !== 'PENDING' || !pending.trial_started_at || !pending.trial_ends_at) {
    return failUnavailable()
  }
  await auditTrialStarted(env, pending, plan.trial_period_days)

  let activated: string[]
  try {
    const result = await pool.query<TrialIdDbRow>(
      "UPDATE membership_subscriptions SET status = 'TRIALING', updated_at = $1::timestamptz, version = version + 1 " +
      "WHERE subscription_id = $2 AND subscriber_id = $3 AND status = 'PENDING' AND version = 1 " +
      'AND trial_started_at = $4::timestamptz AND trial_ends_at = $5::timestamptz RETURNING subscription_id',
      [now, subscriptionId, subscriberId, pending.trial_started_at, pending.trial_ends_at],
    )
    activated = result.rows.map((row) => row.subscription_id)
  } catch {
    return failUnavailable()
  }
  if (activated.length !== 1) throw new SubscriptionRuntimeError('CONFLICT', 409)

  const active = await readTrialSubscription(pool, subscriptionId)
  if (!active || active.status !== 'TRIALING') return failUnavailable()
  return publicTrial(active, false)
}
