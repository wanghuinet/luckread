import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import {
  createD1PrincipalAuthorityStore,
  type PrincipalAuthorityStore,
} from './principal-store.js'
import type { ResolvedRoleAssignment } from '../authz/role-assignment.js'

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

export type PrincipalResolverDependencies = {
  /** Provider injection is for controlled PostgreSQL rehearsal/admission only. */
  store?: PrincipalAuthorityStore
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

/**
 * Resolve the authenticated Better Auth session and then reconcile the
 * authoritative W02 account lifecycle and effective authorization facts.
 *
 * D1-01 remains the production default. A provider-matched store can be
 * injected by the isolated PostgreSQL runtime rehearsal without changing
 * the deployed Worker binding or Better Auth session authority.
 */
export async function resolveBetterAuthPrincipal(
  env: BetterAuthEnv,
  request: Request,
  now = new Date().toISOString(),
  dependencies: PrincipalResolverDependencies = {},
): Promise<AuthenticatedPrincipal | null> {
  const store = dependencies.store ?? createD1PrincipalAuthorityStore(env.D1_01)
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
    const activation = await store.activateEmailVerifiedAccount(String(result.user.id), now)
    accountState = activation.accountState
    accountStateVersion = activation.accountStateVersion
    if (accountState === 'ACTIVE') {
      await store.ensureVerifiedUserRole(String(result.user.id), now)
    }
  }

  const layerResolution = await store.resolveGlobalLayer(
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
