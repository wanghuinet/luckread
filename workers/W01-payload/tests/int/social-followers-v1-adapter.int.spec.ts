import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 follower relationship adapters', () => {
  it.each([
    ['followers', 'followers'],
    ['following', 'following'],
  ])('routes %s through the W05 Social authority', (kind, pathPart) => {
    const route = readFileSync(
      resolve(process.cwd(), `src/app/api/v1/users/[userId]/${kind}/route.ts`),
      'utf8',
    )

    expect(route).toContain('callW05SocialPublic')
    expect(route).not.toContain('resolveSocialPrincipal')
    expect(route).toContain('encodeURIComponent(userId)')
    expect(route).toContain('pathname: `/internal/social/users/${encodeURIComponent(userId)}/')
    expect(route).toContain(`/${pathPart}`)
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('social_follow_relationships')
  })

  it('cancels stale follow-list requests and ignores aborted completions', () => {
    const view = read('src/app/(frontend)/users/[userId]/UserFollowList.tsx')
    expect(view).toContain('activeRequestRef')
    expect(view).toContain('requestGenerationRef')
    expect(view).toContain('activeRequestRef.current?.abort()')
    expect(view).toContain('signal: controller.signal')
    expect(view).toContain("cause.name === 'AbortError'")
    expect(view).toContain('if (!isCurrentRequest(controller, generation)) return')
  })

})
