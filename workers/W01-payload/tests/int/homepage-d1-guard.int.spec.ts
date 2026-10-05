import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('homepage D1 guard', () => {
  it('avoids Payload auth and only resolves authenticated mp visitors through W02', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/app/(frontend)/page.tsx'), 'utf8')
    expect(page).toContain("const hasAuthCredential =")
    expect(page).toContain("const authorization = request.headers.get('authorization')?.trim() || ''")
    expect(page).toContain("authorization.startsWith('Bearer ')")
    expect(page).toContain("request.headers.get('cookie')?.split(';').some")
    expect(page).toContain("name === 'better-auth.session_token'")
    expect(page).toContain("name === '__Secure-better-auth.session_token'")
    expect(page).toContain("if (hasAuthCredential) {")
    expect(page).toContain("await enforcePublicReadRateLimit(request)")
    expect(page).toContain("const profileResponse = await callW02UserProfile(")
    expect(page).toContain("'/internal/account/profile'")
    expect(page).not.toContain("from 'payload'")
    expect(page).not.toContain("@payload-config")
    expect(page).not.toContain("const authResult = await payload.auth({")
    expect(page).not.toContain("readVerifiedPayloadTokenVersion")
    expect(page).not.toContain("validateSession(")
    expect(page).not.toContain("Boolean(request.headers.get('cookie')?.trim())")
  })
})
