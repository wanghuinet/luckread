import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Twitter-clone homepage D1 guard', () => {
  it('uses the W01 public principal endpoint for the public root route without direct worker calls', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/(twitter-clone)/page.tsx'), 'utf8')
    expect(page).toContain("PUBLIC_API_ORIGIN + '/v1/auth/principal'")
    expect(page).toContain('fetchJson<AuthPrincipalResponse>(request)')
    expect(page).toContain("if (principal?.active) redirect('/home')")
    expect(page).not.toContain('getBetterAuthPrincipal')
    expect(page).not.toContain('w02-session-client')
    expect(page).not.toContain('enforcePublicReadRateLimit')
    expect(page).not.toContain('payload.auth(')
    expect(page).not.toContain('payload-token')
    expect(page).not.toContain('readVerifiedPayloadTokenVersion')
    expect(page).not.toContain('validateSession(')
  })

  it('uses the public W01 API client for the initial feed without duplicating rate limiting', () => {
    const home = readFileSync(resolve(process.cwd(), 'src/app/(twitter-clone)/home/page.tsx'), 'utf8')
    expect(home).toContain("import { fetchJson } from '../../../lib/client-api.js'")
    expect(home).toContain("new Request('https://api.luckread.com/v1/contents?limit=20'")
    expect(home).toContain('fetchJson<{ data?: HomeContentPage }>(request)')
    expect(home).toContain('The contents API owns anonymous read rate limiting for this request.')
    expect(home).not.toContain("from '../../api/v1/contents/route'")
    expect(home).not.toContain('enforcePublicReadRateLimit')
    expect(home).not.toContain('payload.auth(')
    expect(home).not.toContain('payload-token')
    expect(home).not.toContain('readVerifiedPayloadTokenVersion')
    expect(home).not.toContain('validateSession(')
  })
})
