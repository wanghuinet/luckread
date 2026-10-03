import type { PayloadRequest } from 'payload'

import { readVerifiedPayloadTokenVersion } from '@/auth/payload-access-token'
import { resolveAuthenticatedPrincipal } from '@/auth/w02-session-client'

type PayloadAdminUser = {
  id?: string | number
  _sid?: string
} | null

export const payloadAdminOnly = async ({ req }: { req: PayloadRequest }): Promise<boolean> => {
  try {
    const user = req.user as unknown as PayloadAdminUser
    if (!user?.id || typeof user._sid !== 'string' || user._sid.length === 0) return false

    const request = new Request('https://luckread-w01.internal/admin', {
      headers: req.headers,
    })
    const tokenVersion = readVerifiedPayloadTokenVersion(request)
    if (tokenVersion === null) return false

    const principal = await resolveAuthenticatedPrincipal({
      sessionId: user._sid,
      userId: String(user.id),
      tokenVersion,
    })

    return principal.active === true && (principal.layer === 'L7' || principal.layer === 'L8')
  } catch {
    return false
  }
}
