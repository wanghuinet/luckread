import { cachedPublicGet } from '../../../../../lib/public-response-cache.js'

import {
  callW05SocialPublic,
  W05SocialClientError,
} from '../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(
  request: Request,
  context: { params: Promise<{ shareId: string }> },
): Promise<Response> {
  try {
    const { shareId } = await context.params
    if (!shareId?.trim()) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid share id')

    return await cachedPublicGet(
      request,
      'share-detail',
      () => callW05SocialPublic({
        request,
        pathname: '/internal/social/shares/' + encodeURIComponent(shareId),
        method: 'GET',
      }),
      60,
    )
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}
