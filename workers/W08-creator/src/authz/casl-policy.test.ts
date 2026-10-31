import { describe, expect, it } from 'vitest'
import {
  evaluateCaslPermission,
  type CaslPermissionInput,
} from './casl-policy.js'

function evaluate(overrides: Partial<CaslPermissionInput> = {}) {
  return evaluateCaslPermission({
    layer: 'L2',
    subjectId: 'user-1',
    accountState: 'ACTIVE',
    action: 'interaction.like',
    resourceType: 'Content',
    resourceAttributes: { visibility: 'public', state: 'published' },
    ...overrides,
  })
}

describe('CASL L0-L8 authorization policy', () => {
  it('allows L0 to read only public published content', () => {
    expect(evaluate({
      layer: 'L0',
      subjectId: null,
      accountState: null,
      action: 'content.read.public',
      resourceType: 'Content',
      resourceAttributes: { visibility: 'public', state: 'published' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L0',
      subjectId: null,
      accountState: null,
      action: 'content.read.public',
      resourceType: 'Content',
      resourceAttributes: { visibility: 'private', state: 'published' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'PERMISSION_DENIED' })
  })

  it('keeps L1 at account self-service and denies social or creator writes', () => {
    expect(evaluate({
      layer: 'L1',
      action: 'user.update.self',
      resourceType: 'User',
      resourceAttributes: { id: 'user-1' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L1',
      action: 'user.update.self',
      resourceType: 'User',
      resourceAttributes: { id: 'user-2' },
    }).decision).toBe('DENY')

    expect(evaluate({
      layer: 'L1',
      action: 'content.create',
      resourceType: 'Content',
    }).decision).toBe('DENY')
  })

  it('allows L2 interactions but not creator publishing', () => {
    expect(evaluate({ action: 'interaction.like' }).decision).toBe('ALLOW')
    expect(evaluate({ action: 'comment.create', resourceType: 'Comment' }).decision).toBe('ALLOW')
    expect(evaluate({
      action: 'content.publish.own',
      layer: 'L2',
      resourceType: 'Content',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')
  })

  it('allows L3 to manage owned content and denies cross-account access', () => {
    expect(evaluate({
      layer: 'L3',
      action: 'content.update.own',
      resourceAttributes: { ownerId: 'user-1', state: 'draft' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L3',
      action: 'content.publish.own',
      resourceAttributes: { owner_id: 'user-1', state: 'draft' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L3',
      action: 'content.delete.own',
      resourceAttributes: { ownerId: 'user-2', state: 'published' },
    }).decision).toBe('DENY')

    expect(evaluate({
      layer: 'L3',
      action: 'creator.stats.read.self',
      resourceType: 'CreatorStats',
      resourceAttributes: { ownerId: 'user-2' },
    }).decision).toBe('DENY')
  })

  it('grants L4 scope access only for persisted scope-role assignments', () => {
    const scopedRoleAssignments = [{
      roleId: 'ip_principal',
      scopeType: 'ip' as const,
      scopeId: 'ip-1',
    }]

    expect(evaluate({
      layer: 'L2',
      action: 'ip.update.scope',
      resourceType: 'IP',
      resourceAttributes: { id: 'ip-1' },
      scopedRoleAssignments,
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L2',
      action: 'ip.update.scope',
      resourceType: 'IP',
      resourceAttributes: { id: 'ip-2' },
      scopedRoleAssignments,
    }).decision).toBe('DENY')
  })

  it('keeps mcn_editor scoped to content and denies organization member/billing controls', () => {
    const scopedRoleAssignments = [{
      roleId: 'mcn_editor',
      scopeType: 'organization' as const,
      scopeId: 'org-1',
    }]

    expect(evaluate({
      action: 'ip.content.manage.scope',
      resourceType: 'Content',
      resourceAttributes: { organizationId: 'org-1' },
      scopedRoleAssignments,
    }).decision).toBe('ALLOW')

    expect(evaluate({
      action: 'org.member.manage.scope',
      resourceType: 'OrganizationMember',
      resourceAttributes: { organizationId: 'org-1' },
      scopedRoleAssignments,
    }).decision).toBe('DENY')
  })

  it('gives L5 content curation permissions without L7 account administration', () => {
    expect(evaluate({
      layer: 'L5',
      action: 'content.curate',
      resourceType: 'Content',
      resourceAttributes: { id: 'content-2' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L5',
      action: 'user.suspend',
      resourceType: 'User',
      resourceAttributes: { id: 'user-2', layer: 'L2' },
    }).decision).toBe('DENY')
  })

  it('restricts L6 moderation and prevents action against L7/L8 accounts', () => {
    expect(evaluate({
      layer: 'L6',
      action: 'moderation.decide',
      resourceType: 'ModerationCase',
      resourceAttributes: { id: 'case-1' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L6',
      action: 'user.restrict.limited',
      resourceType: 'User',
      resourceAttributes: { id: 'user-2', layer: 'L8' },
    }).decision).toBe('DENY')
  })

  it('lets L7 assign non-L8 roles but not assign super_admin or target L8', () => {
    expect(evaluate({
      layer: 'L7',
      action: 'role.assign',
      resourceType: 'RoleAssignment',
      resourceAttributes: { roleId: 'creator', targetLayer: 'L3' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L7',
      action: 'role.assign',
      resourceType: 'RoleAssignment',
      resourceAttributes: { roleId: 'super_admin', targetLayer: 'L8' },
    }).decision).toBe('DENY')
  })

  it('allows L8 security/audit reads but never audit mutation', () => {
    expect(evaluate({
      layer: 'L8',
      action: 'security.manage',
      resourceType: 'SecurityConfig',
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L8',
      action: 'audit.read.any',
      resourceType: 'AuditLog',
    }).decision).toBe('ALLOW')

    for (const action of ['audit.update', 'audit.delete', 'audit.mutate', 'audit.delete.any']) {
      expect(evaluate({
        layer: 'L8',
        action,
        resourceType: 'AuditLog',
      }).decision).toBe('DENY')
    }
  })

  it('applies explicit deny before an otherwise matching L8 grant', () => {
    expect(evaluate({
      layer: 'L8',
      action: 'security.manage',
      resourceType: 'SecurityConfig',
      explicitDenies: ['security.manage'],
    })).toMatchObject({ decision: 'DENY', reasonCode: 'EXPLICIT_DENY' })
  })

  it('limits pending-verification and frozen accounts, and fails closed for suspended accounts', () => {
    expect(evaluate({
      layer: 'L1',
      accountState: 'PENDING_VERIFICATION',
      action: 'user.update.self',
      resourceType: 'User',
      resourceAttributes: { id: 'user-1' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L1',
      accountState: 'PENDING_VERIFICATION',
      action: 'interaction.like',
    }).decision).toBe('DENY')

    expect(evaluate({
      layer: 'L1',
      accountState: 'FROZEN',
      action: 'content.read.public',
      resourceAttributes: { visibility: 'public', state: 'published' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L3',
      accountState: 'FROZEN',
      action: 'content.publish.own',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')

    expect(evaluate({
      layer: 'L8',
      accountState: 'SUSPENDED',
      action: 'security.manage',
      resourceType: 'SecurityConfig',
    }).decision).toBe('DENY')
  })

  it('enforces the creator application permission contract with CASL', () => {
    expect(evaluate({
      layer: 'L2',
      action: 'creator.application.apply',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L2',
      action: 'creator.application.apply',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'user-2' },
    }).decision).toBe('DENY')

    expect(evaluate({
      layer: 'L1',
      action: 'creator.application.apply',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')

    expect(evaluate({
      layer: 'L3',
      action: 'creator.application.apply',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')

    expect(evaluate({
      layer: 'L2',
      action: 'creator.application.read.own',
      resourceType: 'CreatorApplication',
      resourceAttributes: { ownerId: 'user-2' },
    }).decision).toBe('DENY')

    expect(evaluate({
      layer: 'L7',
      action: 'creator.application.review',
      resourceType: 'CreatorApplication',
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L8',
      action: 'creator.application.review',
      resourceType: 'CreatorApplication',
    }).decision).toBe('ALLOW')

    expect(evaluate({
      layer: 'L6',
      action: 'creator.application.review',
      resourceType: 'CreatorApplication',
    }).decision).toBe('DENY')
  })

  it('authorizes membership plan creation and reads only for the creator owner at L3+', () => {
    expect(evaluate({
      layer: 'L3',
      action: 'membership.plan.create.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('ALLOW')
    expect(evaluate({
      layer: 'L3',
      action: 'membership.plan.read.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('ALLOW')
    expect(evaluate({
      layer: 'L3',
      action: 'membership.plan.publish.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('ALLOW')
    expect(evaluate({
      layer: 'L3',
      action: 'membership.plan.update.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('ALLOW')
    expect(evaluate({ layer: 'L3', action: 'membership.plan.lifecycle.own', resourceType: 'MembershipPlan', resourceAttributes: { ownerId: 'user-1' } }).decision).toBe('ALLOW')
    expect(evaluate({
      layer: 'L3',
      action: 'membership.plan.update.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-2' },
    }).decision).toBe('DENY')
    expect(evaluate({ layer: 'L3', action: 'membership.plan.lifecycle.own', resourceType: 'MembershipPlan', resourceAttributes: { ownerId: 'user-2' } }).decision).toBe('DENY')
    expect(evaluate({ layer: 'L2', action: 'membership.plan.lifecycle.own', resourceType: 'MembershipPlan', resourceAttributes: { ownerId: 'user-1' } }).decision).toBe('DENY')
    expect(evaluate({ layer: 'L3', accountState: 'FROZEN', action: 'membership.plan.lifecycle.own', resourceType: 'MembershipPlan', resourceAttributes: { ownerId: 'user-1' } }).decision).toBe('DENY')
    expect(evaluate({
      layer: 'L2',
      action: 'membership.plan.update.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')
    expect(evaluate({
      layer: 'L3',
      action: 'membership.plan.publish.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-2' },
    }).decision).toBe('DENY')
    expect(evaluate({
      layer: 'L2',
      action: 'membership.plan.publish.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')
    expect(evaluate({
      layer: 'L3',
      accountState: 'FROZEN',
      action: 'membership.plan.publish.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')
    expect(evaluate({
      layer: 'L3',
      action: 'membership.plan.create.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-2' },
    }).decision).toBe('DENY')
    expect(evaluate({
      layer: 'L2',
      action: 'membership.plan.create.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')
    expect(evaluate({
      layer: 'L3',
      accountState: 'FROZEN',
      action: 'membership.plan.create.own',
      resourceType: 'MembershipPlan',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')
  })

  it('authorizes owner-scoped commerce orders for L2+ and fails closed for unsafe accounts', () => {
    expect(evaluate({
      action: 'order.create',
      resourceType: 'Order',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'ALLOW' })
    expect(evaluate({
      action: 'order.read',
      resourceType: 'Order',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'ALLOW' })
    expect(evaluate({
      layer: 'L3',
      action: 'order.create',
      resourceType: 'Order',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'ALLOW' })
    expect(evaluate({
      layer: 'L7',
      action: 'order.read',
      resourceType: 'Order',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'ALLOW' })

    for (const action of ['order.create', 'order.read']) {
      expect(evaluate({
        action,
        resourceType: 'Order',
        resourceAttributes: { ownerId: 'user-2' },
      })).toMatchObject({ decision: 'DENY', reasonCode: 'PERMISSION_DENIED' })
    }

    expect(evaluate({
      layer: 'L1',
      action: 'order.create',
      resourceType: 'Order',
      resourceAttributes: { ownerId: 'user-1' },
    }).decision).toBe('DENY')
    expect(evaluate({
      accountState: 'RESTRICTED',
      action: 'order.create',
      resourceType: 'Order',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'ACCOUNT_RESTRICTED' })
    expect(evaluate({
      accountState: 'FROZEN',
      action: 'order.create',
      resourceType: 'Order',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'ACCOUNT_FROZEN_READ_ONLY' })
  })

  it('authorizes payment history reads only for the authenticated customer-owned Payment', () => {
    expect(evaluate({
      layer: 'L2',
      action: 'payment.read',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'ALLOW' })

    expect(evaluate({
      layer: 'L2',
      action: 'payment.read',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-2' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'PERMISSION_DENIED' })

    expect(evaluate({
      layer: 'L1',
      action: 'payment.read',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'DENY' })

    expect(evaluate({
      accountState: 'FROZEN',
      action: 'payment.read',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'ACCOUNT_FROZEN_READ_ONLY' })
  })

  it('authorizes refunds only against the authenticated customer-owned Payment at L2+', () => {
    expect(evaluate({
      layer: 'L2',
      action: 'payment.refund',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'ALLOW' })

    expect(evaluate({
      layer: 'L3',
      action: 'payment.refund',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'ALLOW' })

    expect(evaluate({
      action: 'payment.refund',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-2' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'PERMISSION_DENIED' })

    expect(evaluate({
      layer: 'L1',
      action: 'payment.refund',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'DENY' })

    expect(evaluate({
      accountState: 'RESTRICTED',
      action: 'payment.refund',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'ACCOUNT_RESTRICTED' })

    expect(evaluate({
      accountState: 'FROZEN',
      action: 'payment.refund',
      resourceType: 'Payment',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'ACCOUNT_FROZEN_READ_ONLY' })
  })

  it('allows subscribers to change only their own subscription plan at L2+', () => {
    expect(evaluate({
      layer: 'L2',
      action: 'subscription.change_plan',
      resourceType: 'Subscription',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'ALLOW' })

    expect(evaluate({
      layer: 'L2',
      action: 'subscription.change_plan',
      resourceType: 'Subscription',
      resourceAttributes: { ownerId: 'user-2' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'PERMISSION_DENIED' })

    expect(evaluate({
      layer: 'L1',
      action: 'subscription.change_plan',
      resourceType: 'Subscription',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'DENY' })

    expect(evaluate({
      layer: 'L2',
      accountState: 'FROZEN',
      action: 'subscription.change_plan',
      resourceType: 'Subscription',
      resourceAttributes: { ownerId: 'user-1' },
    })).toMatchObject({ decision: 'DENY', reasonCode: 'ACCOUNT_FROZEN_READ_ONLY' })
  })

  it('denies unknown permissions, unsupported subjects, and malformed attributes', () => {
    expect(evaluate({ action: 'permission.not.registered' })).toMatchObject({ decision: 'DENY', reasonCode: 'UNKNOWN_PERMISSION' })
    expect(evaluate({
      action: 'security.manage',
      layer: 'L8',
      resourceType: 'UnknownResource',
    }).decision).toBe('DENY')
    expect(evaluate({
      resourceAttributes: { '$where': 'malformed' },
    }).decision).toBe('DENY')
  })
})
