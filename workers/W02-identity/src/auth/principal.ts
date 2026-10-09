import { activateEmailVerifiedAccount } from '../account/account-state-transition.js'
import { createLuckReadAuth } from './better-auth.js'
import { resolveGlobalLayer, type LayerResolution } from '../authz/role-assignment.js'

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
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export async function resolveBetterAuthPrincipal(
  db: D1Database,
  request: Request,
  now = new Date().toISOString(),
): Promise<AuthenticatedPrincipal | null> {
  const auth = createLuckReadAuth({ D1_01: db })

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

  // Better Auth is the proof authority: only its verified-email claim can
  // trigger this idempotent W02 repair/activation path. The role is committed
  // with the ACTIVE transition before global layer resolution runs.
  if (result.user.emailVerified === true) {
    const activation = await activateEmailVerifiedAccount(db, String(result.user.id), now)
    accountState = activation.accountState
    accountStateVersion = activation.accountStateVersion
  }

  const layerResolution: LayerResolution = await resolveGlobalLayer(
    db,
    String(result.user.id),
    accountState,
    now,
  )

  if (layerResolution.decision !== 'ALLOW' || !layerResolution.layer) return null

  return {
    userId: String(result.user.id),
    email: String(result.user.email),
    sessionId: String(result.session.id),
    accountState,
    accountStateVersion,
    layer: layerResolution.layer,
  }
}
