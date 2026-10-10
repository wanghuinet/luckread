import type { BetterAuthEnv, RateLimitBinding } from './better-auth.js'

export class SessionRateLimitError extends Error {
  constructor(readonly reason: 'limited' | 'unavailable') {
    super(reason === 'limited' ? 'SESSION_RATE_LIMITED' : 'SESSION_RATE_LIMIT_UNAVAILABLE')
  }
}

async function checkLimit(binding: RateLimitBinding | undefined, key: string): Promise<void> {
  if (!binding) throw new SessionRateLimitError('unavailable')

  let result: { success: boolean }
  try {
    result = await binding.limit({ key })
  } catch {
    throw new SessionRateLimitError('unavailable')
  }

  if (!result || typeof result.success !== 'boolean') {
    throw new SessionRateLimitError('unavailable')
  }
  if (!result.success) throw new SessionRateLimitError('limited')
}

/** Apply account and endpoint limits after W02 authenticates the current user. */
export async function enforceSessionListRateLimits(env: BetterAuthEnv, userId: string): Promise<void> {
  await checkLimit(env.AUTH_SESSION_READ_LIMITER, 'auth010:session-list:account:' + userId)
  await checkLimit(env.AUTH_SESSION_READ_LIMITER, 'auth010:session-list:endpoint')
}

/** Apply account, target-session, and endpoint limits before reading a target row. */
export async function enforceSessionRevokeRateLimits(
  env: BetterAuthEnv,
  userId: string,
  targetSessionId: string,
): Promise<void> {
  await checkLimit(env.AUTH_SESSION_WRITE_LIMITER, 'auth010:session-revoke:account:' + userId)
  await checkLimit(env.AUTH_SESSION_WRITE_LIMITER, 'auth010:session-revoke:session:' + targetSessionId)
  await checkLimit(env.AUTH_SESSION_WRITE_LIMITER, 'auth010:session-revoke:endpoint')
}

export function sessionRateLimitErrorResponse(error: unknown): Response {
  if (error instanceof SessionRateLimitError && error.reason === 'limited') {
    return Response.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          details: { retryAfter: 60 },
        },
      },
      { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } },
    )
  }

  return Response.json(
    { error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  )
}
