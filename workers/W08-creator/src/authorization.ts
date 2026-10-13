import { AbilityBuilder, createMongoAbility, type ForcedSubject, type MongoAbility } from '@casl/ability'
import permissionCatalog from '../../../contracts/authz/permissions.json'
import layers from '../../../contracts/authz/layers.json'

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

type RolePermissionContract = {
  status?: string
  publicDefaults?: unknown
  roles?: unknown
}

const rolePermissionContract = (permissionCatalog as unknown as {
  'x-role-permissions'?: RolePermissionContract
})['x-role-permissions']

const rolePermissionDefinitions = Array.isArray(rolePermissionContract?.roles)
  ? rolePermissionContract.roles.filter((value): value is { role: string; permissions: string[] } => {
      if (value === null || typeof value !== 'object') return false
      const candidate = value as { role?: unknown; permissions?: unknown }
      return typeof candidate.role === 'string' &&
        Array.isArray(candidate.permissions) &&
        candidate.permissions.every((name) => typeof name === 'string')
    })
  : []

const rolePermissionMap = new Map(
  rolePermissionDefinitions.map((definition) => [definition.role, definition.permissions]),
)

const canonicalRoleIds = new Set(
  layers['x-layers'].flatMap((layer) => layer.roles ?? []),
)

const rolePermissionContractIsComplete =
  rolePermissionContract?.status === 'PARTIAL_IMPLEMENTED_PERMISSION_CATALOG' &&
  rolePermissionMap.size === canonicalRoleIds.size &&
  [...canonicalRoleIds].every((role) => rolePermissionMap.has(role)) &&
  rolePermissionDefinitions.every((definition) =>
    canonicalRoleIds.has(definition.role) &&
    definition.permissions.every((name) => PERMISSION_BY_NAME.has(name)),
  ) &&
  Array.isArray(rolePermissionContract.publicDefaults) &&
  rolePermissionContract.publicDefaults.every((name) =>
    typeof name === 'string' && PERMISSION_BY_NAME.has(name),
  )

/**
 * Resolve a set of authoritative, currently effective RoleAssignment role IDs
 * into the explicit grants recorded in the canonical permission catalog.
 *
 * The caller must pass only active/time-valid assignments returned by W02's
 * authoritative resolver. This function does not read or persist role rows,
 * resolve identity, or accept client-provided role claims.
 *
 * null means the role vocabulary/catalog is inconsistent or includes an
 * unknown role; callers MUST fail closed rather than partially grant access.
 */
export function resolveCatalogPermissionsForRoles(
  roleIds: readonly string[],
): readonly string[] | null {
  if (
    !rolePermissionContractIsComplete ||
    !Array.isArray(roleIds) ||
    roleIds.length > 500 ||
    roleIds.some((role) => typeof role !== 'string' || role.length === 0 || role.length > 128)
  ) {
    return null
  }

  const permissions = new Set<string>(
    rolePermissionContract!.publicDefaults as string[],
  )

  const roleLayerById = new Map<string, PermissionLayer>()
  for (const layer of layers['x-layers']) {
    for (const role of layer.roles ?? []) roleLayerById.set(role, layer.id as PermissionLayer)
  }

  for (const roleId of new Set(roleIds)) {
    const rolePermissions = rolePermissionMap.get(roleId)
    const roleLayer = roleLayerById.get(roleId)
    if (!rolePermissions || !roleLayer) return null
    for (const permissionName of rolePermissions) {
      const permission = PERMISSION_BY_NAME.get(permissionName)
      if (!permission) return null
      // The permission must meet the layer of the actual role grant. This is
      // separate from the principal's global layer, because scoped role
      // assignments do not change the global authLogin/authRefresh layer.
      if (LAYER_RANK[roleLayer] >= LAYER_RANK[permission.minLayer]) {
        permissions.add(permissionName)
      }
    }
  }

  return [...permissions].sort()
}

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
function buildW08Ability(
  context: W08AuthorizationContext,
  enforceGlobalLayerMinimum: boolean,
): W08Ability {
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
    if (enforceGlobalLayerMinimum && rank < LAYER_RANK[permission.minLayer]) continue

    const publicRead = permission.scope === 'public' && ['read', 'resolve'].includes(permission.action)
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

export type W08RoleAuthorizationContext = Omit<W08AuthorizationContext, 'effectivePermissions'> & {
  effectiveRoles: readonly string[]
}

/**
 * Preferred server-side entrypoint when W02 has resolved active,
 * time-valid RoleAssignment identifiers.
 *
 * The policy catalog turns those trusted roles into explicit grants; CASL
 * still applies account-state, MFA, ownership, resource visibility, and
 * organization/IP scope rules. A scoped role may authorize only within the
 * server-resolved scope and must not rewrite the principal's global layer.
 */
export function createW08AbilityForRoles(context: W08RoleAuthorizationContext): W08Ability {
  if (
    context === null ||
    typeof context !== 'object' ||
    !isStringList(context.effectiveRoles)
  ) {
    return emptyAbility()
  }

  const effectivePermissions = resolveCatalogPermissionsForRoles(context.effectiveRoles)
  if (!effectivePermissions) return emptyAbility()

  const { effectiveRoles: _effectiveRoles, ...baseContext } = context
  return buildW08Ability({
    ...baseContext,
    effectivePermissions,
  }, false)
}

/**
 * Entry point for callers that already possess a trusted, canonical
 * effective-permission set. Prefer createW08AbilityForRoles when W02 role IDs
 * are available, so grant composition remains tied to the permission catalog.
 */
export function createW08Ability(context: W08AuthorizationContext): W08Ability {
  return buildW08Ability(context, true)
}

