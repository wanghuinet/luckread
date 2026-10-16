import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { enforcePublicReadRateLimit } from '@/auth/traffic-limit'
import { getBetterAuthPrincipal } from '@/auth/w02-session-client'
import CreatorDomainHome from './CreatorDomainHome'
import TwitterCloneLanding from './TwitterCloneLanding'
import { normalizePublicLocale } from '../(frontend)/i18n/public-locale'

export const dynamic = 'force-dynamic'

export default async function LandingPage() {
  const requestHeaders = await headers()
  const host = (requestHeaders.get('host') || '').split(':')[0].toLowerCase()
  if (host === 'mp.luckread.com') return <CreatorDomainHome />
  const request = new Request('https://luckread.com/', { headers: requestHeaders })
  let principal: Awaited<ReturnType<typeof getBetterAuthPrincipal>> | null = null
  try { await enforcePublicReadRateLimit(request); principal = await getBetterAuthPrincipal(request) } catch {}
  if (principal?.active) redirect('/home')
  const localeCookie = (await cookies()).get('luckread-ui-locale')?.value
  return <TwitterCloneLanding locale={normalizePublicLocale(localeCookie)} />
}
