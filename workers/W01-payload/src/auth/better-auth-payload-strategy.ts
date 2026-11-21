import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { AuthStrategy } from 'payload'

type PrincipalResponse = { active?: boolean; userId?: string; layer?: string }
type W02ServiceBinding = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }

// Payload receives a projected Better Auth principal; it does not own credentials or sessions.
export const betterAuthPayloadStrategy: AuthStrategy = {
  name: 'luckread-better-auth',
  authenticate: async ({ payload, headers }) => {
    try {
      const context = await getCloudflareContext({ async: true })
      const service = (context.env as unknown as { W02_AUTH?: W02ServiceBinding }).W02_AUTH
      if (!service) return { user: null }
      const response = await service.fetch(new Request('https://luckread-w02.internal/internal/auth/principal', { method: 'POST', headers: new Headers(headers) }))
      if (!response.ok) return { user: null }
      const principal = await response.json() as PrincipalResponse
      if (principal.active !== true || typeof principal.userId !== 'string' || typeof principal.layer !== 'string') return { user: null }
      const users = await payload.find({
        collection: 'users',
        where: { identityId: { equals: principal.userId } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      const existing = users.docs[0]
      if (!existing) return { user: null }
      return { user: { collection: 'users', ...existing } }
    } catch {
      return { user: null }
    }
  },
}
