import { NextResponse, type NextRequest } from 'next/server'

import { buildUsernameRedirectPathname, parseUsernameRoutePath } from './lib/username-redirect'

type UsernameRedirectResponse = {
  targetUsername?: unknown
}

export async function middleware(request: NextRequest): Promise<Response> {
  const route = parseUsernameRoutePath(request.nextUrl.pathname)
  if (!route) return NextResponse.next()

  const resolverURL = new URL(
    `/api/v1/redirects/username/${encodeURIComponent(route.username.toLowerCase())}`,
    request.url,
  )

  const resolverHeaders = new Headers({ accept: 'application/json' })
  const clientIP = request.headers.get('cf-connecting-ip')
  if (clientIP) resolverHeaders.set('cf-connecting-ip', clientIP)

  let resolverResponse: Response
  try {
    resolverResponse = await fetch(resolverURL, {
      method: 'GET',
      headers: resolverHeaders,
      cache: 'no-store',
      redirect: 'manual',
    })
  } catch {
    return new Response('Username redirect service unavailable', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'retry-after': '1' },
    })
  }

  if (resolverResponse.status === 404) return NextResponse.next()
  if (!resolverResponse.ok) {
    return new Response('Username redirect service unavailable', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'retry-after': '1' },
    })
  }

  let result: UsernameRedirectResponse
  try {
    result = await resolverResponse.json() as UsernameRedirectResponse
  } catch {
    return new Response('Username redirect response invalid', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'retry-after': '1' },
    })
  }

  if (typeof result.targetUsername !== 'string') return NextResponse.next()
  const destinationPath = buildUsernameRedirectPathname(
    request.nextUrl.pathname,
    result.targetUsername,
  )
  if (!destinationPath) return NextResponse.next()

  const destination = request.nextUrl.clone()
  destination.pathname = destinationPath
  const redirect = NextResponse.redirect(destination, 301)
  // Keep the HTTP status permanent, but don't cache an intermediate destination
  // when the account changes its username again later.
  redirect.headers.set('cache-control', 'no-store')
  return redirect
}

export const config = {
  // OpenNext Cloudflare supports Edge Middleware, but not Node.js Middleware.
  // API/admin/static paths are excluded to keep the internal resolver out of this matcher.
  matcher: ['/((?!api|_next|admin).*)'],
}
