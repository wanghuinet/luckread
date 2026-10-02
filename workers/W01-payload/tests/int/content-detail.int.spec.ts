import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public content detail', () => {
  it('renders all published video media references', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')

    expect(page).toContain('content-detail-video-gallery')
    expect(page).toContain('content.mediaRefs.map((url, index)')
    expect(page).toContain("preload={index === 0 ? 'metadata' : 'none'}")
    expect(page).toContain('poster={index === 0 ? content.coverRef || undefined : undefined}')
  })
})

  it('hydrates like state from the authenticated status API', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')
    expect(page).toContain('/api/v1/interactions/likes?targetType=content&targetId=')
    expect(page).toContain('likeData?.data?.liked')
    expect(page).toContain('setLiked(likeData.data.liked)')
  })

  it('connects the content detail page to the authenticated like API', () => {
    const page = read('src/app/(frontend)/content/[contentId]/page.tsx')
    expect(page).toContain("fetch('/api/v1/interactions/likes'")
    expect(page).toContain("credentials: 'include'")
    expect(page).toContain("targetType: 'content'")
    expect(page).toContain("liked ? 'DELETE' : 'POST'")
  })
