import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('public username routes', () => {
  it('exposes the username profile route through the existing User authority', () => {
    const route = read('src/app/api/v1/users/by-username/[username]/route.ts')
    const profile = read('src/app/(twitter-clone)/[username]/page.tsx')

    expect(route).toContain("collection: 'users'")
    expect(route).toContain("where: { username: { equals: username } }")
    expect(route).toContain('overrideAccess: true')
    expect(route).toContain("identityId: typeof publicUser.identityId === 'string' ? publicUser.identityId : null")
    expect(route).toContain('cachedPublicGet')
    expect(route).toContain('enforcePublicReadRateLimit')
    expect(profile).toContain("fetchJson<PublicUserLookup>('/api/v1/users/by-username/")
    expect(profile).toContain("import UserProfilePage from '../../(frontend)/users/[userId]/UserProfilePage'")
  })

  it('routes ID-based public profiles through the X root layout', () => {
    const route = read('src/app/(twitter-clone)/users/[userId]/page.tsx')
    const layout = read('src/app/(twitter-clone)/layout.tsx')
    expect(route).toContain("from '../../../(frontend)/users/[userId]/UserProfilePage'")
    expect(layout).toContain("import '../../styles/twitter-clone-globals.scss'")
  })

  it('serves the canonical username content routes and keeps the ID route as a redirecting compatibility entry', () => {
    const article = read('src/app/(frontend)/[username]/article/[contentId]/page.tsx')
    const post = read('src/app/(frontend)/[username]/post/[contentId]/page.tsx')
    const video = read('src/app/(frontend)/[username]/video/[contentId]/page.tsx')
    const short = read('src/app/(frontend)/[username]/short/[contentId]/page.tsx')
    const shared = read('src/app/(frontend)/content/PublicContentRoutes.tsx')
    const legacy = read('src/app/(twitter-clone)/content/[contentId]/page.tsx')
    const profile = read('src/app/(twitter-clone)/[username]/page.tsx')
    const urls = read('src/lib/public-content-url.ts')

    expect(article).toContain("routeType: 'article'")
    expect(post).toContain("routeType: 'post'")
    expect(video).toContain("routeType: 'video'")
    expect(short).toContain("routeType: 'short'")
    for (const route of [article, post, video, short]) {
      expect(route).toContain('renderCanonicalContentRoute')
      expect(route).toContain('generateCanonicalContentMetadata')
    }

    expect(shared).toContain("'/@' + encodeURIComponent(username) + '/' + segment + '/'")
    expect(shared).toContain("new Request(PUBLIC_API_ORIGIN + '/v1/contents/'")
    expect(shared).toContain("new Request(PUBLIC_API_ORIGIN + '/v1/users/'")
    expect(shared).toContain('const requestedPath =')
    expect(shared).toContain('if (requestedPath !== canonical) permanentRedirect(canonical)')
    expect(shared).not.toContain('input.contentId !== content.id')
    expect(shared).toContain("permanentRedirect(canonicalPath(author, content))")
    expect(shared).toContain('generateLegacyContentMetadata')
    expect(shared).toContain('renderLegacyContentRoute')
    expect(legacy).toContain('renderLegacyContentRoute(contentId)')
    expect(legacy).toContain('generateLegacyContentMetadata(contentId)')

    expect(profile).toContain("username.trim().replace(/^@+/, '')")
    expect(urls).toContain("return '/@' + encodeURIComponent(username) + '/' + segment + '/'")
    expect(urls).toContain("content.contentType === 'article'")
    expect(urls).toContain("options.short")
    expect(urls).not.toContain('D1Database')
    expect(shared).not.toContain('D1Database')
    expect(shared).not.toContain('getPayload')
  })
})
