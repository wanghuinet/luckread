import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 comment like adapters', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/comments/[commentId]/likes/route.ts'),
    'utf8',
  )

  it('uses the cookie-backed authenticated principal and W05 authority', () => {
    expect(route).toContain('resolveCookieSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain("pathname: '/internal/social/interactions/likes'")
    expect(route).toContain("body: { targetType: 'comment', targetId: commentId }")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('interaction_likes')
  })

  it('exposes idempotent POST and DELETE comment-like mutations', () => {
    expect(route).toContain('requireIdempotencyKey')
    expect(route).toContain("return forward(request, context, 'POST')")
    expect(route).toContain("return forward(request, context, 'DELETE')")
    expect(route).toContain("const key = request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(route).toContain('key.length > 256')
  })
})
