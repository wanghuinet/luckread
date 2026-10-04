import type { PayloadRequest } from 'payload'

import { getBetterAuthSession } from '@/auth/better-auth'
import { resolveGlobalLayer } from '@/auth/w02-session-client'

export const payloadAdminOnly = async ({ req }: { req: PayloadRequest }): Promise<boolean> => {
  try {
    const session = await getBetterAuthSession(
      new Request('https://luckread-w01.internal/admin', { headers: req.headers }),
    )
    if (!session?.user?.id) return false

    const accountState = typeof session.user.accountState === 'string'
      ? session.user.accountState
      : 'ACTIVE'
    if (accountState !== 'PENDING_VERIFICATION' && accountState !== 'ACTIVE') return false

    const principal = await resolveGlobalLayer({
      subjectId: String(session.user.id),
      accountState,
    })

    return principal.decision === 'ALLOW' && (principal.layer === 'L7' || principal.layer === 'L8')
  } catch {
    return false
  }
}
