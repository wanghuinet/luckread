import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 comment adapters', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/contents/[contentId]/comments/route.ts'),
    'utf8',
  )
  const deleteRoute = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/comments/[commentId]/route.ts'),
    'utf8',
  )

  it('routes public reads and authenticated creates through W05', () => {
    expect(route).toContain('callW05SocialPublic')
    expect(route).toContain('resolveCookieSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain('/internal/social/contents/')
    expect(route).toContain('/comments')
    expect(route).toContain("Idempotency-Key")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('social_comments')
  })

  it('keeps parentId and body in the create request only', () => {
    expect(route).toContain('body: { body, parentId: parentId ?? null }')
  })

  it('exposes authenticated comment deletion through the W05 adapter', () => {
    expect(deleteRoute).toContain('resolveCookieSocialPrincipal')
    expect(deleteRoute).toContain('callW05Social')
    expect(deleteRoute).toContain("method: 'DELETE'")
    expect(deleteRoute).toContain('/internal/social/comments/')
    expect(deleteRoute).not.toContain('social_comments')
  })
})
