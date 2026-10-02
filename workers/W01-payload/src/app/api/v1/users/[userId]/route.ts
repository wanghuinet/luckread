import { getPayload } from 'payload'

import config from '@payload-config'

const publicSelect = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
  avatar: true,
} as const

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId } = await context.params
    if (!userId || userId.length > 128) {
      return Response.json(
        { error: { code: 'VALIDATION_FAILED', message: 'Invalid user id', details: {} }, requestId: crypto.randomUUID() },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      )
    }

    const payload = await getPayload({ config })
    const user = await payload.findByID({
      collection: 'users',
      id: userId,
      depth: 0,
      overrideAccess: true,
      select: publicSelect,
    })

    if (!user) {
      return Response.json(
        { error: { code: 'RESOURCE_NOT_FOUND', message: 'User not found', details: {} }, requestId: crypto.randomUUID() },
        { status: 404, headers: { 'cache-control': 'no-store' } },
      )
    }

    return Response.json({
      id: String(user.id ?? ''),
      username: typeof user.username === 'string' ? user.username : '',
      displayName: typeof user.displayName === 'string' ? user.displayName : null,
      bio: typeof user.bio === 'string' ? user.bio : null,
      avatar: typeof user.avatar === 'string' ? user.avatar : null,
    }, {
      headers: {
        'cache-control': 'public, max-age=30, stale-while-revalidate=120',
      },
    })
  } catch {
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile service unavailable', details: {} }, requestId: crypto.randomUUID() },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
