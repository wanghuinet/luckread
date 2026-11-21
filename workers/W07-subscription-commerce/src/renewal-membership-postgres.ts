import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'

export type RenewalMembershipCandidateRow = Readonly<{
  subscription_id: string
  subscriber_id: string
  plan_id: string
  plan_version: number
  creator_id: string | null
  status: string
  current_period_start: string
  current_period_end: string
  trial_started_at: string | null
  trial_ends_at: string | null
  cancel_at: string | null
  billing_interval: string
  price_minor: number
  currency: string
  name: string
  tier: string
  benefits_json: string
}>

export type RenewalChargeSubscriptionRow = Readonly<{
  subscription_id: string
  subscriber_id: string
  plan_id: string
  plan_version: number
  creator_id: string | null
  status: string
  current_period_end: string
  trial_started_at: string | null
  trial_ends_at: string | null
  cancel_at: string | null
}>

function failUnavailable(): never {
  throw new Error('W07_RENEWAL_MEMBERSHIP_POSTGRES_UNAVAILABLE')
}

export async function readDueRenewalMembershipsPostgres(
  pool: W07WebhookPostgresPool,
  now: string,
  cursorPeriodEnd: string | null,
  cursorSubscriptionId: string | null,
  limit: number,
): Promise<RenewalMembershipCandidateRow[]> {
  try {
    const result = await pool.query<RenewalMembershipCandidateRow & Record<string, unknown>>(
      'SELECT s.subscription_id, s.subscriber_id, s.plan_id, s.plan_version, s.creator_id, s.status, ' +
      `to_char(s.current_period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_start, ` +
      `to_char(s.current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_end, ` +
      `to_char(s.trial_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_started_at, ` +
      `to_char(s.trial_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_ends_at, ` +
      `CASE WHEN s.cancel_at IS NULL THEN NULL ELSE to_char(s.cancel_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS cancel_at, ` +
      'pv.billing_interval, pv.price_minor, pv.currency, pv.name, pv.tier, pv.benefits_json ' +
      'FROM membership_subscriptions s ' +
      'JOIN membership_plan_versions pv ON pv.plan_id = s.plan_id AND pv.plan_version = s.plan_version ' +
      "WHERE s.status IN ('TRIALING','ACTIVE','PAST_DUE') AND s.current_period_end <= $1::timestamptz " +
      'AND (s.cancel_at IS NULL OR s.cancel_at > s.current_period_end) ' +
      'AND ($2::timestamptz IS NULL OR s.current_period_end > $2::timestamptz OR ' +
      '(s.current_period_end = $2::timestamptz AND s.subscription_id > $3::text)) ' +
      'ORDER BY s.current_period_end ASC, s.subscription_id ASC LIMIT $4',
      [now, cursorPeriodEnd, cursorSubscriptionId, limit],
    )
    return result.rows
  } catch {
    return failUnavailable()
  }
}

export async function readRenewalChargeSubscriptionPostgres(
  pool: W07WebhookPostgresPool,
  subscriptionId: string,
  subscriberId: string,
): Promise<RenewalChargeSubscriptionRow | null> {
  try {
    const result = await pool.query<RenewalChargeSubscriptionRow & Record<string, unknown>>(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, creator_id, status, ' +
      `to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS current_period_end, ` +
      `to_char(trial_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_started_at, ` +
      `to_char(trial_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS trial_ends_at, ` +
      `CASE WHEN cancel_at IS NULL THEN NULL ELSE to_char(cancel_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS cancel_at ` +
      'FROM membership_subscriptions WHERE subscription_id = $1 AND subscriber_id = $2 LIMIT 1',
      [subscriptionId, subscriberId],
    )
    return result.rows[0] ?? null
  } catch {
    return failUnavailable()
  }
}
