import type { Payload } from 'payload'

type Relationship = string | number | { id?: string | number } | null | undefined

type SubscriptionRecord = {
  id: string | number
  user: Relationship
  planCode: string
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  startsAt: string
  endsAt?: string | null
  cancelAtPeriodEnd?: boolean | null
}

type PlanRecord = {
  id: string | number
  code: string
  active: boolean
  entitlements?: Relationship[]
}

type EntitlementRecord = { id: string | number; active: boolean }

type GrantRecord = {
  id: string | number
  entitlement: Relationship
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  startsAt: string
  endsAt?: string | null
}

const relationshipId = (value: Relationship): string | undefined => {
  if (value == null) return undefined
  if (typeof value === 'object') return value.id == null ? undefined : String(value.id)
  return String(value)
}

const isCurrentlyActiveSubscription = (subscription: SubscriptionRecord, now: Date) => {
  const startsAt = new Date(subscription.startsAt).getTime()
  const endsAt = subscription.endsAt ? new Date(subscription.endsAt).getTime() : undefined
  if (!Number.isFinite(startsAt) || startsAt > now.getTime()) return false
  if (endsAt !== undefined && (!Number.isFinite(endsAt) || endsAt <= now.getTime())) return false

  if (subscription.status === 'ACTIVE') return true
  if (subscription.status === 'PAST_DUE') return true
  if (subscription.status === 'CANCELED') {
    return Boolean(subscription.cancelAtPeriodEnd) && endsAt !== undefined && endsAt > now.getTime()
  }
  return false
}

const grantStatusFor = (subscription: SubscriptionRecord, now: Date) =>
  isCurrentlyActiveSubscription(subscription, now) ? 'ACTIVE' : subscription.status === 'EXPIRED' ? 'EXPIRED' : 'REVOKED'

export async function syncSubscriptionEntitlements(
  payload: Payload,
  subscription: SubscriptionRecord,
  now = new Date(),
) {
  const userId = relationshipId(subscription.user)
  if (!userId) throw new Error('Subscription user relationship is required')

  const planResult = await payload.find({
    collection: 'subscription-plans',
    where: { and: [{ code: { equals: subscription.planCode } }, { active: { equals: true } }] },
    limit: 1,
    overrideAccess: true,
  })
  const plan = planResult.docs[0] as unknown as PlanRecord | undefined
  if (!plan) throw new Error(`Active subscription plan not found: ${subscription.planCode}`)

  const desiredEntitlementIds = new Set(
    (plan.entitlements ?? []).map(relationshipId).filter((id): id is string => Boolean(id)),
  )

  const existing = await payload.find({
    collection: 'entitlement-grants',
    where: {
      and: [
        { sourceType: { equals: 'subscription' } },
        { sourceId: { equals: String(subscription.id) } },
        { user: { equals: userId } },
      ],
    },
    limit: 100,
    overrideAccess: true,
  })

  const targetStatus = grantStatusFor(subscription, now)
  const endsAt = subscription.endsAt ?? undefined
  const existingByEntitlement = new Map<string, GrantRecord>()
  for (const doc of existing.docs as unknown as GrantRecord[]) {
    const entitlementId = relationshipId(doc.entitlement)
    if (entitlementId) existingByEntitlement.set(entitlementId, doc)
  }

  for (const entitlementId of desiredEntitlementIds) {
    const entitlement = await payload.findByID({
      collection: 'entitlements',
      id: entitlementId,
      overrideAccess: true,
    }) as unknown as EntitlementRecord
    if (!entitlement.active) continue

    const current = existingByEntitlement.get(entitlementId)
    const data = {
      user: userId,
      entitlement: entitlementId,
      sourceType: 'subscription' as const,
      sourceId: String(subscription.id),
      grantKey: `${userId}:${entitlementId}:subscription:${subscription.id}`,
      startsAt: subscription.startsAt,
      endsAt,
      status: targetStatus,
      metadata: { planCode: subscription.planCode, providerStatus: subscription.status },
    }

    if (current) {
      await payload.update({ collection: 'entitlement-grants', id: current.id, data, overrideAccess: true })
    } else {
      await payload.create({ collection: 'entitlement-grants', data, overrideAccess: true })
    }
  }

  for (const doc of existing.docs as unknown as GrantRecord[]) {
    const entitlementId = relationshipId(doc.entitlement)
    if (!entitlementId || !desiredEntitlementIds.has(entitlementId)) {
      await payload.update({
        collection: 'entitlement-grants',
        id: doc.id,
        data: { status: targetStatus === 'EXPIRED' ? 'EXPIRED' : 'REVOKED' },
        overrideAccess: true,
      })
    }
  }
}
