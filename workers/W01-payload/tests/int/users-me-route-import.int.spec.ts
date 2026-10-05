import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = () =>
  readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')

describe('users/me route imports', () => {
  it('uses the W01 path alias for the W02 profile authority client', () => {
    const source = read()

    expect(source).toContain("from '@/auth/w02-user-profile-client'")
    expect(source).toContain("from '@/auth/traffic-limit'")
    expect(source).not.toContain("from '@/auth/payload-access-token'")
    expect(source).not.toContain("from '@/auth/w02-session-client'")
    expect(source).not.toContain("../../../../../auth/payload-access-token.js")
    expect(source).not.toContain("../../../../../auth/w02-session-client.js")
  })

  it('exposes authenticated self-profile GET/PATCH with conditional writes and no mass assignment', () => {
    const source = read()

    expect(source).toContain('export async function GET')
    expect(source).toContain('export async function PATCH')
    expect(source).toContain("if (!request.headers.get('If-Match')?.trim())")
    expect(source).toContain("callW02UserProfile(request, '/internal/account/profile', 'GET')")
    expect(source).toContain("callW02UserProfile(")
    expect(source).toContain("'PATCH'")
    expect(source).not.toContain('getPayload(')
    expect(source).not.toContain('payload.find')
    expect(source).not.toContain('data: input')
  })

  it('applies W01 admission controls before delegating authentication and profile access to W02', () => {
    const source = read()

    const getStart = source.indexOf('export async function GET')
    const patchStart = source.indexOf('export async function PATCH')
    const getGuard = source.indexOf('await enforcePublicReadRateLimit(request)', getStart)
    const getAuthority = source.indexOf("callW02UserProfile(request, '/internal/account/profile', 'GET')")
    const patchGuard = source.indexOf('await enforceW01WriteRateLimit(request)', patchStart)
    const patchAuthority = source.indexOf("callW02UserProfile(request, '/internal/account/profile', 'GET')", patchStart)

    expect(getStart).toBeGreaterThanOrEqual(0)
    expect(patchStart).toBeGreaterThan(getStart)
    expect(getGuard).toBeGreaterThan(getStart)
    expect(getAuthority).toBeGreaterThan(getGuard)
    expect(patchGuard).toBeGreaterThan(patchStart)
    expect(patchAuthority).toBeGreaterThan(patchGuard)
  })
})
