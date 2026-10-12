export type Layer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8'
export type ScopeType = 'organization' | 'ip'
export type ScopeRole = 'IP_PRINCIPAL' | 'ORG_LEAD' | 'ORG_EDITOR'

export type RoleAppointment = {
  scopeType: ScopeType
  scopeRole: ScopeRole
  roleId: 'ip_principal' | 'mcn_admin' | 'mcn_editor'
}

export function mayApplyForCreator(layer: string | null | undefined): boolean {
  // L2 is the exact onboarding state. A global L3 creator should manage their
  // existing creator identity instead of opening a duplicate application.
  return layer === 'L2'
}

export function mayReviewCreatorApplication(layer: string | null | undefined): boolean {
  return layer === 'L7' || layer === 'L8'
}

/**
 * This is intentionally a narrow mapping. Clients choose a business intent;
 * W08 derives the actual role and scope. Clients never submit a roleId.
 */
export function deriveRoleAppointment(
  scopeType: unknown,
  scopeRole: unknown,
): RoleAppointment | null {
  if (scopeType === 'ip' && scopeRole === 'IP_PRINCIPAL') {
    return { scopeType: 'ip', scopeRole: 'IP_PRINCIPAL', roleId: 'ip_principal' }
  }
  if (scopeType === 'organization' && scopeRole === 'ORG_LEAD') {
    return { scopeType: 'organization', scopeRole: 'ORG_LEAD', roleId: 'mcn_admin' }
  }
  if (scopeType === 'organization' && scopeRole === 'ORG_EDITOR') {
    return { scopeType: 'organization', scopeRole: 'ORG_EDITOR', roleId: 'mcn_editor' }
  }
  return null
}

export function parseExpectedVersion(value: string | null): number | null {
  if (!value) return null
  const normalized = value.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  if (!/^[1-9][0-9]*$/.test(normalized)) return null
  const version = Number(normalized)
  return Number.isSafeInteger(version) ? version : null
}

export function validIdempotencyKey(value: string | null): value is string {
  return !!value && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value)
}
