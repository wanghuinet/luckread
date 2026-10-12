/**
 * Which authenticated principals may approve a role grant.
 * L7/L8 can approve all allow-listed grants. L4 mcn_admin may appoint only
 * mcn_editor in the exact same organization scope; it cannot elevate globally
 * or mint another admin/IP-principal role.
 */
export function mayApproveRoleGrant(
  layer: string | null | undefined,
  roleId: string,
  scopeType: string,
  hasMatchingScopedAdminAssignment: boolean,
): boolean {
  if (layer === 'L7' || layer === 'L8') return true
  return roleId === 'mcn_editor' &&
    scopeType === 'organization' &&
    hasMatchingScopedAdminAssignment
}
