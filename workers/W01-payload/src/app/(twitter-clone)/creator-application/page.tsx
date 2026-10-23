import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { fetchJson } from '../../../lib/client-api.js'

import CreatorApplicationClient from '../../(frontend)/creator-application/CreatorApplicationClient'

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

export default async function CreatorApplicationPage() {
  const requestHeaders = await headers()
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
  if (response.status === 401) redirect('/login?returnTo=%2Fcreator-application')

  const principal = data?.data
  if (!response.ok || !principal || typeof principal.active !== 'boolean') {
    throw new Error('Creator application authentication could not be verified')
  }
  if (!principal.active) redirect('/login?returnTo=%2Fcreator-application')

  const displayName =
    typeof principal.username === 'string' && principal.username.trim()
      ? principal.username
      : principal.email

  return <CreatorApplicationClient layer={principal.layer ?? 'L1'} displayName={displayName} />
}
