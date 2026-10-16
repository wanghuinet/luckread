import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('v1 repost adapter', () => {
  it('forwards authenticated repost and undo requests to W05', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/v1/content/[contentId]/reposts/route.ts'), 'utf8')
    expect(route).toContain('resolveCookieSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain('/internal/social/content/')
    expect(route).toContain('/reposts')
    expect(route).toContain("method: request.method")
    expect(route).toContain('Idempotency-Key')
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('social_reposts')
  })
})
