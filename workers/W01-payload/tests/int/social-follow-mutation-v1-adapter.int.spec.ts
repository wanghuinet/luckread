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

  it('enforces Idempotency-Key on follow and unfollow mutations', () => {
    expect(route).toContain("method!=='GET'")
    expect(route).toContain("request.headers.get('Idempotency-Key')")
    expect(route).toContain("'PRECONDITION_REQUIRED'")
    expect(route).toContain('idempotencyKey.length > 256')
  })

  it('keeps target existence validation on follow creation', () => {
    expect(route).toContain("if(method==='POST') await assertSocialTargetUserExists(targetUserId)")
  })
})
