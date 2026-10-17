import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('public username routes', () => {
  it('exposes the username profile route through the existing User authority', () => {
    const route = read('src/app/api/v1/users/by-username/[username]/route.ts')
    const profile = read('src/app/(twitter-clone)/[username]/page.tsx')
    const xLayout = read('src/app/(twitter-clone)/layout.tsx')

    expect(route).toContain("collection: 'users'")
    expect(route).toContain("where: { username: { equals: username } }")
    expect(route).toContain('overrideAccess: true')
    expect(route).toContain('cachedPublicGet')
    expect(route).toContain('enforcePublicReadRateLimit')
    expect(profile).toContain("fetchJson<PublicUserLookup>('/api/v1/users/by-username/")
    expect(profile).toContain("import UserProfilePage from '../../(frontend)/users/[userId]/page'")
    expect(xLayout).toContain("import '../../styles/twitter-clone-globals.scss'")
    expect(xLayout).toContain('<html className="dark"')
  })

  it('routes username profile works through the canonical content detail authority', () => {
    const article = read('src/app/(frontend)/[username]/article/[contentId]/page.tsx')
    const user = read('src/app/(frontend)/users/[userId]/page.tsx')

    expect(article).toContain("import { permanentRedirect } from 'next/navigation'")
    expect(article).toContain("permanentRedirect('/content/' + encodeURIComponent(contentId))")
    expect(article).not.toContain('D1Database')
    expect(article).not.toContain('getPayload')
    expect(user).toContain("return '/content/' + encodeURIComponent(item.slug || item.id)")
    expect(user).toContain("type PublicContent = {")
    expect(user).toContain("slug?: string")
  })
})
