import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import type { ScheduledSubscriptionPlanDowngrade } from './subscription-plan-change-schedule.js'
import type { SubscriptionOutcomeRow } from './subscription-renewal-outcome.js'

export type ApplyRenewalSubscriptionUpdateInput = Readonly<{
  cycle: Readonly<{
    subscription_id: string
    subscriber_id: string
    cycle_start: string
    cycle_id: string
    cycle_end: string
  }>
  subscription: SubscriptionOutcomeRow
  nextStatus: 'ACTIVE' | 'PAST_DUE'
  nextPeriodStart: string
  nextPeriodEnd: string
  updatedAt: string
  convertedAt: string | null
  scheduledChange?: ScheduledSubscriptionPlanDowngrade
}>

export type ApplyRenewalSubscriptionUpdateResult = 'APPLIED' | 'ALREADY_APPLIED' | 'CAS_LOST'

function failUnavailable(): never {
  throw new Error('W07_RENEWAL_OUTCOME_POSTGRES_UNAVAILABLE')
}

export async function readSubscriptionOutcomePostgres(
  pool: W07WebhookPostgresPool,
  subscriptionId: string,
  subscriberId: string,
): Promise<SubscriptionOutcomeRow | null> {
  try {
    const result = await pool.query<SubscriptionOutcomeRow & Record<string, unknown>>(
      'SELECT s.subscription_id, s.subscriber_id, s.plan_id, s.plan_version, s.creator_id, ' +
      'v.billing_interval, v.tier, v.price_minor::double precision AS price_minor, v.currency, ' +
      's.status, ' +
      `to_char(s.current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_start, ` +
      `to_char(s.current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_end, ` +
      `CASE WHEN s.trial_started_at IS NULL THEN NULL ELSE to_char(s.trial_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS trial_started_at, ` +
      `CASE WHEN s.trial_ends_at IS NULL THEN NULL ELSE to_char(s.trial_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS trial_ends_at, ` +
      `CASE WHEN s.trial_converted_at IS NULL THEN NULL ELSE to_char(s.trial_converted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS trial_converted_at, ` +
      `CASE WHEN s.cancel_at IS NULL THEN NULL ELSE to_char(s.cancel_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS cancel_at, ` +
      `to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at, s.version ` +
      'FROM membership_subscriptions s INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = s.plan_id AND v.plan_version = s.plan_version ' +
      'WHERE s.subscription_id = $1 AND s.subscriber_id = $2 LIMIT 1',
      [subscriptionId, subscriberId],
    )
    return result.rows[0] ?? null
  } catch {
    return failUnavailable()
  }
}

async function updateSubscriptionForRenewalPostgres(
  client: W07WebhookPostgresClient,
  input: ApplyRenewalSubscriptionUpdateInput,
): Promise<boolean> {
  const { cycle, subscription, nextStatus, nextPeriodStart, nextPeriodEnd, updatedAt, convertedAt } = input
  const nextPlanId = input.scheduledChange && nextStatus === 'ACTIVE'
    ? input.scheduledChange.targetPlanId
    : subscription.plan_id
  const nextPlanVersion = input.scheduledChange && nextStatus === 'ACTIVE'
    ? input.scheduledChange.targetPlanVersion
    : subscription.plan_version

  if (input.scheduledChange && nextStatus === 'ACTIVE') {
    const change = input.scheduledChange
    const result = await client.query<{ subscription_id: string } & Record<string, unknown>>(
      'UPDATE membership_subscriptions SET plan_id = $1, plan_version = $2, status = $3, ' +
      'current_period_start = $4::timestamptz, current_period_end = $5::timestamptz, ' +
      'trial_converted_at = $6::timestamptz, updated_at = $7::timestamptz, version = version + 1 ' +
      'WHERE subscription_id = $8 AND subscriber_id = $9 AND plan_id = $10 AND plan_version = $11 ' +
      'AND status = $12 AND version = $13 AND current_period_start = $14::timestamptz ' +
      'AND current_period_end = $15::timestamptz AND (cancel_at IS NULL OR cancel_at > $16::timestamptz) ' +
      'AND EXISTS (SELECT 1 FROM membership_subscription_scheduled_plan_changes c WHERE c.change_id = $17 ' +
      "AND c.status = 'SCHEDULED' AND c.subscription_id = $18 AND c.subscriber_id = $19 " +
      'AND c.expected_plan_id = $20 AND c.expected_plan_version = $21 AND c.target_plan_id = $22 ' +
      'AND c.target_plan_version = $23 AND c.effective_at = $24::timestamptz) ' +
      'RETURNING subscription_id',
      [
        nextPlanId, nextPlanVersion, nextStatus, nextPeriodStart, nextPeriodEnd, convertedAt,
        updatedAt, cycle.subscription_id, cycle.subscriber_id, subscription.plan_id,
        subscription.plan_version, subscription.status, subscription.version,
        subscription.current_period_start, subscription.current_period_end, cycle.cycle_start,
        change.changeId, change.subscriptionId, change.subscriberId, change.expectedPlanId,
        change.expectedPlanVersion, change.targetPlanId, change.targetPlanVersion, change.effectiveAt,
      ],
    )
    if (result.rows.length !== 1) return false

    const marker = await client.query<{ change_id: string } & Record<string, unknown>>(
      "UPDATE membership_subscription_scheduled_plan_changes SET status = 'APPLIED', " +
      'applied_at = $1::timestamptz, applied_subscription_version = $2, ' +
      'updated_at = $3::timestamptz, version = version + 1 ' +
      "WHERE change_id = $4 AND status = 'SCHEDULED' AND subscription_id = $5 AND subscriber_id = $6 " +
      'AND expected_plan_id = $7 AND expected_plan_version = $8 AND target_plan_id = $9 ' +
      'AND target_plan_version = $10 AND effective_at = $11::timestamptz ' +
      'AND EXISTS (SELECT 1 FROM membership_subscriptions s WHERE s.subscription_id = $12 ' +
      'AND s.subscriber_id = $13 AND s.plan_id = $14 AND s.plan_version = $15 ' +
      'AND s.version = $16 AND s.current_period_start = $17::timestamptz ' +
      'AND s.current_period_end = $18::timestamptz) RETURNING change_id',
      [
        cycle.cycle_start, subscription.version + 1, updatedAt,
        change.changeId, change.subscriptionId, change.subscriberId,
        change.expectedPlanId, change.expectedPlanVersion, change.targetPlanId,
        change.targetPlanVersion, change.effectiveAt,
        cycle.subscription_id, cycle.subscriber_id, nextPlanId, nextPlanVersion,
        subscription.version + 1, nextPeriodStart, nextPeriodEnd,
      ],
    )
    return marker.rows.length === 1
  }

  const result = await client.query<{ subscription_id: string } & Record<string, unknown>>(
    'UPDATE membership_subscriptions SET plan_id = $1, plan_version = $2, status = $3, ' +
    'current_period_start = $4::timestamptz, current_period_end = $5::timestamptz, ' +
    'trial_converted_at = $6::timestamptz, updated_at = $7::timestamptz, version = version + 1 ' +
    'WHERE subscription_id = $8 AND subscriber_id = $9 AND plan_id = $10 AND plan_version = $11 ' +
    'AND status = $12 AND version = $13 AND current_period_start = $14::timestamptz ' +
    'AND current_period_end = $15::timestamptz AND (cancel_at IS NULL OR cancel_at > $16::timestamptz) ' +
    'RETURNING subscription_id',
    [
      nextPlanId, nextPlanVersion, nextStatus, nextPeriodStart, nextPeriodEnd, convertedAt,
      updatedAt, cycle.subscription_id, cycle.subscriber_id, subscription.plan_id,
      subscription.plan_version, subscription.status, subscription.version,
      subscription.current_period_start, subscription.current_period_end, cycle.cycle_start,
    ],
  )
  return result.rows.length === 1
}

/**
 * Apply renewal state and, when present, the scheduled plan-change marker in a
 * single D1-01 PostgreSQL transaction. A lost CAS rolls the entire pair back.
 */
export async function applyRenewalSubscriptionUpdatePostgres(
  pool: W07WebhookPostgresPool,
  input: ApplyRenewalSubscriptionUpdateInput,
): Promise<ApplyRenewalSubscriptionUpdateResult> {
  let client: W07WebhookPostgresClient | undefined
  let settled = false
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const prior = await client.query<Record<string, unknown>>(
      'SELECT cycle_id, subscription_id, subscriber_id, cycle_start, cycle_end, outcome, ' +
      'applied_subscription_version, plan_id, plan_version FROM membership_subscription_renewal_cycle_applications ' +
      'WHERE cycle_id = $1 FOR UPDATE',
      [input.cycle.cycle_id],
    )
    if (prior.rows.length === 1) {
      const row = prior.rows[0] as Record<string, unknown>
      const cycleIdentityMatches = row.subscription_id === input.cycle.subscription_id &&
        row.subscriber_id === input.cycle.subscriber_id &&
        new Date(String(row.cycle_start)).toISOString() === input.cycle.cycle_start &&
        new Date(String(row.cycle_end)).toISOString() === input.cycle.cycle_end
      const nextPlanId = input.scheduledChange && input.nextStatus === 'ACTIVE'
        ? input.scheduledChange.targetPlanId : input.subscription.plan_id
      const nextPlanVersion = input.scheduledChange && input.nextStatus === 'ACTIVE'
        ? input.scheduledChange.targetPlanVersion : input.subscription.plan_version
      const matches = cycleIdentityMatches &&
        row.outcome === input.nextStatus &&
        Number(row.applied_subscription_version) === input.subscription.version + 1 &&
        row.plan_id === nextPlanId &&
        Number(row.plan_version) === nextPlanVersion
      if (matches) {
        await client.query('COMMIT')
        settled = true
        return 'ALREADY_APPLIED'
      }

      // A failed payment may have already moved this exact cycle to PAST_DUE.
      // A later successful retry can promote that receipt only if no subscription
      // mutation has occurred since the failure receipt was committed.
      const retryPromotionEligible = cycleIdentityMatches &&
        input.nextStatus === 'ACTIVE' &&
        row.outcome === 'PAST_DUE' &&
        input.subscription.status === 'PAST_DUE' &&
        Number(row.applied_subscription_version) === input.subscription.version &&
        row.plan_id === input.subscription.plan_id &&
        Number(row.plan_version) === input.subscription.plan_version &&
        input.subscription.current_period_start < input.cycle.cycle_start &&
        input.subscription.current_period_end === input.cycle.cycle_start
      if (!retryPromotionEligible) {
        await client.query('ROLLBACK')
        settled = true
        return 'CAS_LOST'
      }

      const applied = await updateSubscriptionForRenewalPostgres(client, input)
      if (!applied) {
        await client.query('ROLLBACK')
        settled = true
        return 'CAS_LOST'
      }
      const promoted = await client.query(
        "UPDATE membership_subscription_renewal_cycle_applications SET outcome = 'ACTIVE', " +
        'applied_subscription_version = $1, plan_id = $2, plan_version = $3, applied_at = $4::timestamptz ' +
        "WHERE cycle_id = $5 AND outcome = 'PAST_DUE' AND applied_subscription_version = $6 " +
        'RETURNING cycle_id',
        [input.subscription.version + 1, nextPlanId, nextPlanVersion, input.updatedAt,
         input.cycle.cycle_id, input.subscription.version],
      )
      if (promoted.rows.length !== 1) {
        await client.query('ROLLBACK')
        settled = true
        return 'CAS_LOST'
      }
      await client.query('COMMIT')
      settled = true
      return 'APPLIED'
    }
    const applied = await updateSubscriptionForRenewalPostgres(client, input)
    if (!applied) {
      await client.query('ROLLBACK')
      settled = true
      return 'CAS_LOST'
    }
    const nextPlanId = input.scheduledChange && input.nextStatus === 'ACTIVE'
      ? input.scheduledChange.targetPlanId : input.subscription.plan_id
    const nextPlanVersion = input.scheduledChange && input.nextStatus === 'ACTIVE'
      ? input.scheduledChange.targetPlanVersion : input.subscription.plan_version
    const receipt = await client.query(
      'INSERT INTO membership_subscription_renewal_cycle_applications ' +
      '(cycle_id, subscription_id, subscriber_id, cycle_start, cycle_end, outcome, applied_subscription_version, plan_id, plan_version, applied_at) ' +
      'VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10::timestamptz) ' +
      'ON CONFLICT (cycle_id) DO NOTHING RETURNING cycle_id',
      [input.cycle.cycle_id,input.cycle.subscription_id,input.cycle.subscriber_id,input.cycle.cycle_start,
       input.cycle.cycle_end,input.nextStatus,input.subscription.version+1,nextPlanId,nextPlanVersion,input.updatedAt],
    )
    if (receipt.rows.length !== 1) {
      await client.query('ROLLBACK')
      settled = true
      return 'CAS_LOST'
    }
    await client.query('COMMIT')
    settled = true
    return 'APPLIED'
  } catch {
    if (client && !settled) {
      try { await client.query('ROLLBACK') } catch { /* keep sanitized outcome */ }
    }
    return failUnavailable()
  } finally {
    client?.release()
  }
}

export type RenewalCycleReceiptRow = Readonly<{
  cycle_id: string; subscription_id: string; subscriber_id: string; cycle_start: string;
  cycle_end: string; outcome: 'ACTIVE' | 'PAST_DUE'; applied_subscription_version: number;
  plan_id: string; plan_version: number; applied_at: string;
}>;

export async function readRenewalCycleReceiptPostgres(
  pool: W07WebhookPostgresPool, cycleId: string,
): Promise<RenewalCycleReceiptRow | null> {
  try {
    const result = await pool.query<RenewalCycleReceiptRow & Record<string, unknown>>(
      'SELECT cycle_id, subscription_id, subscriber_id, ' +
      `to_char(cycle_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cycle_start, ` +
      `to_char(cycle_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS cycle_end, ` +
      'outcome, applied_subscription_version, plan_id, plan_version, ' +
      `to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS applied_at ` +
      'FROM membership_subscription_renewal_cycle_applications WHERE cycle_id = $1 LIMIT 1',
      [cycleId],
    );
    return result.rows[0] ?? null;
  } catch {
    return failUnavailable();
  }
}
