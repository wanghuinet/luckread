import type { D1Database } from '@cloudflare/workers-types'
import type { SubscriptionStatus } from './access-state-transition.js'

export type MembershipSubscriptionSnapshot = {
  subscriptionId: string
  subscriberId: string
  planId: string
  planVersion: number
  status: SubscriptionStatus
  version: number
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAt: string | null
}

export class MembershipSubscriptionReadError extends Error {
  constructor(readonly code: 'UNTRUSTED_CALLER' | 'INVALID_PRINCIPAL' | 'INVALID_IDENTIFIER' | 'NOT_FOUND' | 'SERVICE_UNAVAILABLE') {
    super(code)
  }
}

const validId = (value: string): boolean => value.length > 0 && value.length <= 128

export async function readMembershipSubscription(
  db: D1Database,
  input: {
    caller: string
    transportVersion: string
    correlationId: string
    principalUserId: string
    subscriptionId: string
  },
): Promise<MembershipSubscriptionSnapshot> {
  if (input.caller !== 'W07' || input.transportVersion !== '1.0') {
    throw new MembershipSubscriptionReadError('UNTRUSTED_CALLER')
  }
  if (!input.correlationId || input.correlationId.length > 128) {
    throw new MembershipSubscriptionReadError('INVALID_PRINCIPAL')
  }
  if (!validId(input.principalUserId) || !validId(input.subscriptionId)) {
    throw new MembershipSubscriptionReadError('INVALID_IDENTIFIER')
  }

  try {
    const row = await db.prepare(
      `SELECT subscription_id AS subscriptionId,
              subscriber_id AS subscriberId,
              plan_id AS planId,
              plan_version AS planVersion,
              status,
              version,
              current_period_start AS currentPeriodStart,
              current_period_end AS currentPeriodEnd,
              cancel_at AS cancelAt
         FROM membership_subscriptions
        WHERE subscription_id = ? AND subscriber_id = ?
        LIMIT 1`,
    ).bind(input.subscriptionId, input.principalUserId).first<MembershipSubscriptionSnapshot>()

    if (!row) throw new MembershipSubscriptionReadError('NOT_FOUND')
    if (!validId(row.subscriberId) || !validId(row.planId) || !validId(row.subscriptionId) ||
        !Number.isSafeInteger(row.planVersion) || row.planVersion < 1 ||
        !Number.isSafeInteger(row.version) || row.version < 1) {
      throw new MembershipSubscriptionReadError('SERVICE_UNAVAILABLE')
    }

    return row
  } catch (error) {
    if (error instanceof MembershipSubscriptionReadError) throw error
    throw new MembershipSubscriptionReadError('SERVICE_UNAVAILABLE')
  }
}

export function mapMembershipSubscriptionReadError(error: unknown): { status: number; code: string } {
  const code = error instanceof MembershipSubscriptionReadError ? error.code : 'SERVICE_UNAVAILABLE'
  const status =
    code === 'UNTRUSTED_CALLER' ? 403 :
    code === 'INVALID_PRINCIPAL' || code === 'INVALID_IDENTIFIER' ? 400 :
    code === 'NOT_FOUND' ? 404 :
    503
  return { status, code }
}
