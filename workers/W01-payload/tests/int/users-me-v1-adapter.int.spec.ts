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
    expect(route).not.toContain('PROFILE_MUTABLE_FIELDS')
  })
})

it('distinguishes unauthenticated profile access from W02 service failure', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
  expect(route).toContain('error instanceof W02AuthClientError && error.status === 401')
  expect(route).toContain("errorResponse(503, 'SERVICE_UNAVAILABLE'")
})

it('uses canonical self-profile error envelopes and response request IDs', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
  expect(route).toContain("errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')")
  expect(route).toContain("requestId: `req_${crypto.randomUUID()}`")
  expect(route).toContain("status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status")
  expect(route).toContain("'CONFLICT', 'Username is already in use'")
})

it('guards viewer profile reads before authentication', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
  const guardIndex = route.indexOf('await enforcePublicReadRateLimit(request)')
  const authIndex = route.indexOf('const authenticated = await authenticate(request)')
  expect(guardIndex).toBeGreaterThanOrEqual(0)
  expect(authIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeLessThan(authIndex)
})


it('guards self-profile mutations before Payload authentication', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/app/(payload)/api/users/me/route.ts'), 'utf8')
  const patchIndex = route.indexOf('export async function PATCH')
  const guardIndex = route.indexOf('await enforceW01WriteRateLimit(request)', patchIndex)
  const authIndex = route.indexOf('authenticated = await authenticate(request)', patchIndex)
  expect(patchIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeGreaterThanOrEqual(0)
  expect(authIndex).toBeGreaterThanOrEqual(0)
  expect(guardIndex).toBeLessThan(authIndex)
})
