import type { D1Database } from '@cloudflare/workers-types'
import {
  MembershipAccessStateError,
  type CreateSubscriptionInput,
  type TransitionInput,
  validateCreateSubscription,
  validateTransition,
} from './access-state-transition.js'

const now = () => new Date().toISOString()

export async function createSubscription(
  db: D1Database,
  input: CreateSubscriptionInput,
): Promise<{ subscriptionId: string; created: boolean; version: number }> {
  validateCreateSubscription(input)

  const result = await db.prepare(
    `INSERT OR IGNORE INTO membership_subscriptions
      (subscription_id, subscriber_id, plan_id, plan_version, status, version, started_at, current_period_start, current_period_end, cancel_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PENDING', 1, ?, ?, ?, NULL, ?, ?)`,
  ).bind(
    input.subscriptionId,
    input.subscriberId,
    input.planId,
    input.planVersion,
    input.startedAt,
    input.currentPeriodStart,
    input.currentPeriodEnd,
    now(),
    now(),
  ).run()

  const created = (result.meta?.changes ?? 0) > 0
  return { subscriptionId: input.subscriptionId, created, version: 1 }
}

export async function transitionSubscription(
  db: D1Database,
  input: TransitionInput,
): Promise<{ subscriptionId: string; status: string; version: number; entitlementChanged: boolean }> {
  validateTransition(input)

  const nextVersion = input.expectedVersion + 1
  const timestamp = now()

  const statements = [
    db.prepare(
      `UPDATE membership_subscriptions
          SET status = ?, version = version + 1, updated_at = ?, cancel_at = CASE WHEN ? IN ('CANCELED','EXPIRED') THEN ? ELSE cancel_at END
        WHERE subscription_id = ?
          AND status = ?
          AND version = ?`,
    ).bind(
      input.to,
      timestamp,
      input.to,
      input.to === 'CANCELED' ? timestamp : null,
      input.subscriptionId,
      input.from,
      input.expectedVersion,
    ),
  ]

  if (input.entitlementAction === 'GRANT') {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO membership_entitlement_grants
          (entitlement_id, subscription_id, entitlement_type, scope_type, scope_id, status, effective_at, expires_at, source_plan_version, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM membership_subscriptions
              WHERE subscription_id = ? AND status = 'ACTIVE' AND version = ?
           )`,
      ).bind(
        input.entitlementId,
        input.subscriptionId,
        input.entitlementType,
        input.scopeType,
        input.scopeId,
        input.effectiveAt ?? timestamp,
        input.expiresAt ?? null,
        input.sourcePlanVersion,
        timestamp,
        timestamp,
        input.subscriptionId,
        nextVersion,
      ),
    )
  }

  if (input.entitlementAction === 'REVOKE') {
    if (!input.entitlementId) throw new MembershipAccessStateError('INVALID_ENTITLEMENT_REVOKE')
    statements.push(
      db.prepare(
        `UPDATE membership_entitlement_grants
            SET status = 'REVOKED', updated_at = ?
          WHERE entitlement_id = ?
            AND status = 'ACTIVE'
            AND EXISTS (
              SELECT 1 FROM membership_subscriptions
               WHERE subscription_id = ? AND status = ? AND version = ?
            )`,
      ).bind(
        timestamp,
        input.entitlementId,
        input.subscriptionId,
        input.to,
        nextVersion,
      ),
    )
  }

  const results = await db.batch(statements)
  const subscriptionChanges = results[0]?.meta?.changes ?? 0
  if (subscriptionChanges !== 1) {
    throw new MembershipAccessStateError('VERSION_CONFLICT')
  }

  return {
    subscriptionId: input.subscriptionId,
    status: input.to,
    version: nextVersion,
    entitlementChanged: input.entitlementAction !== 'NONE',
  }
}
