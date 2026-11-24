import layers from '../../../../contracts/authz/layers.json'

export type RoleAssignmentRecord = {
  id: string
  subjectId: string
  roleId: string
  scopeType: 'global' | 'organization' | 'ip'
  scopeId: string | null
  status: 'ACTIVE' | 'REVOKED'
  validFrom: string
  validUntil: string | null
  createdAt: string
  updatedAt: string
}

export type ResolvedRoleAssignment = Pick<RoleAssignmentRecord, 'id' | 'roleId' | 'scopeType' | 'scopeId'>

export type LayerResolution = {
  decision: 'ALLOW' | 'DENY'
  layer?: string
  roleAssignments?: ResolvedRoleAssignment[]
}

const mfaRequiredByLayer = new Map<string, boolean>()
for (const layer of layers['x-layers']) {
  mfaRequiredByLayer.set(layer.id, layer.mfa === true)
}

/** Pure policy helper; persistence and role resolution are owned by Neon. */
export function requireMfaForPrivilegedAction(layer: string, mfaEnabled: boolean): boolean {
  const mfaRequired = mfaRequiredByLayer.get(layer)
  if (mfaRequired === undefined) return false
  return mfaRequired ? mfaEnabled : true
}
