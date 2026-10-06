import {
  signOutThroughW02,
  W02AuthClientError,
} from '../../../auth/w02-session-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  new Response(
    JSON.stringify({
      error: { code, message, details: {} },
      requestId: crypto.randomUUID(),
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )

const buildLegacyPayloadClearCookie = (request: Request): string => {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `payload-token=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`
}

const successResponse = (request: Request, nativeResponse?: Response): Response => {
  const headers = new Headers({ 'cache-control': 'no-store' })
  const setCookie = nativeResponse?.headers.get('set-cookie')
  if (setCookie) headers.set('set-cookie', setCookie)
  headers.append('set-cookie', buildLegacyPayloadClearCookie(request))
  return new Response(null, { status: 204, headers })
}

export async function POST(request: Request): Promise<Response> {
  try {
    const response = await signOutThroughW02(request)
    if (response.ok) return successResponse(request, response)
    if (response.status === 401) return successResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  } catch (error) {
    if (error instanceof W02AuthClientError && error.status === 401) {
      return successResponse(request)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }
}
