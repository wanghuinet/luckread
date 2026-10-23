import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 block/mute adapters', () => {
  it('forwards block and mute mutations through the authenticated W05 boundary', () => {
    for (const path of [
      'src/app/api/v1/interactions/blocks/route.ts',
      'src/app/api/v1/interactions/mutes/route.ts',
    ]) {
      const route = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(route).toContain('resolveCookieSocialPrincipal')
      expect(route).toContain('callW05Social')
      expect(route).toContain('resolveSocialProfileIdentityId')
      expect(route).toContain('Idempotency-Key')
      expect(route).not.toContain('getPayload(')
      expect(route).not.toContain('social_user_interactions')
    }
  })

  it('lists blocked and muted accounts through the authenticated W05 boundary with bounded query params', () => {
    for (const [path, relation] of [
      ['src/app/api/v1/interactions/blocks/route.ts', 'blocks'],
      ['src/app/api/v1/interactions/mutes/route.ts', 'mutes'],
    ] as const) {
      const route = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(route).toContain('export async function GET')
      expect(route).toContain('resolveCookieSocialPrincipal')
      expect(route).toContain(`pathname: '/internal/social/interactions/${relation}' + suffix`)
      expect(route).toContain("method: 'GET'")
      expect(route).toContain("key !== 'cursor' && key !== 'limit'")
      expect(route).toContain('limit.trim()')
      expect(route).not.toContain('social_user_interactions')
    }
  })

  it('rate limits block/mute creation before identity and target lookup', () => {
    for (const path of [
      'src/app/api/v1/interactions/blocks/route.ts',
      'src/app/api/v1/interactions/mutes/route.ts',
    ]) {
      const route = readFileSync(resolve(process.cwd(), path), 'utf8')
      const postStart = route.indexOf('export async function POST')
      const postRoute = route.slice(postStart)
      expect(postRoute).toContain('await enforceW01WriteRateLimit(request)')
      expect(postRoute).toContain('TrafficLimitError')
      expect(postRoute).toContain('rateLimitResponse(request)')
      expect(postRoute.indexOf('await enforceW01WriteRateLimit(request)'))
        .toBeLessThan(postRoute.indexOf('await resolveCookieSocialPrincipal(request)'))
      expect(postRoute.indexOf('await enforceW01WriteRateLimit(request)'))
        .toBeLessThan(postRoute.indexOf('await resolveSocialProfileIdentityId(targetUserId)'))
    }
  })

  it('rate limits unblock and unmute before identity resolution', () => {
    for (const path of [
      'src/app/api/v1/interactions/blocks/[targetUserId]/route.ts',
      'src/app/api/v1/interactions/mutes/[targetUserId]/route.ts',
    ]) {
      const route = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(route).toContain('await enforceW01WriteRateLimit(request)')
      expect(route).toContain('TrafficLimitError')
      expect(route).toContain('rateLimitResponse(request)')
      expect(route.indexOf('await enforceW01WriteRateLimit(request)'))
        .toBeLessThan(route.indexOf('await resolveCookieSocialPrincipal(request)'))
    }
  })

  it('enforces idempotency preconditions on unblock and unmute', () => {
    for (const path of [
      'src/app/api/v1/interactions/blocks/[targetUserId]/route.ts',
      'src/app/api/v1/interactions/mutes/[targetUserId]/route.ts',
    ]) {
      const route = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(route).toContain("request.headers.get('Idempotency-Key')")
      expect(route).toContain("PRECONDITION_REQUIRED")
      expect(route).toContain('idempotencyKey.length > 256')
    }
  })

  it('forwards unblock and unmute to target-specific W05 endpoints', () => {
    const blockDelete = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/interactions/blocks/[targetUserId]/route.ts'),
      'utf8',
    )
    const muteDelete = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/interactions/mutes/[targetUserId]/route.ts'),
      'utf8',
    )
    expect(blockDelete).toContain('/internal/social/interactions/blocks/')
    expect(muteDelete).toContain('/internal/social/interactions/mutes/')
    expect(blockDelete).toContain('method: \'DELETE\'')
    expect(muteDelete).toContain('method: \'DELETE\'')
  })
})
