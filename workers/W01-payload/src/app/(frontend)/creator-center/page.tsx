import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getBetterAuthPrincipal, W02AuthClientError } from '@/auth/w02-session-client'

import { CreatorStudio } from './CreatorStudio'

export const dynamic = 'force-dynamic'

type StudioLocale = 'zh-CN' | 'en-US'

export default async function CreatorCenterPage() {
  const requestHeaders = await headers()
  const localeCookie = (await cookies()).get('luckread-ui-locale')?.value
  const locale: StudioLocale = localeCookie === 'en-US' ? 'en-US' : 'zh-CN'
  const request = new Request('https://mp.luckread.com/creator-center', { headers: requestHeaders })

  let principal
  try {
    principal = await getBetterAuthPrincipal(request)
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      redirect('/login?returnTo=%2Fcreator-center')
    }
    throw error
  }

  if (!principal.active) redirect('/login?returnTo=%2Fcreator-center')

  const displayName =
    typeof principal.username === 'string' && principal.username.trim()
      ? principal.username
      : principal.email

  return <CreatorStudio displayName={displayName} userId={principal.userId} locale={locale} />
}
