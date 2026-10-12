import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getBetterAuthPrincipal, W02AuthClientError } from '@/auth/w02-session-client'

import CreatorReviewClient from './CreatorReviewClient'

export const dynamic = 'force-dynamic'

export default async function CreatorReviewPage() {
  const requestHeaders = await headers()
  const request = new Request('https://mp.luckread.com/creator-review', { headers: requestHeaders })
  let principal

  try {
    principal = await getBetterAuthPrincipal(request)
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      redirect('/login?returnTo=%2Fcreator-review')
    }
    throw error
  }

  if (!principal.active) redirect('/login?returnTo=%2Fcreator-review')
  if (principal.layer !== 'L7' && principal.layer !== 'L8') redirect('/creator-application')

  const displayName =
    typeof principal.username === 'string' && principal.username.trim()
      ? principal.username
      : principal.email

  return <CreatorReviewClient displayName={displayName} />
}
