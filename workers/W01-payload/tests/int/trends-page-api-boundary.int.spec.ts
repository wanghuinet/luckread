import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('trends server-rendered public API boundary', () => {
  it('loads discovery topics through the canonical W01 endpoint and shared transport', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(twitter-clone)/trends/page.tsx'),
      'utf8',
    )

    expect(page).toContain("import { fetchJson } from '../../../lib/client-api.js'")
    expect(page).toContain("PUBLIC_API_ORIGIN = 'https://api.luckread.com'")
    expect(page).toContain("PUBLIC_API_ORIGIN + '/v1/discovery/topics?'")
    expect(page).toContain('fetchJson<{ data?: DiscoveryTopicPageData }>(request)')
    expect(page).toContain("cache: 'no-store'")
    expect(page).not.toContain('callW05SocialPublic')
    expect(page).not.toContain('w05-social-client')
    expect(page).not.toContain('cachedPublicGet')
    expect(page).not.toContain('enforcePublicReadRateLimit')
    expect(page).not.toContain('/internal/social/discovery/topics')
  })
})
