import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { fetchJson } from '../../lib/client-api.js'
import CreatorDomainHome from './CreatorDomainHome'
import TwitterCloneLanding from './TwitterCloneLanding'
import { normalizePublicLocale } from '../(frontend)/i18n/public-locale'

export const dynamic = 'force-dynamic'

const PUBLIC_API_ORIGIN = 'https://api.luckread.com'

type AuthPrincipal = {
  active: boolean
  userId: string
  email: string
  username: string | null
  layer: string | null
}

type AuthPrincipalResponse = { data?: AuthPrincipal }

export default async function LandingPage() {
  const requestHeaders = await headers()
  const host = (requestHeaders.get('host') || '').split(':')[0].toLowerCase()
  if (host === 'mp.luckread.com') return <CreatorDomainHome />
  const forwardedHeaders = new Headers({ accept: 'application/json' })
  for (const name of ['cookie', 'authorization', 'cf-connecting-ip', 'accept-language', 'x-luckread-session-token']) {
    const value = requestHeaders.get(name)
    if (value) forwardedHeaders.set(name, value)
  }

  let principal: AuthPrincipal | null = null
  try {
    const request = new Request(PUBLIC_API_ORIGIN + '/v1/auth/principal', {
      method: 'GET',
      headers: forwardedHeaders,
      cache: 'no-store',
    })
    const { response, data } = await fetchJson<AuthPrincipalResponse>(request)
    if (response.ok && data?.data?.active === true) principal = data.data
  } catch {}
  if (principal?.active) redirect('/home')
  const localeCookie = (await cookies()).get('luckread-ui-locale')?.value
  return <TwitterCloneLanding locale={normalizePublicLocale(localeCookie)} />
}
