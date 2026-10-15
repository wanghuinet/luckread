import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Twitter-clone homepage D1 guard', () => {
  it('uses the W02 principal and public-read guard for the public root route', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/(twitter-clone)/page.tsx'), 'utf8')
    expect(page).toContain('getBetterAuthPrincipal')
    expect(page).toContain('enforcePublicReadRateLimit')
    expect(page).not.toContain('payload.auth(')
    expect(page).not.toContain('payload-token')
    expect(page).not.toContain('readVerifiedPayloadTokenVersion')
    expect(page).not.toContain('validateSession(')
  })

  it('delegates feed rate limiting to the contents API instead of counting the same request twice', () => {
    const home = readFileSync(resolve(process.cwd(), 'src/app/(twitter-clone)/home/page.tsx'), 'utf8')
    expect(home).toContain("import { GET as getPublicContents } from '../../api/v1/contents/route'")
    expect(home).toContain('const response = await getPublicContents(request)')
    expect(home).toContain('The contents route owns anonymous read rate limiting; do not count this request twice.')
    expect(home).not.toContain('enforcePublicReadRateLimit')
    expect(home).not.toContain('payload.auth(')
    expect(home).not.toContain('payload-token')
    expect(home).not.toContain('readVerifiedPayloadTokenVersion')
    expect(home).not.toContain('validateSession(')
  })
})
