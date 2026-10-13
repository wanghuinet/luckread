import { describe, expect, it } from 'vitest'
import { subject } from '@casl/ability'
import { createW08Ability, createW08AbilityForRoles, resolveCatalogPermissionsForRoles, type W08AuthorizationContext, type W08RoleAuthorizationContext } from './index.js'
import layers from '../../../contracts/authz/layers.json'
import permissionCatalog from '../../../contracts/authz/permissions.json'

const context = (
  overrides: Partial<W08AuthorizationContext> = {},
): W08AuthorizationContext => ({
  subjectId: 'user-1',
  layer: 'L3',
  accountState: 'active',
  mfaVerified: false,
  effectivePermissions: ['content.update.own'],
  deniedPermissions: [],
  organizationIds: [],
  ipIds: [],
  ...overrides,
})

const resource = (type: string, fields: Record<string, unknown>) =>
  subject(type, fields)

describe('W08 CASL policy evaluator', () => {
  it('denies by default when no effective permission is present', () => {
    const ability = createW08Ability(context({ effectivePermissions: [] }))

    expect(ability.can('update', resource('content', { ownerId: 'user-1' }))).toBe(false)
  })

  it('does not infer permissions from the layer alone', () => {
    const ability = createW08Ability(context({
      layer: 'L8',
      mfaVerified: true,
      effectivePermissions: [],
    }))

    expect(ability.can('manage', 'all')).toBe(false)
    expect(ability.can('manage', 'secret')).toBe(false)
  })

  it('enforces the permission catalog minimum layer', () => {
    const ability = createW08Ability(context({
      layer: 'L2',
      effectivePermissions: ['content.update.own'],
    }))

    expect(ability.can('update', resource('content', { ownerId: 'user-1' }))).toBe(false)
  })

  it('allows an own-scope action only for the matching owner', () => {
    const ability = createW08Ability(context())

    expect(ability.can('update', resource('content', { ownerId: 'user-1' }))).toBe(true)
    expect(ability.can('update', resource('content', { ownerId: 'user-2' }))).toBe(false)
  })

  it('restricts organization-scoped actions to authoritative organization IDs', () => {
    const ability = createW08Ability(context({
      layer: 'L4',
      effectivePermissions: ['organization.member.manage'],
      organizationIds: ['org-1'],
    }))

    expect(ability.can('member_manage', resource('organization', { id: 'org-1' }))).toBe(true)
    expect(ability.can('member_manage', resource('organization', { id: 'org-2' }))).toBe(false)
  })

  it('restricts IP-scoped actions to authoritative IP IDs', () => {
    const ability = createW08Ability(context({
      layer: 'L4',
      effectivePermissions: ['ip.create'],
      ipIds: ['ip-1'],
    }))

    expect(ability.can('create', resource('ip', { id: 'ip-1' }))).toBe(true)
    expect(ability.can('create', resource('ip', { id: 'ip-2' }))).toBe(false)
  })

  it('makes an explicit DENY override the same ALLOW', () => {
    const ability = createW08Ability(context({
      effectivePermissions: ['content.update.own'],
      deniedPermissions: ['content.update.own'],
    }))

    expect(ability.can('update', resource('content', { ownerId: 'user-1' }))).toBe(false)
  })

  it('fails closed for suspended accounts even when grants are supplied', () => {
    const ability = createW08Ability(context({
      accountState: 'suspended',
      effectivePermissions: ['content.update.own', 'content.read.public'],
    }))

    expect(ability.can('update', resource('content', { ownerId: 'user-1' }))).toBe(false)
    expect(ability.can('read', resource('content', { visibility: 'public' }))).toBe(false)
  })

  it('allows restricted accounts public reads only', () => {
    const ability = createW08Ability(context({
      accountState: 'restricted',
      effectivePermissions: ['content.update.own', 'content.read.public', 'share.resolve'],
    }))

    expect(ability.can('read', resource('content', { visibility: 'public' }))).toBe(true)
    expect(ability.can('read', resource('content', { visibility: 'private' }))).toBe(false)
    expect(ability.can('resolve', 'share')).toBe(true)
    expect(ability.can('update', resource('content', { ownerId: 'user-1' }))).toBe(false)
  })

  it('requires MFA for L5-L8 protected permissions', () => {
    const withoutMfa = createW08Ability(context({
      layer: 'L5',
      effectivePermissions: ['content.curate'],
      mfaVerified: false,
    }))
    const withMfa = createW08Ability(context({
      layer: 'L5',
      effectivePermissions: ['content.curate'],
      mfaVerified: true,
    }))

    expect(withoutMfa.can('curate', 'content')).toBe(false)
    expect(withMfa.can('curate', 'content')).toBe(true)
  })

  it('ignores unregistered permission names', () => {
    const ability = createW08Ability(context({
      effectivePermissions: ['user.superpower.everything'],
    }))

    expect(ability.can('manage', 'all')).toBe(false)
  })

  it('allows only explicitly granted public read to an anonymous principal', () => {
    const ability = createW08Ability(context({
      subjectId: null,
      layer: 'L0',
      accountState: 'anonymous',
      effectivePermissions: ['content.read.public', 'social.follow'],
    }))

    expect(ability.can('read', resource('content', { visibility: 'public' }))).toBe(true)
    expect(ability.can('read', resource('content', { visibility: 'private' }))).toBe(false)
    expect(ability.can('follow', 'social')).toBe(false)
  })

  it('rejects an inconsistent anonymous identity/layer context', () => {
    const ability = createW08Ability(context({
      subjectId: 'user-1',
      layer: 'L0',
      accountState: 'anonymous',
      effectivePermissions: ['content.read.public'],
    }))

    expect(ability.can('read', resource('content', { visibility: 'public' }))).toBe(false)
  })
  it.each([
    {
      layer: 'L0' as const,
      accountState: 'anonymous' as const,
      subjectId: null,
      permission: 'content.read.public',
      action: 'read',
      target: resource('content', { visibility: 'public' }),
      mfaVerified: false,
    },
    {
      layer: 'L1' as const,
      accountState: 'active' as const,
      subjectId: 'user-1',
      permission: 'user.read.self',
      action: 'read',
      target: resource('user', { ownerId: 'user-1' }),
      mfaVerified: false,
    },
    {
      layer: 'L2' as const,
      accountState: 'active' as const,
      subjectId: 'user-1',
      permission: 'social.follow',
      action: 'follow',
      target: 'social',
      mfaVerified: false,
    },
    {
      layer: 'L3' as const,
      accountState: 'active' as const,
      subjectId: 'user-1',
      permission: 'content.update.own',
      action: 'update',
      target: resource('content', { ownerId: 'user-1' }),
      mfaVerified: false,
    },
    {
      layer: 'L4' as const,
      accountState: 'active' as const,
      subjectId: 'user-1',
      permission: 'organization.member.manage',
      action: 'member_manage',
      target: resource('organization', { id: 'org-1' }),
      mfaVerified: false,
      organizationIds: ['org-1'],
    },
    {
      layer: 'L5' as const,
      accountState: 'active' as const,
      subjectId: 'user-1',
      permission: 'content.curate',
      action: 'curate',
      target: 'content',
      mfaVerified: true,
    },
    {
      layer: 'L6' as const,
      accountState: 'active' as const,
      subjectId: 'user-1',
      permission: 'moderation.queue.read',
      action: 'queue_read',
      target: 'moderation',
      mfaVerified: true,
    },
    {
      layer: 'L7' as const,
      accountState: 'active' as const,
      subjectId: 'user-1',
      permission: 'role.assign',
      action: 'assign',
      target: 'role',
      mfaVerified: true,
    },
    {
      layer: 'L8' as const,
      accountState: 'active' as const,
      subjectId: 'user-1',
      permission: 'secret.manage',
      action: 'manage',
      target: 'secret',
      mfaVerified: true,
    },
  ])('covers an explicit least-privilege grant for $layer', ({
    layer, accountState, subjectId, permission, action, target, mfaVerified, organizationIds,
  }) => {
    const ability = createW08Ability(context({
      layer,
      accountState,
      subjectId,
      effectivePermissions: [permission],
      mfaVerified,
      organizationIds: organizationIds ?? [],
    }))

    expect(ability.can(action, target as never)).toBe(true)
    expect(ability.can('manage', 'all')).toBe(false)
  })

describe('public, interaction, notification and creator permission catalog slice', () => {
  it('includes only explicit public discovery defaults', () => {
    const permissions = resolveCatalogPermissionsForRoles([])

    expect(permissions).toEqual(expect.arrayContaining([
      'content.read.public',
      'search.read.public',
      'feed.read.public',
      'taxonomy.read',
    ]))
    expect(permissions).not.toContain('content.read.any')
    expect(permissions).not.toContain('secret.manage')
  })

  it('maps verified-user interaction and notification permissions explicitly', () => {
    const permissions = resolveCatalogPermissionsForRoles(['verified_user'])

    expect(permissions).toEqual(expect.arrayContaining([
      'comment.read',
      'comment.create',
      'interaction.like',
      'interaction.unlike',
      'interaction.favorite',
      'social.follow',
      'social.unfollow',
      'notification.read.self',
      'notification.update.self',
    ]))
    expect(permissions).not.toContain('content.create')
  })

  it('maps creator self-service and revision-create permissions only to creator and higher explicit admin roles', () => {
    const verified = resolveCatalogPermissionsForRoles(['verified_user'])
    const creator = resolveCatalogPermissionsForRoles(['verified_user', 'creator'])

    expect(verified).not.toContain('creator.read.self')
    expect(creator).toEqual(expect.arrayContaining([
      'creator.read.self',
      'creator.update.self',
      'creator.stats.read.self',
      'revision.create.own',
    ]))
  })

  it('does not let public defaults or verified-user grants perform privileged content curation', () => {
    const publicAbility = createW08AbilityForRoles({
      subjectId: null,
      layer: 'L0',
      accountState: 'anonymous',
      mfaVerified: false,
      effectiveRoles: [],
    })
    const verifiedAbility = createW08AbilityForRoles({
      subjectId: 'user-1',
      layer: 'L2',
      accountState: 'active',
      mfaVerified: false,
      effectiveRoles: ['user', 'verified_user'],
    })

    expect(publicAbility.can('read', 'feed')).toBe(true)
    expect(publicAbility.can('curate', 'content')).toBe(false)
    expect(verifiedAbility.can('favorite', 'interaction')).toBe(true)
    expect(verifiedAbility.can('update', resource('notification', { ownerId: 'user-1' }))).toBe(true)
    expect(verifiedAbility.can('curate', 'content')).toBe(false)
  })
})

describe('CASL ability from trusted role assignments', () => {
  const roleContext = (
    overrides: Partial<W08RoleAuthorizationContext> = {},
  ): W08RoleAuthorizationContext => ({
    subjectId: 'user-1',
    layer: 'L3',
    accountState: 'active',
    mfaVerified: false,
    effectiveRoles: ['user', 'verified_user', 'creator'],
    deniedPermissions: [],
    organizationIds: [],
    ipIds: [],
    ...overrides,
  })

  it('builds an ability from role mappings rather than trusting client permission names', () => {
    const ability = createW08AbilityForRoles(roleContext())

    expect(ability.can('update', resource('content', { ownerId: 'user-1' }))).toBe(true)
    expect(ability.can('follow', 'social')).toBe(true)
    expect(ability.can('manage', 'secret')).toBe(false)
  })

  it('fails closed if any effective role is not in the canonical role vocabulary', () => {
    const ability = createW08AbilityForRoles(roleContext({
      effectiveRoles: ['creator', 'founder'],
    }))

    expect(ability.can('update', resource('content', { ownerId: 'user-1' }))).toBe(false)
  })

  it('allows a valid scoped L4 role only inside its trusted scope without changing global layer', () => {
    const ability = createW08AbilityForRoles(roleContext({
      layer: 'L2',
      effectiveRoles: ['mcn_admin'],
      organizationIds: ['org-1'],
    }))

    expect(ability.can('member_manage', resource('organization', { id: 'org-1' }))).toBe(true)
    expect(ability.can('member_manage', resource('organization', { id: 'org-2' }))).toBe(false)
  })

  it('still enforces MFA and explicit DENY after resolving role grants', () => {
    const withoutMfa = createW08AbilityForRoles(roleContext({
      layer: 'L5',
      effectiveRoles: ['operator'],
      mfaVerified: false,
    }))
    const denied = createW08AbilityForRoles(roleContext({
      effectiveRoles: ['user', 'verified_user', 'creator'],
      deniedPermissions: ['content.update.own'],
    }))

    expect(withoutMfa.can('curate', 'content')).toBe(false)
    expect(denied.can('update', resource('content', { ownerId: 'user-1' }))).toBe(false)
  })
})

describe('canonical role-to-permission mapping', () => {
  it('combines only explicitly mapped grants for multiple effective roles', () => {
    const permissions = resolveCatalogPermissionsForRoles(['user', 'verified_user', 'creator'])

    expect(permissions).not.toBeNull()
    expect(permissions).toContain('content.read.public')
    expect(permissions).toContain('user.read.self')
    expect(permissions).toContain('social.follow')
    expect(permissions).toContain('content.update.own')
    expect(permissions).not.toContain('secret.manage')
    expect(permissions).not.toContain('role.assign')
  })

  it('does not grant every permission merely because the role has a high layer', () => {
    const permissions = resolveCatalogPermissionsForRoles(['editor'])

    expect(permissions).not.toBeNull()
    expect(permissions).toContain('content.curate')
    expect(permissions).not.toContain('role.assign')
    expect(permissions).not.toContain('secret.manage')
  })

  it('fails closed for an unknown or forbidden role identifier', () => {
    expect(resolveCatalogPermissionsForRoles(['creator', 'super_power'])).toBeNull()
    expect(resolveCatalogPermissionsForRoles(['founder'])).toBeNull()
  })

  it('has a role mapping for every canonical role, with only catalogued permission IDs', () => {
    const catalogNames = new Set(permissionCatalog['x-permissions'].map((item) => item.name))
    const roleIds = [...new Set(layers['x-layers'].flatMap((layer) => layer.roles ?? []))]

    for (const roleId of roleIds) {
      const permissions = resolveCatalogPermissionsForRoles([roleId])
      expect(permissions).not.toBeNull()
      for (const permission of permissions ?? []) {
        expect(catalogNames.has(permission)).toBe(true)
      }
    }
  })

  it('grants anonymous public defaults without introducing user or write permissions', () => {
    const permissions = resolveCatalogPermissionsForRoles([])

    expect(permissions).toEqual(expect.arrayContaining([
      'content.read.public',
      'media.read',
      'share.resolve',
    ]))
    expect(permissions).not.toContain('user.read.self')
    expect(permissions).not.toContain('social.follow')
    expect(permissions).not.toContain('content.create')
  })
})

})
