import { AbilityBuilder, createMongoAbility, subject as caslSubject } from '@casl/ability'
import layers from '../../../../contracts/authz/layers.json'
import permissions from '../../../../contracts/authz/permissions.json'

export type LayerId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8'
export type ScopedRoleAssignment = {
  roleId: string
  scopeType: 'organization' | 'ip'
  scopeId: string
}

export type CaslPermissionInput = {
  layer: LayerId
  subjectId: string | null
  accountState: string | null
  action: string
  resourceType: string
  resourceAttributes?: Record<string, unknown>
  scopedRoleAssignments?: ScopedRoleAssignment[]
  explicitDenies?: string[]
}

export type CaslPermissionDecision = {
  decision: 'ALLOW' | 'DENY'
  reasonCode?: string
  policyVersion: string
  layer: LayerId
  action: string
  resourceType: string
}

export const AUTHZ_POLICY_VERSION = 'casl-l0-l8-v1'

const CONTRACT_LAYERS = new Set<string>(layers['x-layers'].map((layer) => layer.id))
const CONTRACT_PERMISSION_NAMES = new Set<string>(
  (permissions as unknown as { 'x-permissions': Array<{ name: string }> })['x-permissions'].map((permission) => permission.name),
)
export const SUPPORTED_AUTHZ_SUBJECTS = [
  'Content',
  'Search',
  'Feed',
  'Taxonomy',
  'User',
  'Comment',
  'Interaction',
  'Follow',
  'Report',
  'Notification',
  'Creator',
  'CreatorApplication',
  'CreatorStats',
  'Media',
  'Revision',
  'IP',
  'IPMember',
  'IPRevenue',
  'Organization',
  'OrganizationMember',
  'OrganizationBilling',
  'Topic',
  'Campaign',
  'Analytics',
  'ModerationQueue',
  'ModerationCase',
  'Appeal',
  'RoleAssignment',
  'Subscription',
  'MembershipPlan',
  'Order',
  'Payment',
  'PlatformConfig',
  'FeatureFlag',
  'Secret',
  'SecurityConfig',
  'AuditLog',
] as const

const PUBLIC_READ_ACTIONS = new Set([
  'content.read.public',
  'search.read.public',
  'feed.read.public',
  'taxonomy.read',
])

const SAFE_FROZEN_ACTIONS = new Set([
  ...PUBLIC_READ_ACTIONS,
  'user.read.self',
])

const RESTRICTED_ACCOUNT_WRITE_DENIES = new Set([
  'content.create',
  'content.update.own',
  'content.delete.own',
  'content.submit_review.own',
  'content.publish.own',
  'content.unpublish.own',
  'content.schedule.own',
  'revision.create.own',
  'revision.restore.own',
  'media.upload',
  'comment.create',
  'subscription.manage.any',
  'order.create',
  'payment.refund',
  'membership.plan.create.own',
  'membership.plan.publish.own',
  'membership.plan.update.own',
  'membership.plan.lifecycle.own',
  'org.billing.read.scope',
])

const ADMIN_ONLY_ACTIONS = new Set([
  'content.curate',
  'content.feature',
  'content.promote',
  'topic.manage',
  'campaign.manage',
  'analytics.read',
  'moderation.queue.read',
  'moderation.case.read',
  'moderation.decide',
  'content.unpublish.any',
  'content.hide',
  'comment.moderate',
  'appeal.review',
  'appeal.decide',
  'user.restrict.limited',
  'user.read.any',
  'user.restrict.any',
  'user.suspend',
  'role.assign',
  'role.assign.any',
  'org.manage.any',
  'subscription.manage.any',
  'config.manage',
  'feature_flag.manage',
  'secret.manage',
  'security.manage',
  'audit.read.any',
])

function decision(
  input: CaslPermissionInput,
  result: 'ALLOW' | 'DENY',
  reasonCode?: string,
): CaslPermissionDecision {
  return {
    decision: result,
    ...(reasonCode ? { reasonCode } : {}),
    policyVersion: AUTHZ_POLICY_VERSION,
    layer: input.layer,
    action: input.action,
    resourceType: input.resourceType,
  }
}

function validResourceAttributes(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 32) return false

  return entries.every(([key, item]) => {
    if (
      key.length === 0 ||
      key.length > 64 ||
      key.startsWith('$') ||
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor'
    ) return false

    return item === null ||
      typeof item === 'string' ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
  })
}

function selfOwnerCondition(subjectId: string): Record<string, unknown> {
  // Resource ownership fields are normalized before constructing the CASL subject.
  return { ownerId: subjectId }
}

function addPublicAndSelfRules(
  grant: (action: string, subject: string, conditions?: Record<string, unknown>) => void,
  subjectId: string | null,
): void {
  grant('content.read.public', 'Content', { visibility: 'public', state: 'published' })
  grant('search.read.public', 'Search')
  grant('feed.read.public', 'Feed')
  grant('taxonomy.read', 'Taxonomy')

  if (subjectId) {
    grant('user.read.self', 'User', { id: subjectId })
    grant('user.update.self', 'User', { id: subjectId })
  }
}

function addL2Rules(
  grant: (action: string, subject: string, conditions?: Record<string, unknown>) => void,
  subjectId: string,
): void {
  grant('comment.create', 'Comment')
  grant('comment.read', 'Comment', {
    contentVisibility: 'public',
    contentState: 'published',
    commentState: 'visible',
  })
  grant('interaction.like', 'Content', { visibility: 'public', state: 'published' })
  grant('interaction.unlike', 'Interaction', { actorId: subjectId })
  grant('interaction.favorite', 'Content', { visibility: 'public', state: 'published' })
  grant('social.follow', 'User', { id: { $ne: subjectId }, accountState: 'ACTIVE' })
  grant('social.unfollow', 'Follow', { followerId: subjectId })
  grant('social.block', 'User', { id: { $ne: subjectId }, accountState: 'ACTIVE' })
  grant('social.mute', 'User', { id: { $ne: subjectId }, accountState: 'ACTIVE' })
  grant('report.create', 'Report')
  grant('notification.read.self', 'Notification', selfOwnerCondition(subjectId))
  grant('notification.update.self', 'Notification', selfOwnerCondition(subjectId))
}

function addL3Rules(
  grant: (action: string, subject: string, conditions?: Record<string, unknown>) => void,
  subjectId: string,
): void {
  grant('content.create', 'Content')
  grant('content.read.own', 'Content', selfOwnerCondition(subjectId))
  grant('content.update.own', 'Content', selfOwnerCondition(subjectId))
  grant('content.delete.own', 'Content', selfOwnerCondition(subjectId))
  grant('content.submit_review.own', 'Content', selfOwnerCondition(subjectId))
  grant('content.publish.own', 'Content', selfOwnerCondition(subjectId))
  grant('content.unpublish.own', 'Content', selfOwnerCondition(subjectId))
  grant('content.schedule.own', 'Content', selfOwnerCondition(subjectId))
  grant('revision.create.own', 'Revision', selfOwnerCondition(subjectId))
  grant('revision.restore.own', 'Revision', selfOwnerCondition(subjectId))
  grant('media.upload', 'Media')
  grant('media.read.own', 'Media', selfOwnerCondition(subjectId))
  grant('creator.read.self', 'Creator', selfOwnerCondition(subjectId))
  grant('creator.update.self', 'Creator', selfOwnerCondition(subjectId))
  grant('creator.stats.read.self', 'CreatorStats', selfOwnerCondition(subjectId))
  grant('membership.plan.create.own', 'MembershipPlan', selfOwnerCondition(subjectId))
  grant('membership.plan.read.own', 'MembershipPlan', selfOwnerCondition(subjectId))
  grant('membership.plan.publish.own', 'MembershipPlan', selfOwnerCondition(subjectId))
  grant('membership.plan.update.own', 'MembershipPlan', selfOwnerCondition(subjectId))
  grant('membership.plan.lifecycle.own', 'MembershipPlan', selfOwnerCondition(subjectId))
}

function addL5Rules(grant: (action: string, subject: string, conditions?: Record<string, unknown>) => void): void {
  grant('content.read.any', 'Content')
  grant('content.curate', 'Content')
  grant('content.feature', 'Content')
  grant('content.promote', 'Content')
  grant('topic.manage', 'Topic')
  grant('campaign.manage', 'Campaign')
  grant('analytics.read', 'Analytics')
}

function addL6Rules(
  grant: (action: string, subject: string, conditions?: Record<string, unknown>) => void,
  subjectId: string,
): void {
  grant('moderation.queue.read', 'ModerationQueue')
  grant('moderation.case.read', 'ModerationCase')
  grant('moderation.decide', 'ModerationCase')
  grant('content.unpublish.any', 'Content')
  grant('content.hide', 'Content')
  grant('comment.moderate', 'Comment')
  grant('appeal.review', 'Appeal')
  grant('appeal.decide', 'Appeal')
  grant('user.restrict.limited', 'User', {
    id: { $ne: subjectId },
    layer: { $nin: ['L7', 'L8'] },
  })
}

function addL7Rules(
  grant: (action: string, subject: string, conditions?: Record<string, unknown>) => void,
  subjectId: string,
): void {
  grant('creator.application.review', 'CreatorApplication')
  grant('user.read.any', 'User')
  grant('user.restrict.any', 'User', {
    id: { $ne: subjectId },
    layer: { $nin: ['L7', 'L8'] },
  })
  grant('user.suspend', 'User', {
    id: { $ne: subjectId },
    layer: { $nin: ['L7', 'L8'] },
  })
  grant('role.assign', 'RoleAssignment', {
    roleId: { $ne: 'super_admin' },
    targetLayer: { $ne: 'L8' },
  })
  grant('org.manage.any', 'Organization')
  grant('subscription.manage.any', 'Subscription')
  grant('config.manage', 'PlatformConfig')
  grant('feature_flag.manage', 'FeatureFlag')
}

function addL8Rules(grant: (action: string, subject: string, conditions?: Record<string, unknown>) => void): void {
  grant('secret.manage', 'Secret')
  grant('security.manage', 'SecurityConfig')
  grant('audit.read.any', 'AuditLog')
  grant('role.assign.any', 'RoleAssignment')
}

function addScopedRoleRules(
  grant: (action: string, subject: string, conditions?: Record<string, unknown>) => void,
  assignments: ScopedRoleAssignment[],
): void {
  const ipIds = [...new Set(assignments
    .filter((item) => item.roleId === 'ip_principal' && item.scopeType === 'ip')
    .map((item) => item.scopeId))]
  const orgAdminIds = [...new Set(assignments
    .filter((item) => item.roleId === 'mcn_admin' && item.scopeType === 'organization')
    .map((item) => item.scopeId))]
  const orgEditorIds = [...new Set(assignments
    .filter((item) => item.roleId === 'mcn_editor' && item.scopeType === 'organization')
    .map((item) => item.scopeId))]

  if (ipIds.length > 0) {
    grant('ip.read.scope', 'IP', { id: { $in: ipIds } })
    grant('ip.update.scope', 'IP', { id: { $in: ipIds } })
    grant('ip.member.invite', 'IPMember', { ipId: { $in: ipIds } })
    grant('ip.member.remove', 'IPMember', { ipId: { $in: ipIds } })
    grant('ip.member.role.update', 'IPMember', { ipId: { $in: ipIds } })
    grant('ip.content.manage.scope', 'Content', { ipId: { $in: ipIds } })
    grant('ip.revenue.read.scope', 'IPRevenue', { ipId: { $in: ipIds } })
  }

  if (orgAdminIds.length > 0) {
    grant('org.read.scope', 'Organization', { id: { $in: orgAdminIds } })
    grant('org.member.manage.scope', 'OrganizationMember', { organizationId: { $in: orgAdminIds } })
    grant('org.billing.read.scope', 'OrganizationBilling', { organizationId: { $in: orgAdminIds } })
    grant('ip.content.manage.scope', 'Content', { organizationId: { $in: orgAdminIds } })
  }

  if (orgEditorIds.length > 0) {
    grant('org.read.scope', 'Organization', { id: { $in: orgEditorIds } })
    grant('ip.content.manage.scope', 'Content', { organizationId: { $in: orgEditorIds } })
  }
}

function buildLayerAbility(input: CaslPermissionInput) {
  const builder = new AbilityBuilder(createMongoAbility)
  const grant = (action: string, target: string, conditions?: Record<string, unknown>) => {
    if (conditions) builder.can(action, target, conditions as never)
    else builder.can(action, target)
  }
  const { cannot, build } = builder

  addPublicAndSelfRules(grant, input.subjectId)

  // Commerce permissions require a verified L2+ identity but are independent
  // of platform-management capabilities granted at higher layers.
  if (input.layer !== 'L0' && input.layer !== 'L1' && input.subjectId) {
    grant('order.create', 'Order', selfOwnerCondition(input.subjectId))
    grant('order.read', 'Order', selfOwnerCondition(input.subjectId))
    grant('payment.read', 'Payment', selfOwnerCondition(input.subjectId))
    grant('payment.refund', 'Payment', selfOwnerCondition(input.subjectId))
    grant('subscription.create', 'Subscription', selfOwnerCondition(input.subjectId))
    grant('subscription.change_plan', 'Subscription', selfOwnerCondition(input.subjectId))
  }

  // Creator application creation is deliberately L2-only; it is not inherited
  // by L3+ simply because higher layers have broader general capabilities.
  if (input.layer === 'L2' && input.subjectId) {
    grant('creator.application.apply', 'CreatorApplication', selfOwnerCondition(input.subjectId))
  }
  if (['L2', 'L3', 'L4'].includes(input.layer) && input.subjectId) {
    grant('creator.application.read.own', 'CreatorApplication', selfOwnerCondition(input.subjectId))
  }

  if (input.layer === 'L2' || input.layer === 'L3' || input.layer === 'L4') {
    if (input.subjectId) addL2Rules(grant, input.subjectId)
  }
  if ((input.layer === 'L3' || input.layer === 'L4') && input.subjectId) {
    addL3Rules(grant, input.subjectId)
  }
  if (input.layer === 'L5') addL5Rules(grant)
  if (input.layer === 'L6') {
    if (input.subjectId) addL6Rules(grant, input.subjectId)
  }
  if (input.layer === 'L7' || input.layer === 'L8') {
    addL5Rules(grant)
    if (input.subjectId) addL6Rules(grant, input.subjectId)
    addL7Rules(grant, input.subjectId ?? '')
  }
  if (input.layer === 'L8') addL8Rules(grant)

  addScopedRoleRules(grant, input.scopedRoleAssignments ?? [])

  // These restrictions are deliberately added last; CASL evaluates the last
  // matching rule first, so they cannot be overridden by a grant.
  cannot(['audit.update', 'audit.delete', 'audit.mutate', 'audit.update.any', 'audit.delete.any'], 'AuditLog')
  cannot('role.assign', 'RoleAssignment', { roleId: 'super_admin' })
  cannot('user.restrict.limited', 'User', { layer: { $in: ['L7', 'L8'] } })
  cannot('user.restrict.any', 'User', { layer: { $in: ['L7', 'L8'] } })
  cannot('user.suspend', 'User', { layer: { $in: ['L7', 'L8'] } })

  return build()
}

/**
 * Evaluate one permission facet using CASL. Authentication, MFA/credential
 * assurance, entitlement, workflow approval and business-state gates remain
 * independent mandatory checks in the canonical authorization decision.
 */
export function evaluateCaslPermission(input: CaslPermissionInput): CaslPermissionDecision {
  try {
    if (!input || typeof input !== 'object') {
      throw new Error('missing request')
    }
    if (!CONTRACT_LAYERS.has(input.layer)) {
      return decision(input, 'DENY', 'UNKNOWN_LAYER')
    }
    if (typeof input.action !== 'string' || input.action.trim().length === 0 || input.action.length > 128) {
      return decision(input, 'DENY', 'INVALID_ACTION')
    }
    if (!CONTRACT_PERMISSION_NAMES.has(input.action)) {
      return decision(input, 'DENY', 'UNKNOWN_PERMISSION')
    }
    if (!(SUPPORTED_AUTHZ_SUBJECTS as readonly string[]).includes(input.resourceType)) {
      return decision(input, 'DENY', 'UNSUPPORTED_RESOURCE')
    }
    if (!validResourceAttributes(input.resourceAttributes ?? {})) {
      return decision(input, 'DENY', 'INVALID_RESOURCE_ATTRIBUTES')
    }
    if (input.explicitDenies?.some((item) => item === input.action || item === '*')) {
      return decision(input, 'DENY', 'EXPLICIT_DENY')
    }

    if (input.layer === 'L0') {
      if (input.subjectId !== null || input.accountState !== null) {
        return decision(input, 'DENY', 'INVALID_ANONYMOUS_CONTEXT')
      }
    } else {
      if (typeof input.subjectId !== 'string' || input.subjectId.length === 0 || input.subjectId.length > 128) {
        return decision(input, 'DENY', 'MISSING_SUBJECT')
      }
      if (typeof input.accountState !== 'string') {
        return decision(input, 'DENY', 'MISSING_ACCOUNT_STATE')
      }

      if (input.accountState === 'PENDING_VERIFICATION') {
        if (input.layer !== 'L1') return decision(input, 'DENY', 'LAYER_STATE_MISMATCH')
        if (!PUBLIC_READ_ACTIONS.has(input.action) && input.action !== 'user.read.self' && input.action !== 'user.update.self') {
          return decision(input, 'DENY', 'EMAIL_VERIFICATION_REQUIRED')
        }
      } else if (input.accountState === 'RESTRICTED') {
        if (
          RESTRICTED_ACCOUNT_WRITE_DENIES.has(input.action) ||
          ADMIN_ONLY_ACTIONS.has(input.action) ||
          input.action.startsWith('ip.') ||
          input.action.startsWith('org.')
        ) {
          return decision(input, 'DENY', 'ACCOUNT_RESTRICTED')
        }
      } else if (input.accountState === 'FROZEN') {
        if (!SAFE_FROZEN_ACTIONS.has(input.action)) return decision(input, 'DENY', 'ACCOUNT_FROZEN_READ_ONLY')
      } else if (input.accountState !== 'ACTIVE') {
        return decision(input, 'DENY', 'ACCOUNT_STATE_DENY')
      }
    }

    const resourceAttributes = { ...(input.resourceAttributes ?? {}) }

    // Some owning Workers expose the database field as owner_id while other
    // DTOs use ownerId. Normalize this alias before CASL evaluates ownership.
    if (
      resourceAttributes.ownerId !== undefined &&
      resourceAttributes.owner_id !== undefined &&
      resourceAttributes.ownerId !== resourceAttributes.owner_id
    ) {
      return decision(input, 'DENY', 'AMBIGUOUS_RESOURCE_OWNERSHIP')
    }
    if (resourceAttributes.ownerId === undefined && typeof resourceAttributes.owner_id === 'string') {
      resourceAttributes.ownerId = resourceAttributes.owner_id
    }

    const ability = buildLayerAbility(input)
    const taggedResource = caslSubject(input.resourceType, resourceAttributes)
    if (!ability.can(input.action, taggedResource)) {
      return decision(input, 'DENY', 'PERMISSION_DENIED')
    }
    return decision(input, 'ALLOW')
  } catch {
    const safeInput: CaslPermissionInput = input && typeof input === 'object'
      ? {
          layer: input.layer,
          subjectId: input.subjectId ?? null,
          accountState: input.accountState ?? null,
          action: typeof input.action === 'string' ? input.action : 'unknown',
          resourceType: typeof input.resourceType === 'string' ? input.resourceType : 'unknown',
        }
      : {
          layer: 'L0',
          subjectId: null,
          accountState: null,
          action: 'unknown',
          resourceType: 'unknown',
        }
    return decision(safeInput, 'DENY', 'AUTHORIZATION_EVALUATION_FAILED')
  }
}
