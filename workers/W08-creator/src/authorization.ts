import { AbilityBuilder, createMongoAbility, type ForcedSubject, type MongoAbility } from '@casl/ability'
import permissionCatalog from '../../../contracts/authz/permissions.json'

export type PermissionLayer = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8'
export type AccountState =
  | 'active'
  | 'restricted'
  | 'frozen'
  | 'suspended'
  | 'pending_deletion'
  | 'deleted'
  | 'banned'
  | 'anonymous'

export type W08Ability = MongoAbility<[string, string | ForcedSubject<string>]>

type PermissionScope = 'platform' | 'organization' | 'ip' | 'own' | 'public'
type PermissionDefinition = {
  name: string
  resource: string
  action: string
  minLayer: PermissionLayer
  scope: PermissionScope
  sensitive?: boolean
  auditRequired?: boolean
}

/**
 * This context is for trusted server-side use only. The caller must resolve the
 * identity, account state, global layer, effective grants and scope IDs from
 * authoritative services before creating an ability. Never build it from a
 * request body, query string, client-side token claims, or user-editable fields.
 */
export type W08AuthorizationContext = {
  subjectId: string | null
  layer: PermissionLayer
  accountState: AccountState
  mfaVerified: boolean
  effectivePermissions: readonly string[]
  deniedPermissions?: readonly string[]
  organizationIds?: readonly string[]
  ipIds?: readonly string[]
}

const LAYER_RANK: Record<PermissionLayer, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
  L5: 5,
  L6: 6,
  L7: 7,
  L8: 8,
}

const PERMISSION_SCOPES = new Set<PermissionScope>([
  'platform',
  'organization',
  'ip',
  'own',
  'public',
])

function isLayer(value: unknown): value is PermissionLayer {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LAYER_RANK, value)
}

function isAccountState(value: unknown): value is AccountState {
  return typeof value === 'string' && [
    'active',
    'restricted',
    'frozen',
    'suspended',
    'pending_deletion',
    'deleted',
    'banned',
    'anonymous',
  ].includes(value)
}

function isStringList(value: unknown): value is readonly string[]
function isStringList(value: unknown, optional: true): value is readonly string[] | undefined
function isStringList(value: unknown, optional = false): value is readonly string[] | undefined {
  if (value === undefined && optional) return true
  return Array.isArray(value) &&
    value.length <= 500 &&
    value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 256)
}

function isContext(value: unknown): value is W08AuthorizationContext {
  if (value === null || typeof value !== 'object') return false

  const candidate = value as Partial<W08AuthorizationContext>
  if (
    !(candidate.subjectId === null ||
      (typeof candidate.subjectId === 'string' &&
        candidate.subjectId.length > 0 &&
        candidate.subjectId.length <= 128)) ||
    !isLayer(candidate.layer) ||
    !isAccountState(candidate.accountState) ||
    typeof candidate.mfaVerified !== 'boolean' ||
    !isStringList(candidate.effectivePermissions) ||
    !isStringList(candidate.deniedPermissions, true) ||
    !isStringList(candidate.organizationIds, true) ||
    !isStringList(candidate.ipIds, true)
  ) {
    return false
  }

  return candidate.effectivePermissions.length <= 500 &&
    (candidate.deniedPermissions?.length ?? 0) <= 500
}

function isPermissionDefinition(value: unknown): value is PermissionDefinition {
  if (value === null || typeof value !== 'object') return false

  const candidate = value as Partial<PermissionDefinition>
  return typeof candidate.name === 'string' &&
    typeof candidate.resource === 'string' &&
    typeof candidate.action === 'string' &&
    isLayer(candidate.minLayer) &&
    typeof candidate.scope === 'string' &&
    PERMISSION_SCOPES.has(candidate.scope as PermissionScope)
}

const catalogDocument = permissionCatalog as { 'x-permissions'?: unknown[] }
const PERMISSION_BY_NAME = new Map<string, PermissionDefinition>(
  (Array.isArray(catalogDocument['x-permissions']) ? catalogDocument['x-permissions'] : [])
    .filter(isPermissionDefinition)
    .map((permission) => [permission.name, permission]),
)

function cleanScopeIds(value: readonly string[] | undefined): string[] {
  return [...new Set((value ?? []).filter((id) => id.length > 0 && id.length <= 256))]
}

function addGrant(
  can: (action: string, subject: string, conditions?: Record<string, unknown>) => void,
  permission: PermissionDefinition,
  context: W08AuthorizationContext,
): void {
  switch (permission.scope) {
    case 'own': {
      if (!context.subjectId) return
      // Domain adapters must normalize owned records to ownerId before checking
      // the rule. This keeps ownership checks consistent across resource models.
      can(permission.action, permission.resource, { ownerId: context.subjectId })
      return
    }
    case 'organization': {
      const organizationIds = cleanScopeIds(context.organizationIds)
      if (organizationIds.length === 0) return
      const conditions = permission.resource === 'organization' || permission.resource === 'org'
        ? { id: { $in: organizationIds } }
        : { organizationId: { $in: organizationIds } }
      can(permission.action, permission.resource, conditions)
      return
    }
    case 'ip': {
      const ipIds = cleanScopeIds(context.ipIds)
      if (ipIds.length === 0) return
      const conditions = permission.resource === 'ip'
        ? { id: { $in: ipIds } }
        : { ipId: { $in: ipIds } }
      can(permission.action, permission.resource, conditions)
      return
    }
    case 'public': {
      // These catalog entries describe public resource reads. Visibility is
      // checked here; publication/lifecycle state remains the owning domain's
      // business-state check and must still run on the server.
      if (permission.name === 'content.read.public' || permission.name === 'media.read') {
        can(permission.action, permission.resource, { visibility: 'public' })
      } else {
        can(permission.action, permission.resource)
      }
      return
    }
    case 'platform':
      can(permission.action, permission.resource)
  }
}

function emptyAbility(): W08Ability {
  return new AbilityBuilder<W08Ability>(createMongoAbility).build()
}

/**
 * Build a CASL ability from the canonical permission catalog and an already
 * resolved server-side authorization context.
 *
 * This function evaluates permissions; it does not authenticate a user,
 * resolve roles/layers, persist grants, or replace the owning domain's
 * account-state, entitlement, workflow, ownership, or business-state checks.
 * Unknown permission names are ignored (fail closed).
 */
export function createW08Ability(context: W08AuthorizationContext): W08Ability {
  if (!isContext(context)) return emptyAbility()

  const rank = LAYER_RANK[context.layer]
  const isAnonymous = context.accountState === 'anonymous'

  // Identity/layer mismatches indicate an invalid or incomplete trusted context.
  if (
    (isAnonymous && (context.subjectId !== null || context.layer !== 'L0')) ||
    (!isAnonymous && (context.subjectId === null || context.layer === 'L0'))
  ) {
    return emptyAbility()
  }

  const { can, cannot, build } = new AbilityBuilder<W08Ability>(createMongoAbility)
  const canReadPublicOnly = context.accountState === 'restricted' || context.accountState === 'frozen'

  // Non-active states never receive ordinary mutation, private-read, or
  // administration rules. Suspended/deleted/banned accounts receive none.
  if (!['active', 'restricted', 'frozen', 'anonymous'].includes(context.accountState)) {
    return build()
  }

  for (const permissionName of new Set(context.effectivePermissions)) {
    const permission = PERMISSION_BY_NAME.get(permissionName)
    if (!permission) continue
    if (rank < LAYER_RANK[permission.minLayer]) continue

    const publicRead = permission.scope === 'public' && permission.action === 'read'
    if (canReadPublicOnly && !publicRead) continue

    // L5-L8 operational authority requires verified MFA. Without it, the
    // principal may still use explicit public-read permissions, but no
    // protected or administrative permission is materialized.
    if (rank >= LAYER_RANK.L5 && !context.mfaVerified && !publicRead) continue

    // L0 is strictly public/anonymous: a mistakenly supplied grant cannot
    // make an anonymous request perform a write or platform operation.
    if (isAnonymous && (
      permission.scope !== 'public' ||
      !['read', 'resolve'].includes(permission.action)
    )) {
      continue
    }

    addGrant(can, permission, context)
  }

  // CASL gives the last matching rule precedence. Register all explicit DENY
  // rules after grants so a DENY can never be overridden by an ALLOW.
  for (const permissionName of new Set(context.deniedPermissions ?? [])) {
    const permission = PERMISSION_BY_NAME.get(permissionName)
    if (permission) cannot(permission.action, permission.resource)
  }

  return build()
}
