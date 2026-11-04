import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 Expo push endpoint adapter', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/push/endpoints/[installationId]/route.ts'),
    'utf8',
  )

  it('resolves the current W02 principal and forwards only through the existing W01-to-W05 binding', () => {
    expect(route).toContain('resolveSocialPrincipal(request)')
    expect(route).toContain('callW05Social')
    expect(route).toContain("'/internal/social/push-endpoints/'")
    expect(route).toContain("method: 'PUT' | 'DELETE'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('userId:')
  })

  it('applies the W01 write rate limit before principal resolution', () => {
    expect(route).toContain('await enforceW01WriteRateLimit(request)')
    expect(route).toContain('TrafficLimitError')
    expect(route).toContain('rateLimitResponse(request)')
    expect(route.indexOf('await enforceW01WriteRateLimit(request)'))
      .toBeLessThan(route.indexOf('await resolveSocialPrincipal(request)'))
  })

  it('exposes only idempotent PUT registration and owner-scoped DELETE, without returning tokens', () => {
    expect(route).toContain('export async function PUT')
    expect(route).toContain('export async function DELETE')
    expect(route).not.toContain('export async function POST')
    expect(route).toContain('body')
    expect(route).toContain('cache-control')
  })
})
