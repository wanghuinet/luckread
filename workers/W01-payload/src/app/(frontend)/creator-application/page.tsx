import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getBetterAuthPrincipal, W02AuthClientError } from '@/auth/w02-session-client'

import CreatorApplicationClient from './CreatorApplicationClient'

export const dynamic = 'force-dynamic'

export default async function CreatorApplicationPage() {
  const requestHeaders = await headers()
  const request = new Request('https://mp.luckread.com/creator-application', { headers: requestHeaders })
  let principal

  try {
    principal = await getBetterAuthPrincipal(request)
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      redirect('/login?returnTo=%2Fcreator-application')
    }
    throw error
  }

  if (!principal.active) redirect('/login?returnTo=%2Fcreator-application')

  const displayName =
    typeof principal.username === 'string' && principal.username.trim()
      ? principal.username
      : principal.email

  return <CreatorApplicationClient layer={principal.layer ?? 'L1'} displayName={displayName} />
}
