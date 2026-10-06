import type { PayloadRequest } from 'payload'

import { getBetterAuthPrincipal } from '@/auth/w02-session-client'

export const payloadAdminOnly = async ({ req }: { req: PayloadRequest }): Promise<boolean> => {
  try {
    const principal = await getBetterAuthPrincipal(new Request('https://luckread-w01.internal/admin', {
      headers: req.headers,
    }))
    return principal.active === true && (principal.layer === 'L7' || principal.layer === 'L8')
  } catch {
    return false
  }
}
