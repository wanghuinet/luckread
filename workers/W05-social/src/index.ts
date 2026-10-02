/// <reference types="@cloudflare/workers-types" />
import {
  FollowRuntimeError,
  follow,
  getFollowStatus,
  listFollowers,
  listFollowing,
  parseFollowListLimit,
  unfollow,
} from './follow-runtime.js'

interface Env { DB: D1Database }

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

const principal = (r: Request) => {
  if (
    r.headers.get('X-LuckRead-Caller') !== 'W01' ||
    r.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
    !r.headers.get('X-LuckRead-Correlation-Id')?.trim()
  ) {
    throw new FollowRuntimeError('PERMISSION_DENIED', 403)
  }

  const id = r.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
  if (!id) throw new FollowRuntimeError('UNAUTHENTICATED', 401)
  return id
}

const parsePath = (pathname: string) => {
  const parts = pathname.split('/').filter(Boolean)
  if (
    parts.length === 4 &&
    parts[0] === 'internal' &&
    parts[1] === 'social' &&
    parts[2] === 'follows'
  ) {
    return { kind: 'follow' as const, userId: decodeURIComponent(parts[3]) }
  }

  if (
    parts.length === 5 &&
    parts[0] === 'internal' &&
    parts[1] === 'social' &&
    parts[2] === 'users' &&
    ['followers', 'following'].includes(parts[4])
  ) {
    return {
      kind: parts[4] as 'followers' | 'following',
      userId: decodeURIComponent(parts[3]),
    }
  }

  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const viewerUserId = principal(request)
      const url = new URL(request.url)
      const path = parsePath(url.pathname)
      if (!path) return new Response(null, { status: 404 })

      if (path.kind === 'follow') {
        if (request.method === 'POST') {
          const row = await follow(env.DB, viewerUserId, path.userId)
          return json({
            data: {
              following: true,
              relationshipId: row.relationship_id,
              targetUserId: row.target_user_id,
              createdAt: row.created_at,
            },
            requestId: crypto.randomUUID(),
          }, 201)
        }

        if (request.method === 'DELETE') {
          await unfollow(env.DB, viewerUserId, path.userId)
          return new Response(null, { status: 204 })
        }

        if (request.method === 'GET') {
          return json({
            data: await getFollowStatus(env.DB, viewerUserId, path.userId),
            requestId: crypto.randomUUID(),
          })
        }

        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET, POST, DELETE' },
        })
      }

      if (request.method !== 'GET') {
        return new Response(null, {
          status: 405,
          headers: { Allow: 'GET' },
        })
      }

      const limit = parseFollowListLimit(url.searchParams.get('limit'))
      const cursor = url.searchParams.get('cursor')
      if (cursor && cursor.length > 2048) {
        throw new FollowRuntimeError('INVALID_CURSOR', 400)
      }

      const page = path.kind === 'followers'
        ? await listFollowers(env.DB, path.userId, cursor, limit)
        : await listFollowing(env.DB, path.userId, cursor, limit)

      return json({
        data: page,
        requestId: crypto.randomUUID(),
      })
    } catch (e) {
      if (e instanceof FollowRuntimeError) {
        return json({
          error: {
            code: e.code,
            message: e.code,
            details: {},
          },
          requestId: crypto.randomUUID(),
        }, e.status)
      }

      return json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal error',
          details: {},
        },
        requestId: crypto.randomUUID(),
      }, 500)
    }
  },
}
