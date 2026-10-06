import type { PayloadRequest } from 'payload'

import { W02AuthClientError, authorizeAdminUser } from '@/auth/w02-session-client'

type PayloadAdminUser = {
  id?: string | number
  email?: string
} | null

export const payloadAdminOnly = async ({ req }: { req: PayloadRequest }): Promise<boolean> => {
  try {
    const user = req.user as unknown as PayloadAdminUser
    if (!user?.id && !user?.email) return false

    const principal = await authorizeAdminUser({
      userId: user.id ? String(user.id) : undefined,
      email: typeof user.email === 'string' ? user.email : undefined,
    })

    return principal.adminAccess === true &&
      principal.active === true &&
      (principal.layer === 'L7' || principal.layer === 'L8') &&
      (principal.roles.includes('admin') || principal.roles.includes('super_admin'))
  } catch (error) {
    if (error instanceof W02AuthClientError) return false
    return false
  }
}
