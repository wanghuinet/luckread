import { createLuckReadAuth } from '../auth/better-auth.js'
import { reconcileOrphanedSessionExtensions } from '../session/session-runtime.js'

export class PasswordChangeServiceError extends Error {
  constructor(
    readonly status: 400 | 401 | 503,
    readonly code: 'VALIDATION_FAILED' | 'UNAUTHENTICATED' | 'SERVICE_UNAVAILABLE',
    message: string,
  ) {
    super(message)
  }
}

type PasswordChangeInput = {
  currentPassword: unknown
  newPassword: unknown
}

type SessionSnapshot = {
  userId: string
  sessionId: string
}

const passwordLengthValid = (value: unknown): value is string => {
  if (typeof value !== 'string') return false
  const length = Array.from(value).length
  return length >= 15 && length <= 128
}

const readSessionSnapshot = async (
  auth: ReturnType<typeof createLuckReadAuth>,
  request: Request,
): Promise<SessionSnapshot> => {
  try {
    const result = await auth.api.getSession({
      headers: request.headers,
      query: {},
    }) as {
      user?: { id?: unknown }
      session?: { id?: unknown }
    } | null

    if (
      typeof result?.user?.id !== 'string' ||
      result.user.id.length === 0 ||
      typeof result.session?.id !== 'string' ||
      result.session.id.length === 0
    ) {
      throw new PasswordChangeServiceError(
        401,
        'UNAUTHENTICATED',
        'authentication required',
      )
    }

    return {
      userId: result.user.id,
      sessionId: result.session.id,
    }
  } catch (error) {
    if (error instanceof PasswordChangeServiceError) throw error
    throw new PasswordChangeServiceError(
      503,
      'SERVICE_UNAVAILABLE',
      'authentication service unavailable',
    )
  }
}

const statusFromBetterAuthError = (error: unknown): 401 | 503 => {
  if (!error || typeof error !== 'object') return 503

  const candidate = error as {
    statusCode?: unknown
    body?: { code?: unknown }
    message?: unknown
  }

  if (
    candidate.statusCode === 401 ||
    candidate.body?.code === 'INVALID_PASSWORD' ||
    (typeof candidate.message === 'string' && /invalid password|incorrect password/i.test(candidate.message))
  ) {
    return 401
  }

  return 503
}

export async function changePasswordWithBetterAuth(
  db: D1Database,
  request: Request,
  betterAuthSecret: string,
  input: PasswordChangeInput,
): Promise<void> {
  if (!passwordLengthValid(input.currentPassword) || !passwordLengthValid(input.newPassword)) {
    throw new PasswordChangeServiceError(
      400,
      'VALIDATION_FAILED',
      'Invalid password change request',
    )
  }

  if (input.currentPassword === input.newPassword) {
    throw new PasswordChangeServiceError(
      400,
      'VALIDATION_FAILED',
      'New password must differ from current password',
    )
  }

  const auth = createLuckReadAuth({
    D1_01: db,
    BETTER_AUTH_SECRET: betterAuthSecret,
  })
  const session = await readSessionSnapshot(auth, request)

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
      headers: request.headers,
    })
  } catch (error) {
    const status = statusFromBetterAuthError(error)
    if (status === 401) {
      throw new PasswordChangeServiceError(
        401,
        'UNAUTHENTICATED',
        'Current password is invalid',
      )
    }
    throw new PasswordChangeServiceError(
      503,
      'SERVICE_UNAVAILABLE',
      'Password change service unavailable',
    )
  }

  try {
    await reconcileOrphanedSessionExtensions(
      db,
      session.userId,
      session.sessionId,
      new Date().toISOString(),
    )
  } catch (error) {
    // Better Auth has already completed the password mutation. Native sessions
    // that it revoked can no longer authenticate because principal resolution
    // requires the corresponding native session row. Treat extension cleanup
    // as best-effort so a successful password change is never reported as a
    // failed credential operation.
    console.error(JSON.stringify({
      event: 'auth.password_change.session_extension_reconciliation_failure',
      diagnosticCode: 'AUTH004_SESSION_EXTENSION_RECONCILIATION_FAILURE',
      errorName: error instanceof Error ? error.name : typeof error,
    }))
  }
}
