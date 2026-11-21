export type CreatorRoleGrantCommand = {
  subjectId: string
  roleId: 'creator'
  scopeType: 'global'
  scopeId: null
  approvalRef: string
}

export type CreatorRoleGrantResult = {
  assignmentId: string
  roleId: string
  replayed: boolean
}

/**
 * Persistence boundary for W02's narrowly admitted global L3 creator grant.
 * W02 remains the authorization authority; implementations only persist the
 * deterministic RoleAssignment after the caller has authenticated an L7/L8 approver.
 */
export interface CreatorRoleGrantStore {
  grant(command: CreatorRoleGrantCommand, now: string): Promise<CreatorRoleGrantResult>
}

export class RoleAssignmentCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'RoleAssignmentCommandError'
  }
}

/** Run the command against the explicitly selected W02 persistence adapter. */
export async function grantCreatorBusinessRoleWithStore(
  store: CreatorRoleGrantStore,
  command: CreatorRoleGrantCommand,
  now = new Date().toISOString(),
): Promise<CreatorRoleGrantResult> {
  return store.grant(command, now)
}
