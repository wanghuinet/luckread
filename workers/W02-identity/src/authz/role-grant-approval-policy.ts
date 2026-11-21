/**
 * Only the platform administrators defined by the L0-L8 contract may approve
 * a global L3 creator role grant.
 */
export function mayApproveRoleGrant(layer: string | null | undefined): boolean {
  return layer === 'L7' || layer === 'L8'
}
