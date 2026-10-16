import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 bookmark adapters', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/interactions/bookmarks/route.ts'),
    'utf8',
  )

  it('uses the cookie-backed authenticated principal and W05 authority', () => {
    expect(route).toContain('resolveCookieSocialPrincipal')
    expect(route).toContain('async function forwardList')
    expect(route).toContain("'/internal/social/interactions/bookmarks/list?'")
    expect(route).toContain("'/internal/content/bookmarked-items'")
    expect(route).toContain('callW03Content')
    expect(route).toContain('callW05Social')
    expect(route).toContain("'/internal/social/interactions/bookmarks'")
    expect(route).toContain("body: method === 'GET' ? undefined : target")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('interaction_favorites')
  })

  it('enforces Idempotency-Key on bookmark mutations', () => {
    expect(route).toContain("method !== 'GET'")
    expect(route).toContain("request.headers.get('Idempotency-Key')")
    expect(route).toContain("PRECONDITION_REQUIRED")
    expect(route).toContain('idempotencyKey.length > 256')
  })

  it('keeps list pagination distinct from a single bookmark status lookup', () => {
    expect(route).toContain("searchParams.get('list') === 'true'")
    expect(route).toContain("const allowed = new Set(['list', 'limit', 'cursor'])")
    expect(route).toContain('rawLimit && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)')
  })

  it('exposes favorite status plus both idempotent mutation methods', () => {
    expect(route).toContain("return forward(request, 'GET')")
    expect(route).toContain("return forward(request, 'POST')")
    expect(route).toContain("return forward(request, 'DELETE')")
    expect(route).toContain('parseQueryTarget')
    expect(route).toContain('/internal/social/interactions/bookmarks?targetType=')
  })
})
