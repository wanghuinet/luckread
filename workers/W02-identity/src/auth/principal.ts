import { createLuckReadAuth } from './better-auth.js'
import { resolveGlobalLayer, type LayerResolution } from '../authz/role-assignment.js'

type AuthSession = {
  user: {
    id: string
    email: string
    username?: string | null
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
  username?: string
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

  let result: AuthSession | null
  try {
    result = await auth.api.getSession({
      headers: request.headers,
      query: {},
    }) as AuthSession | null
  } catch {
    return null
  }

  if (!result?.user?.id || !result.session?.id) return null

  const expiresAt = toIso(result.session.expiresAt)
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(now)) {
    return null
  }

  const accountState = typeof result.user.accountState === 'string'
    ? result.user.accountState
    : 'PENDING_VERIFICATION'

  const accountStateVersion = typeof result.user.accountStateVersion === 'number'
    ? result.user.accountStateVersion
    : 1

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
    username: typeof result.user.username === 'string' ? result.user.username : undefined,
    sessionId: String(result.session.id),
    accountState,
    accountStateVersion,
    layer: layerResolution.layer,
  }
}
