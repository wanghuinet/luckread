import {
  evaluateCaslPermission,
  type CaslPermissionDecision,
  type CaslPermissionInput,
  type LayerId,
} from './casl-policy.js'

export type TrustedW08Principal = {
  userId: string
  accountState?: string
  layer?: string
}

/**
 * Evaluates a Creator Application operation using the authenticated principal
 * resolved by W02 over the private Service Binding. Client-provided layer,
 * actor id, or owner fields are never accepted by this helper.
 */
export function evaluateCreatorApplicationPermission(
  principal: TrustedW08Principal,
  action: 'creator.application.apply' | 'creator.application.read.own' | 'creator.application.review',
  resourceAttributes: Record<string, unknown>,
): CaslPermissionDecision {
  const input: CaslPermissionInput = {
    layer: (principal.layer ?? '') as LayerId,
    subjectId: principal.userId,
    accountState: principal.accountState ?? null,
    action,
    resourceType: 'CreatorApplication',
    resourceAttributes: {
      ...resourceAttributes,
      // Owner is always derived from the W02 principal, never from request JSON.
      ...(action === 'creator.application.apply' || action === 'creator.application.read.own'
        ? { ownerId: principal.userId }
        : {}),
    },
  }
  return evaluateCaslPermission(input)
}
