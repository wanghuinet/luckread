import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getBetterAuthSession } from '@/auth/w02-auth-client'

import { CreatorStudio } from './CreatorStudio'

export const dynamic = 'force-dynamic'

type StudioLocale = 'zh-CN' | 'en-US'

export default async function CreatorCenterPage() {
  const requestHeaders = await headers()
  const localeCookie = (await cookies()).get('luckread-ui-locale')?.value
  const locale: StudioLocale = localeCookie === 'en-US' ? 'en-US' : 'zh-CN'
  const request = new Request('https://mp.luckread.com/creator-center', { headers: requestHeaders })
  const payload = await getPayload({ config })

  const session = await getBetterAuthSession(request).catch((): null => null)
  if (!session?.user?.id) redirect('/login?returnTo=%2Fcreator-center')

  const user = await payload.findByID({
    collection: 'users',
    id: String(session.user.id),
    depth: 0,
    overrideAccess: true,
  }).catch((): null => null) as unknown as Record<string, unknown> | null

  if (!user) redirect('/login?returnTo=%2Fcreator-center')

  const displayName =
    typeof user.displayName === 'string' && user.displayName.trim()
      ? user.displayName
      : typeof user.username === 'string' && user.username.trim()
        ? user.username
        : typeof user.email === 'string' && user.email.trim()
          ? user.email
          : '创作者'

  return <CreatorStudio displayName={displayName} userId={String(session.user.id)} locale={locale} />
}
