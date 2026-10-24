import layers from '../../../../contracts/authz/layers.json'
import { activateEmailVerifiedAccount } from '../account/account-state-transition.js'
import { ensureVerifiedUserRole, resolveGlobalLayer, type LayerResolution, type ResolvedRoleAssignment } from '../authz/role-assignment.js'
import { requireMfaForPrivilegedAction } from './privileged-mfa-gate.js'
import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'

type AuthSession = {
  user: {
    id: string
    email: string
    emailVerified?: boolean
    accountState?: string | null
    accountStateVersion?: number | null
  }
  session: {
    id: string
    expiresAt: Date
    createdAt?: Date | string
  }
}

export type AuthenticatedPrincipal = {
  userId: string
  email: string
  sessionId: string
  accountState: string
  accountStateVersion: number
  layer: string
  roleAssignments: ResolvedRoleAssignment[]
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const roleLayerById = new Map<string, number>()
for (const layer of layers['x-layers']) {
  for (const role of layer.roles ?? []) roleLayerById.set(role, Number(layer.id.slice(1)))
}

export async function resolveBetterAuthPrincipal(
  env: BetterAuthEnv,
  request: Request,
  now = new Date().toISOString(),
): Promise<AuthenticatedPrincipal | null> {
  const db = env.D1_01
  const auth = createLuckReadAuth(env)

  const result = await auth.api.getSession({
    headers: request.headers,
    query: {},
  }) as AuthSession | null

  if (!result?.user?.id || !result.session?.id) return null

  const expiresAt = toIso(result.session.expiresAt)
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(now)) {
    return null
  }

  let accountState = typeof result.user.accountState === 'string'
    ? result.user.accountState
    : 'PENDING_VERIFICATION'

  let accountStateVersion = typeof result.user.accountStateVersion === 'number'
    ? result.user.accountStateVersion
    : 1

  // Better Auth's verified-email claim is the only proof accepted for this
  // idempotent recovery path. It repairs a callback interrupted after token
  // verification without allowing unverified sessions to obtain L2.
  if (result.user.emailVerified === true) {
    const activation = await activateEmailVerifiedAccount(db, String(result.user.id), now)
    accountState = activation.accountState
    accountStateVersion = activation.accountStateVersion
    if (accountState === 'ACTIVE') {
      await ensureVerifiedUserRole(db, String(result.user.id), now)
    }
  }

  const layerResolution: LayerResolution = await resolveGlobalLayer(
    db,
    String(result.user.id),
    accountState,
    now,
    true,
  )

  if (layerResolution.decision !== 'ALLOW' || !layerResolution.layer) return null

  let effectiveLayer = layerResolution.layer
  let effectiveAssignments = layerResolution.roleAssignments ?? []

  // L5-L8 are unavailable until the current Better Auth session proves that
  // TOTP was enabled and verified before that session was created. MFA is a
  // gate over the authoritative role rows; it never writes or deletes roles.
  if (Number(effectiveLayer.slice(1)) >= 5) {
    const mfaVerified = await requireMfaForPrivilegedAction(
      db,
      String(result.user.id),
      result.session.createdAt,
    )
    if (!mfaVerified) {
      effectiveAssignments = effectiveAssignments.filter((assignment) => {
        const roleLayer = roleLayerById.get(assignment.roleId)
        return typeof roleLayer === 'number' && roleLayer < 5
      })
      const eligibleGlobalLayers = effectiveAssignments
        .filter((assignment) => assignment.scopeType === 'global')
        .map((assignment) => roleLayerById.get(assignment.roleId))
        .filter((layer): layer is number => typeof layer === 'number' && layer < 5)

      // Do not synthesize a fallback layer when no lower global RoleAssignment
      // exists; fail closed. Normal registered users retain their L1/L2 roles.
      if (eligibleGlobalLayers.length === 0) return null
      effectiveLayer = ('L' + Math.max(...eligibleGlobalLayers)) as typeof effectiveLayer
    }
  }

  return {
    userId: String(result.user.id),
    email: String(result.user.email),
    sessionId: String(result.session.id),
    accountState,
    accountStateVersion,
    layer: effectiveLayer,
    roleAssignments: effectiveAssignments,
  }
}
