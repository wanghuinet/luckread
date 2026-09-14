import { APIError, type Payload } from 'payload'

import type { AuthorizationUser } from './authorization'

type Relationship = string | number | { id?: string | number } | null | undefined

export type OrganizationScope = {
  organizationId: string | number
  scopes: readonly string[]
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'
}

const relationshipId = (value: Relationship): string | undefined => {
  if (value == null) return undefined
  if (typeof value === 'object') return value.id == null ? undefined : String(value.id)
  return String(value)
}

export function canAccessOrganizationScope(args: {
  user: AuthorizationUser | null
  organizationId: string | number
  requiredScope: string
  memberships: readonly OrganizationScope[]
}): boolean {
  const { user, organizationId, requiredScope, memberships } = args
  if (!user) return false
  return memberships.some((membership) =>
    membership.status === 'ACTIVE' &&
    String(membership.organizationId) === String(organizationId) &&
    (membership.scopes.includes('*') || membership.scopes.includes(requiredScope)),
  )
}

export async function getUserOrganizationScopes(payload: Payload, userId: string | number): Promise<OrganizationScope[]> {
  const result = await payload.find({
    collection: 'organization-memberships',
    where: { and: [{ user: { equals: String(userId) } }, { status: { equals: 'ACTIVE' } }] },
    depth: 0,
    limit: 200,
    overrideAccess: true,
  })

  return result.docs.map((doc) => ({
    organizationId: relationshipId(doc.organization) ?? '',
    scopes: Array.isArray(doc.scopes) ? doc.scopes.filter((value): value is string => typeof value === 'string') :
      doc.scopes && typeof doc.scopes === 'object' && Array.isArray((doc.scopes as { scopes?: unknown }).scopes)
        ? ((doc.scopes as { scopes: unknown[] }).scopes.filter((value): value is string => typeof value === 'string'))
        : [],
    status: doc.status as OrganizationScope['status'],
  })).filter((value) => value.organizationId !== '')
}

export async function assertOrganizationScope(args: {
  payload: Payload
  user: AuthorizationUser | null
  organizationId: string | number
  requiredScope: string
}): Promise<void> {
  if (!args.user) throw new APIError('Authentication required', 401)
  const memberships = await getUserOrganizationScopes(args.payload, args.user.id)
  if (!canAccessOrganizationScope({ ...args, memberships })) {
    throw new APIError('Organization scope permission denied', 403)
  }
}
