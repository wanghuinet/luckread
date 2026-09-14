import { APIError } from 'payload'

export type EntitlementGrantRecord = {
  id: string | number
  entitlement: string | number | { id: string | number }
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  startsAt: string
  endsAt?: string | null
  scope?: unknown
}

export type EffectiveEntitlement = {
  code: string
  grantId: string | number
  scope?: unknown
  startsAt: string
  endsAt?: string | null
}

export function relationshipId(value: unknown): string | number {
  if (typeof value === 'string' || typeof value === 'number') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'string' || typeof id === 'number') return id
  }
  throw new APIError('Invalid relationship identifier', 500)
}

export function isEffectiveGrant(grant: EntitlementGrantRecord, now = new Date()): boolean {
  if (grant.status !== 'ACTIVE') return false
  const starts = Date.parse(grant.startsAt)
  if (Number.isNaN(starts) || starts > now.getTime()) return false
  if (grant.endsAt) {
    const ends = Date.parse(grant.endsAt)
    if (Number.isNaN(ends) || ends <= now.getTime()) return false
  }
  return true
}

export function resolveEffectiveEntitlements(
  grants: readonly EntitlementGrantRecord[],
  entitlementCodes: ReadonlyMap<string | number, string>,
  now = new Date(),
): EffectiveEntitlement[] {
  return grants.filter((grant) => isEffectiveGrant(grant, now)).flatMap((grant) => {
    const entitlementId = relationshipId(grant.entitlement)
    const code = entitlementCodes.get(entitlementId)
    if (!code) return []
    return [{
      code,
      grantId: grant.id,
      scope: grant.scope,
      startsAt: grant.startsAt,
      endsAt: grant.endsAt,
    }]
  })
}

export function hasEffectiveEntitlement(
  grants: readonly EntitlementGrantRecord[],
  entitlementCodes: ReadonlyMap<string | number, string>,
  code: string,
  now = new Date(),
): boolean {
  return resolveEffectiveEntitlements(grants, entitlementCodes, now).some((item) => item.code === code)
}
