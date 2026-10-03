import type { Access } from 'payload'

import { readVerifiedPayloadTokenVersion } from '@/auth/payload-access-token'
import { resolveAuthenticatedPrincipal } from '@/auth/w02-session-client'

type PayloadAdminUser = {
  id?: string | number
  _sid?: string
} | null

export const payloadAdminOnly: Access = async ({ req }) => {
  try {
    const user = req.user as unknown as PayloadAdminUser
    if (!user?.id || typeof user._sid !== 'string' || user._sid.length === 0) return false

    const tokenVersion = readVerifiedPayloadTokenVersion(req)
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
