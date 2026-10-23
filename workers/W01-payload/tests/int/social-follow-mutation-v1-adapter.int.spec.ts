import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 follow mutation adapter', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/social/follows/[targetUserId]/route.ts'),
    'utf8',
  )

  it('uses the authenticated social principal and W05 authority', () => {
    expect(route).toContain('resolveSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain('/internal/social/follows/')
    expect(route).not.toContain('social_follow_relationships')
  })

  it('rate limits follow/unfollow before identity and target lookup', () => {
    expect(route).toContain('enforceW01WriteRateLimit(request)')
    expect(route).toContain('TrafficLimitError')
    expect(route).toContain('rateLimitResponse(request)')
    expect(route.indexOf("if(method!=='GET') await enforceW01WriteRateLimit(request)"))
      .toBeLessThan(route.indexOf('await resolveSocialPrincipal(request)'))
    expect(route.indexOf('await enforceW01WriteRateLimit(request)'))
      .toBeLessThan(route.indexOf('await assertSocialTargetUserExists(targetUserId)'))
  })

  it('enforces Idempotency-Key on follow and unfollow mutations', () => {
    expect(route).toContain("method!=='GET'")
    expect(route).toContain("request.headers.get('Idempotency-Key')")
    expect(route).toContain("'PRECONDITION_REQUIRED'")
    expect(route).toContain('idempotencyKey.length > 256')
  })

  it('maps an explicit missing Payload target to NOT_FOUND while preserving dependency failures', () => {
    const client = readFileSync(
      resolve(process.cwd(), 'src/social/w05-social-client.ts'),
      'utf8',
    )
    expect(client).toContain('details?.status === 404')
    expect(client).toContain('details?.statusCode === 404')
    expect(client).toContain("new W05SocialClientError(404, 'NOT_FOUND', 'Target user not found')")
    expect(client).toContain('    throw error\n  }\n  if (!user)')
  })

  it('keeps target existence validation on follow creation', () => {
    expect(route).toContain("if(method==='POST') await assertSocialTargetUserExists(targetUserId)")
  })
})
