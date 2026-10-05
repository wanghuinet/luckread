import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@payload-config'

import { readVerifiedPayloadTokenVersion } from '@/auth/payload-access-token'
import { validateSession } from '@/auth/w02-session-client'

import { CreatorStudio } from './CreatorStudio'

export const dynamic = 'force-dynamic'

type StudioLocale = 'zh-CN' | 'en-US'

export default async function CreatorCenterPage() {
  const requestHeaders = await headers()
  const localeCookie = (await cookies()).get('luckread-ui-locale')?.value
  const locale: StudioLocale = localeCookie === 'en-US' ? 'en-US' : 'zh-CN'
  const request = new Request('https://mp.luckread.com/creator-center', {
    headers: requestHeaders,
  })
  const payload = await getPayload({ config })

  let authResult: Awaited<ReturnType<typeof payload.auth>>
  try {
    authResult = await payload.auth({
      headers: request.headers,
      canSetHeaders: false,
    })
  } catch {
    redirect('/login?returnTo=%2Fcreator-center')
  }

  const user = authResult.user as unknown as ({
    id?: string | number
    _sid?: string
    displayName?: unknown
    username?: unknown
    email?: unknown
  } | null)

  const tokenVersion = readVerifiedPayloadTokenVersion(request)
  if (!user?.id || typeof user._sid !== 'string' || !user._sid || tokenVersion === null) {
    redirect('/login?returnTo=%2Fcreator-center')
  }

  const active = await validateSession({
    sessionId: user._sid,
    userId: String(user.id),
    tokenVersion,
  }).catch(() => false)

  if (!active) {
    redirect('/login?returnTo=%2Fcreator-center')
  }

  const displayName =
    typeof user.displayName === 'string' && user.displayName.trim()
      ? user.displayName
      : typeof user.username === 'string' && user.username.trim()
        ? user.username
        : typeof user.email === 'string' && user.email.trim()
          ? user.email
          : '创作者'

  return <CreatorStudio displayName={displayName} userId={String(user.id)} locale={locale} />
}
