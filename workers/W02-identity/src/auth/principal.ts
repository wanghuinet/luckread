import { activateEmailVerifiedAccount } from '../account/account-state-transition.js'
import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import { ensureVerifiedUserRole, resolveGlobalLayer, type LayerResolution, type ResolvedRoleAssignment } from '../authz/role-assignment.js'

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

  return {
    userId: String(result.user.id),
    email: String(result.user.email),
    sessionId: String(result.session.id),
    accountState,
    accountStateVersion,
    layer: layerResolution.layer,
    roleAssignments: layerResolution.roleAssignments ?? [],
  }
}
