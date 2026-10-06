import type { PayloadRequest } from 'payload'

import { authorizePayloadAdmin, W02AuthClientError } from '@/auth/w02-session-client'

type PayloadAdminUser = {
  id?: string | number
} | null

export const payloadAdminOnly = async ({ req }: { req: PayloadRequest }): Promise<boolean> => {
  try {
    const user = req.user as unknown as PayloadAdminUser
    if (!user?.id) return false

    const result = await authorizePayloadAdmin(String(user.id))
    return result.allowed === true
  } catch (error) {
    if (error instanceof W02AuthClientError) return false
    return false
  }
}
