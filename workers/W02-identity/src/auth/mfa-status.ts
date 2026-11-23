import { resolveBetterAuthPrincipal } from './principal.js'
import type { AuthenticatedPrincipal } from './principal.js'
import type { BetterAuthEnv } from './better-auth.js'

export type AuthoritativeMfaStatus = {
  enabled: boolean
  verified: boolean
  enrolledAt: string | null
}

export interface MfaStatusStore {
  read(userId: string, now: Date): Promise<AuthoritativeMfaStatus | null>
}

export type MfaStatusHandlerDependencies = {
  store?: MfaStatusStore
  resolvePrincipal?: (
    env: BetterAuthEnv,
    request: Request,
  ) => Promise<Pick<AuthenticatedPrincipal, 'userId' | 'accountState'> | null>
}

const response = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/**
 * Private W02 handler for a W01-originated status read.
 * Identity is derived from the real Better Auth session; no user ID is accepted
 * from the request body or query string.
 */
export async function handleMfaStatusRequest(
  env: BetterAuthEnv,
  request: Request,
  dependencies: MfaStatusHandlerDependencies = {},
): Promise<Response> {
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
  ) {
    return response({ error: { code: 'FORBIDDEN', message: 'authorized W01 service boundary required' } }, 403)
  }

  try {
    const resolvePrincipal = dependencies.resolvePrincipal ?? resolveBetterAuthPrincipal
    const principal = await resolvePrincipal(env, request)
    if (!principal || principal.accountState !== 'ACTIVE') {
      return response({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
    }
    const store = dependencies.store
    if (!store) throw new Error('W02_MFA_STATUS_POSTGRES_STORE_REQUIRED')
    const status = await store.read(principal.userId, new Date())
    if (!status) return response({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
    return response({ data: status })
  } catch {
    // AUTH-007 schema is still gated; a missing table or failed read is a
    // closed service failure, never an inferred "MFA disabled" response.
    return response({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA status unavailable' } }, 503)
  }
}
