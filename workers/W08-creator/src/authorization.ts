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

type InternalW08Ability = MongoAbility<[string, string | ForcedSubject<string>]>

/** Public surface intentionally exposes only the guarded authorization check. */
export type W08Ability = Pick<InternalW08Ability, 'can'>

type PermissionScope = 'platform' | 'organization' | 'ip' | 'own' | 'public'
type AssignmentScopeType = 'global' | 'organization' | 'ip'
type ScopedGrant = {
  permissionName: string
  scopeType: 'organization' | 'ip'
  scopeId: string
  assignmentLayer: PermissionLayer
}
export type W08RoleAssignment = {
  roleId: string
  scopeType: AssignmentScopeType
  scopeId: string | null
}
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
 * Trusted attestation produced by the approved L8/Break-Glass grant workflow.
 * It is not a client request object. The server adapter must verify the
 * approval authority and durable audit record before passing this evidence.
 */
export type W08PrivilegedApprovalEvidence = {
  approvalId: string
  permissionName: string
  actorId: string
  targetResourceType: string
  targetResourceId: string
  reason: string
  approverIds: readonly string[]
  issuedAt: string
  expiresAt: string
  auditEventId: string
  auditRecorded: true
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
  privilegedApprovals?: readonly W08PrivilegedApprovalEvidence[]
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

function isPrivilegedApprovalEvidence(value: unknown): value is W08PrivilegedApprovalEvidence {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<W08PrivilegedApprovalEvidence>
  return typeof candidate.approvalId === 'string' && candidate.approvalId.length > 0 && candidate.approvalId.length <= 128 &&
    typeof candidate.permissionName === 'string' && candidate.permissionName.length > 0 && candidate.permissionName.length <= 128 &&
    typeof candidate.actorId === 'string' && candidate.actorId.length > 0 && candidate.actorId.length <= 128 &&
    typeof candidate.targetResourceType === 'string' && candidate.targetResourceType.length > 0 && candidate.targetResourceType.length <= 128 &&
    typeof candidate.targetResourceId === 'string' && candidate.targetResourceId.length > 0 && candidate.targetResourceId.length <= 256 &&
    typeof candidate.reason === 'string' && candidate.reason.trim().length > 0 && candidate.reason.length <= 1024 &&
    isStringList(candidate.approverIds) && candidate.approverIds.length <= 10 &&
    typeof candidate.issuedAt === 'string' && Number.isFinite(Date.parse(candidate.issuedAt)) &&
    typeof candidate.expiresAt === 'string' && Number.isFinite(Date.parse(candidate.expiresAt)) &&
    typeof candidate.auditEventId === 'string' && candidate.auditEventId.length > 0 && candidate.auditEventId.length <= 256 &&
    candidate.auditRecorded === true
}

function isPrivilegedApprovalList(value: unknown, optional = false): value is readonly W08PrivilegedApprovalEvidence[] | undefined {
  if (value === undefined && optional) return true
  return Array.isArray(value) &&
    value.length <= 20 &&
    value.every(isPrivilegedApprovalEvidence)
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
    !isStringList(candidate.ipIds, true) ||
    !isPrivilegedApprovalList(candidate.privilegedApprovals, true)
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

const ASSIGNMENT_SCOPE_TYPES = new Set<AssignmentScopeType>(['global', 'organization', 'ip'])

const rolePermissionContract = (permissionCatalog as unknown as {
  'x-role-permissions'?: RolePermissionContract
})['x-role-permissions']

const rolePermissionDefinitions = Array.isArray(rolePermissionContract?.roles)
  ? rolePermissionContract.roles.filter((value): value is {
      role: string
      permissions: string[]
      scopeType: AssignmentScopeType
    } => {
      if (value === null || typeof value !== 'object') return false
      const candidate = value as { role?: unknown; permissions?: unknown; scopeType?: unknown }
      return typeof candidate.role === 'string' &&
        Array.isArray(candidate.permissions) &&
        candidate.permissions.every((name) => typeof name === 'string') &&
        typeof candidate.scopeType === 'string' &&
        ASSIGNMENT_SCOPE_TYPES.has(candidate.scopeType as AssignmentScopeType)
    })
  : []

const rolePermissionMap = new Map(
  rolePermissionDefinitions.map((definition) => [definition.role, definition.permissions]),
)

const roleAssignmentScopeMap = new Map(
  rolePermissionDefinitions.map((definition) => [definition.role, definition.scopeType]),
)

const canonicalRoleIds = new Set(
  layers['x-layers'].flatMap((layer) => layer.roles ?? []),
)

const rolePermissionContractIsComplete =
  rolePermissionContract?.status === 'PARTIAL_IMPLEMENTED_PERMISSION_CATALOG' &&
  rolePermissionMap.size === canonicalRoleIds.size &&
  [...canonicalRoleIds].every((role) => rolePermissionMap.has(role) && roleAssignmentScopeMap.has(role)) &&
  rolePermissionDefinitions.every((definition) =>
    canonicalRoleIds.has(definition.role) &&
    definition.permissions.every((name) => {
      const permission = PERMISSION_BY_NAME.get(name)
      if (!permission) return false
      if (definition.scopeType === 'global') {
        return permission.scope !== 'organization' && permission.scope !== 'ip'
      }
      return permission.scope === definition.scopeType
    }),
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
  privilegedApproval?: W08PrivilegedApprovalEvidence,
  scopedGrant?: ScopedGrant,
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
      if (scopedGrant) {
        if (scopedGrant.scopeType !== 'organization' || permission.name !== scopedGrant.permissionName) return
        const conditions = permission.resource === 'organization' || permission.resource === 'org'
          ? { id: scopedGrant.scopeId }
          : { organizationId: scopedGrant.scopeId }
        can(permission.action, permission.resource, conditions)
        return
      }
      const organizationIds = cleanScopeIds(context.organizationIds)
      if (organizationIds.length === 0) return
      const conditions = permission.resource === 'organization' || permission.resource === 'org'
        ? { id: { $in: organizationIds } }
        : { organizationId: { $in: organizationIds } }
      can(permission.action, permission.resource, conditions)
      return
    }
    case 'ip': {
      if (scopedGrant) {
        if (scopedGrant.scopeType !== 'ip' || permission.name !== scopedGrant.permissionName) return
        const conditions = permission.resource === 'ip'
          ? { id: scopedGrant.scopeId }
          : { ipId: scopedGrant.scopeId }
        can(permission.action, permission.resource, conditions)
        return
      }
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
      if (permission.minLayer === 'L8') {
        if (!privilegedApproval) return
        // L8/Break-Glass permission is bound to the approved target, never
        // materialized as an unbounded platform-wide capability.
        can(permission.action, permission.resource, { id: privilegedApproval.targetResourceId })
      } else {
        can(permission.action, permission.resource)
      }
  }
}


const MAX_L8_APPROVAL_LIFETIME_MS = 4 * 60 * 60 * 1000

function validPrivilegedApprovalFor(
  context: W08AuthorizationContext,
  permission: PermissionDefinition,
  now = Date.now(),
): W08PrivilegedApprovalEvidence | null {
  if (permission.minLayer !== 'L8' || !context.subjectId || context.layer !== 'L8' || !context.mfaVerified) {
    return null
  }

  for (const evidence of context.privilegedApprovals ?? []) {
    const issuedAt = Date.parse(evidence.issuedAt)
    const expiresAt = Date.parse(evidence.expiresAt)
    const approvers = new Set(evidence.approverIds)

    if (
      evidence.permissionName !== permission.name ||
      evidence.actorId !== context.subjectId ||
      evidence.targetResourceType !== permission.resource ||
      evidence.targetResourceId.length === 0 ||
      evidence.reason.trim().length === 0 ||
      evidence.auditRecorded !== true ||
      evidence.auditEventId.length === 0 ||
      evidence.approverIds.length < 2 ||
      approvers.size < 2 ||
      approvers.has(context.subjectId) ||
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      issuedAt > now ||
      now >= expiresAt ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > MAX_L8_APPROVAL_LIFETIME_MS
    ) {
      continue
    }

    return evidence
  }

  return null
}

/**
 * CASL's type-only checks cannot establish resource-specific conditions. Keep
 * the consumer API deliberately narrow and fail closed whenever a conditional
 * rule is being checked with only a subject type string.
 */
function guardTypeOnlyChecks(ability: InternalW08Ability): W08Ability {
  const can = ((
    action: string,
    target: string | ForcedSubject<string>,
    field?: string,
  ) => {
    if (typeof target === 'string') {
      const rules = ability.rulesFor(action, target) as unknown as Array<{ conditions?: unknown }>
      if (rules.some((rule) => rule.conditions !== undefined)) return false
    }

    return ability.can(action, target, field)
  }) as InternalW08Ability['can']

  return { can }
}

function emptyAbility(): W08Ability {
  return guardTypeOnlyChecks(new AbilityBuilder<InternalW08Ability>(createMongoAbility).build())
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
  scopedGrants?: readonly ScopedGrant[],
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

  const { can, cannot, build } = new AbilityBuilder<InternalW08Ability>(createMongoAbility)
  const canReadPublicOnly = context.accountState === 'restricted' || context.accountState === 'frozen'

  // Non-active states never receive ordinary mutation, private-read, or
  // administration rules. Suspended/deleted/banned accounts receive none.
  if (!['active', 'restricted', 'frozen', 'anonymous'].includes(context.accountState)) {
    return guardTypeOnlyChecks(build())
  }

  const evaluatedPermissionNames = new Set(context.effectivePermissions)
  for (const scopedGrant of scopedGrants ?? []) evaluatedPermissionNames.add(scopedGrant.permissionName)

  for (const permissionName of evaluatedPermissionNames) {
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

    const privilegedApproval = permission.minLayer === 'L8'
      ? validPrivilegedApprovalFor(context, permission)
      : undefined
    if (permission.minLayer === 'L8' && !privilegedApproval) continue

    addGrant(can, permission, context, privilegedApproval ?? undefined)
  }

  // CASL gives the last matching rule precedence. Register all explicit DENY
  // rules after grants so a DENY can never be overridden by an ALLOW.
  for (const permissionName of new Set(context.deniedPermissions ?? [])) {
    const permission = PERMISSION_BY_NAME.get(permissionName)
    if (permission) cannot(permission.action, permission.resource)
  }

  return guardTypeOnlyChecks(build())
}

export type W08RoleAuthorizationContext = Omit<
  W08AuthorizationContext,
  'effectivePermissions' | 'organizationIds' | 'ipIds'
> & {
  /**
   * Complete, server-resolved, currently effective W02 RoleAssignment tuples.
   * Never populate these from request fields or token claims.
   */
  roleAssignments: readonly W08RoleAssignment[]
}

/**
 * Preferred server-side entrypoint. Each assignment is validated against the
 * canonical role-to-scope contract. Global assignments determine the global
 * layer and global grants; organization/IP assignments produce separate rules
 * bound to their own exact scope ID. Scope IDs are never unioned across roles.
 */
export function createW08AbilityForRoles(context: W08RoleAuthorizationContext): W08Ability {
  if (
    context === null ||
    typeof context !== 'object' ||
    !Array.isArray(context.roleAssignments) ||
    context.roleAssignments.length > 500
  ) {
    return emptyAbility()
  }

  const roleLayerById = new Map<string, PermissionLayer>()
  for (const layer of layers['x-layers']) {
    for (const role of layer.roles ?? []) roleLayerById.set(role, layer.id as PermissionLayer)
  }

  const normalized: Array<{ assignment: W08RoleAssignment; layer: PermissionLayer }> = []
  const seen = new Set<string>()

  for (const value of context.roleAssignments as readonly unknown[]) {
    if (value === null || typeof value !== 'object') return emptyAbility()
    const assignment = value as Partial<W08RoleAssignment>
    if (
      typeof assignment.roleId !== 'string' ||
      assignment.roleId.length === 0 ||
      assignment.roleId.length > 128 ||
      typeof assignment.scopeType !== 'string' ||
      !ASSIGNMENT_SCOPE_TYPES.has(assignment.scopeType as AssignmentScopeType) ||
      !(assignment.scopeId === null ||
        (typeof assignment.scopeId === 'string' &&
          assignment.scopeId.length > 0 &&
          assignment.scopeId.length <= 256))
    ) {
      return emptyAbility()
    }

    const roleId = assignment.roleId
    const scopeType = assignment.scopeType as AssignmentScopeType
    const scopeId = assignment.scopeId as string | null
    const expectedScope = roleAssignmentScopeMap.get(roleId)
    const layer = roleLayerById.get(roleId)

    if (!expectedScope || !layer || expectedScope !== scopeType) return emptyAbility()
    if ((scopeType === 'global' && scopeId !== null) ||
        (scopeType !== 'global' && scopeId === null)) return emptyAbility()

    const key = JSON.stringify([roleId, scopeType, scopeId])
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({ assignment: { roleId, scopeType, scopeId }, layer })
  }

  const globalAssignments = normalized.filter(({ assignment }) => assignment.scopeType === 'global')
  const scopedAssignments = normalized.filter(({ assignment }) => assignment.scopeType !== 'global')

  if (context.accountState === 'anonymous') {
    if (context.subjectId !== null || context.layer !== 'L0' || normalized.length > 0) return emptyAbility()
    const anonymousPermissions = resolveCatalogPermissionsForRoles([])
    if (!anonymousPermissions) return emptyAbility()
    return buildW08Ability({
      subjectId: null,
      layer: 'L0',
      accountState: 'anonymous',
      mfaVerified: context.mfaVerified,
      effectivePermissions: anonymousPermissions,
      deniedPermissions: context.deniedPermissions,
      privilegedApprovals: context.privilegedApprovals,
      organizationIds: [],
      ipIds: [],
    }, false, [])
  }

  if (
    !context.subjectId ||
    !isLayer(context.layer) ||
    globalAssignments.length === 0 ||
    !['active', 'restricted', 'frozen', 'suspended', 'pending_deletion', 'deleted', 'banned'].includes(context.accountState)
  ) {
    return emptyAbility()
  }

  const expectedLayer = globalAssignments.reduce((current, next) =>
    LAYER_RANK[next.layer] > LAYER_RANK[current] ? next.layer : current,
    globalAssignments[0].layer,
  )
  if (context.layer !== expectedLayer) return emptyAbility()

  const globalRoleIds = globalAssignments.map(({ assignment }) => assignment.roleId)
  const effectivePermissions = resolveCatalogPermissionsForRoles(globalRoleIds)
  if (!effectivePermissions) return emptyAbility()

  const scopedGrants: ScopedGrant[] = []
  for (const { assignment, layer } of scopedAssignments) {
    const permissionNames = rolePermissionMap.get(assignment.roleId)
    if (!permissionNames || assignment.scopeId === null) return emptyAbility()
    for (const permissionName of permissionNames) {
      const permission = PERMISSION_BY_NAME.get(permissionName)
      if (!permission) return emptyAbility()
      if (permission.scope !== assignment.scopeType) return emptyAbility()
      if (LAYER_RANK[layer] < LAYER_RANK[permission.minLayer]) continue
      scopedGrants.push({
        permissionName,
        scopeType: assignment.scopeType as 'organization' | 'ip',
        scopeId: assignment.scopeId,
        assignmentLayer: layer,
      })
    }
  }

  return buildW08Ability({
    subjectId: context.subjectId,
    layer: context.layer,
    accountState: context.accountState,
    mfaVerified: context.mfaVerified,
    effectivePermissions,
    deniedPermissions: context.deniedPermissions,
    privilegedApprovals: context.privilegedApprovals,
    organizationIds: [],
    ipIds: [],
  }, false, scopedGrants)
}

/**
 * Entry point for callers that already possess a trusted, canonical
 * effective-permission set. Prefer createW08AbilityForRoles when W02 role IDs
 * are available, so grant composition remains tied to the permission catalog.
 */
export function createW08Ability(context: W08AuthorizationContext): W08Ability {
  return buildW08Ability(context, true)
}

