import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 like adapters', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/interactions/likes/route.ts'),
    'utf8',
  )

  it('uses the cookie-backed authenticated principal and W05 authority', () => {
    expect(route).toContain('resolveCookieSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain("'/internal/social/interactions/likes'")
    expect(route).toContain("body: method === 'GET' ? undefined : target")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('interaction_likes')
  })

  it('enforces Idempotency-Key on like mutations', () => {
    expect(route).toContain("method !== 'GET'")
    expect(route).toContain("request.headers.get('Idempotency-Key')")
    expect(route).toContain("PRECONDITION_REQUIRED")
    expect(route).toContain('idempotencyKey.length > 256')
  })

  it('exposes like status plus both idempotent mutation methods', () => {
    expect(route).toContain("return forward(request, 'GET')")
    expect(route).toContain("return forward(request, 'POST')")
    expect(route).toContain("return forward(request, 'DELETE')")
    expect(route).toContain('parseQueryTarget')
    expect(route).toContain('/internal/social/interactions/likes?targetType=')
  })
})
