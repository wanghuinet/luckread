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
    expect(route).toContain('callW05Social')
    expect(route).toContain("'/internal/social/interactions/bookmarks'")
    expect(route).toContain("body: method === 'GET' ? undefined : target")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('interaction_favorites')
  })

  it('exposes favorite status plus both idempotent mutation methods', () => {
    expect(route).toContain("return forward(request, 'GET')")
    expect(route).toContain("return forward(request, 'POST')")
    expect(route).toContain("return forward(request, 'DELETE')")
    expect(route).toContain('parseQueryTarget')
    expect(route).toContain('/internal/social/interactions/bookmarks?targetType=')
  })
})
