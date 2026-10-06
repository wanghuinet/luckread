import type { PayloadRequest } from 'payload'

import { resolveBetterAuthPrincipal, W02AuthClientError } from '@/auth/w02-auth-client'

export const payloadAdminOnly = async ({ req }: { req: PayloadRequest }): Promise<boolean> => {
  try {
    const request = new Request('https://luckread-w01.internal/admin', {
      headers: req.headers,
    })
    const principal = await resolveBetterAuthPrincipal(request)
    return principal.layer === 'L7' || principal.layer === 'L8'
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) return false
    return false
  }
}
