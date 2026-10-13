import { describe, expect, it } from 'vitest'
import { subject } from '@casl/ability'
import { createW08Ability, type W08AuthorizationContext } from './index.js'

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
      effectivePermissions: ['content.update.own', 'content.read.public'],
    }))

    expect(ability.can('read', resource('content', { visibility: 'public' }))).toBe(true)
    expect(ability.can('read', resource('content', { visibility: 'private' }))).toBe(false)
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
})
