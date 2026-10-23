import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { fetchJson } from '../../../lib/client-api.js'
import { CreatorStudio } from './CreatorStudio'

export const dynamic = 'force-dynamic'

const PUBLIC_API_ORIGIN = 'https://api.luckread.com'

type StudioLocale = 'zh-CN' | 'en-US'

type AuthPrincipal = {
  active: boolean
  userId: string
  email: string
  username: string | null
  layer: string | null
}

type AuthPrincipalResponse = {
  data?: AuthPrincipal
}

export default async function CreatorCenterPage() {
  const requestHeaders = await headers()
  const localeCookie = (await cookies()).get('luckread-ui-locale')?.value
  const locale: StudioLocale = localeCookie === 'en-US' ? 'en-US' : 'zh-CN'
  const forwardedHeaders = new Headers({ accept: 'application/json' })

  for (const name of ['cookie', 'authorization', 'cf-connecting-ip', 'accept-language', 'x-luckread-session-token']) {
    const value = requestHeaders.get(name)
    if (value) forwardedHeaders.set(name, value)
  }

  const request = new Request(PUBLIC_API_ORIGIN + '/v1/auth/principal', {
    method: 'GET',
    headers: forwardedHeaders,
    cache: 'no-store',
  })

  const { response, data } = await fetchJson<AuthPrincipalResponse>(request)
  if (response.status === 401) redirect('/login?returnTo=%2Fcreator-center')
  const principal = data?.data
  if (
    !response.ok ||
    !principal ||
    principal.active !== true ||
    typeof principal.userId !== 'string' ||
    typeof principal.email !== 'string'
  ) {
    throw new Error('Creator center authentication could not be verified')
  }

  if (principal.layer !== 'L3') redirect('/creator-application')

  const displayName =
    typeof principal.username === 'string' && principal.username.trim()
      ? principal.username
      : principal.email

  return <CreatorStudio displayName={displayName} userId={principal.userId} locale={locale} />
}
