import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 share adapters', () => {
  it('forwards share creation to W05 with the authenticated principal', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/content/[contentId]/shares/route.ts'),
      'utf8',
    )
    expect(route).toContain('resolveCookieSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain('/internal/social/content/')
    expect(route).toContain('/shares')
    expect(route).toContain('Idempotency-Key')
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('social_share_links')
  })

  it('forwards public share resolution without a viewer principal', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/shares/[shareId]/route.ts'),
      'utf8',
    )
    expect(route).toContain('callW05SocialPublic')
    expect(route).toContain('/internal/social/shares/')
    expect(route).toContain('method: \'GET\'')
    expect(route).not.toContain('getPayload(')
  })
})
