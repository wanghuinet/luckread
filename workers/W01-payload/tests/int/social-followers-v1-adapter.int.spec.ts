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

    expect(route).toContain('resolveSocialPrincipal')
    expect(route).toContain('callW05Social')
    expect(route).toContain(`/internal/social/users/${encodeURIComponent(userId)}/${pathPart}`)
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('social_follow_relationships')
  })
})
