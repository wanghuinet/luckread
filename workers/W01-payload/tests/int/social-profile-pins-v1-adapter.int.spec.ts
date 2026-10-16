import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('v1 profile pin adapters', () => {
  it('forwards pin and unpin mutations through the authenticated W05 boundary', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/v1/content/[contentId]/pin/route.ts'), 'utf8')
    expect(route).toContain('resolveCookieSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain("'/pin'")
    expect(route).toContain("method: request.method")
    expect(route).toContain('Idempotency-Key')
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('social_profile_pins')
  })

  it('exposes the owner’s published pinned-content reference through W05', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/v1/users/[userId]/pinned-content/route.ts'), 'utf8')
    const profile = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/users/[userId]/page.tsx'), 'utf8')
    expect(route).toContain('callW05SocialPublic')
    expect(route).toContain('/pinned-content')
    expect(profile).toContain('/pinned-content')
    expect(profile).toContain('sortPinnedFirst')
    expect(profile).toContain('onPinChanged=')
  })
})
