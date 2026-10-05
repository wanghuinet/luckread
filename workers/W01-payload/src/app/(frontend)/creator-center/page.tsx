import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { callW02UserProfile } from '@/auth/w02-user-profile-client'

import { CreatorStudio } from './CreatorStudio'

export const dynamic = 'force-dynamic'

type StudioLocale = 'zh-CN' | 'en-US'

type CreatorProfile = {
  id?: unknown
  email?: unknown
  username?: unknown
  displayName?: unknown
}

export default async function CreatorCenterPage() {
  const requestHeaders = await headers()
  const localeCookie = (await cookies()).get('luckread-ui-locale')?.value
  const locale: StudioLocale = localeCookie === 'en-US' ? 'en-US' : 'zh-CN'
  const request = new Request('https://mp.luckread.com/creator-center', {
    headers: requestHeaders,
  })

  let profileResponse: Response
  try {
    profileResponse = await callW02UserProfile(request, '/internal/account/profile', 'GET')
  } catch {
    redirect('/login?returnTo=%2Fcreator-center')
  }

  if (!profileResponse.ok) {
    redirect('/login?returnTo=%2Fcreator-center')
  }

  const profile = await profileResponse.json().catch(() => null) as CreatorProfile | null
  const userId =
    typeof profile?.id === 'string' && profile.id.trim().length > 0
      ? profile.id
      : null

  if (!userId) {
    redirect('/login?returnTo=%2Fcreator-center')
  }

  const displayName =
    typeof profile?.displayName === 'string' && profile.displayName.trim()
      ? profile.displayName
      : typeof profile?.username === 'string' && profile.username.trim()
        ? profile.username
        : typeof profile?.email === 'string' && profile.email.trim()
          ? profile.email
          : '创作者'

  return <CreatorStudio displayName={displayName} userId={userId} locale={locale} />
}
