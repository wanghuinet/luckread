import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('versioned users/me adapter', () => {
  it('exposes the existing self-profile handler under /api/v1/users/me', () => {
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/users/me/route.ts'),
      'utf8',
    )

    expect(route).toContain("export { GET, PATCH } from '../../../../(payload)/api/users/me/route'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('validateSession(')
  })
})

it('guards viewer profile reads before the W02 authority call', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
  const guardIndex = route.indexOf('await enforcePublicReadRateLimit(request)')
  const authorityIndex = route.indexOf("callW02UserProfile(request, '/internal/account/profile', 'GET')")
  expect(guardIndex).toBeGreaterThanOrEqual(0)
  expect(authorityIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeLessThan(authorityIndex)
})


it('guards self-profile mutations before the W02 authority call', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
  const patchIndex = route.indexOf('export async function PATCH')
  const guardIndex = route.indexOf('await enforceW01WriteRateLimit(request)', patchIndex)
  const authorityIndex = route.indexOf("callW02UserProfile(request, '/internal/account/profile', 'GET')", patchIndex)
  expect(patchIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeGreaterThanOrEqual(0)
  expect(authorityIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeLessThan(authorityIndex)
})
