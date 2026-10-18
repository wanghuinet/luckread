import { expect, test } from '@playwright/test'

test('keeps the public profile and timeline inside the responsive X-style center column', async ({ page }) => {
  const profile: { id: string; username: string; displayName: string; bio: string; avatar: string | null } = {
    id: 'profile-id',
    username: 'wanghui',
    displayName: 'Wang Hui',
    bio: 'Responsive profile layout test',
    avatar: null,
  }
  const post: { id: string; slug: string; creatorId: string; contentType: 'post'; title: string; mediaRefs: string[]; coverRef: string | null; createdAt: string; updatedAt: string } = {
    id: 'post-1',
    slug: 'responsive-layout-test-post',
    creatorId: profile.id,
    contentType: 'post',
    title: 'A public profile post that should remain aligned within the center timeline',
    mediaRefs: [],
    coverRef: null,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
  }

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    let body: unknown = {}

    if (path === '/api/v1/users/by-username/wanghui' || path === '/api/v1/users/profile-id') {
      body = profile
    } else if (path === '/api/v1/users/me') {
      body = { id: 'viewer-id' }
    } else if (path === '/api/v1/users/profile-id/followers' || path === '/api/v1/users/profile-id/following') {
      body = { data: { totalCount: 5 } }
    } else if (path === '/api/v1/users/profile-id/pinned-content') {
      body = { data: null }
    } else if (path === '/api/v1/social/follows/profile-id') {
      body = { data: { following: false, relationship: { mutualFollow: false, blocked: false, blockedBy: false, muted: false } } }
    } else if (path === '/api/v1/contents') {
      body = { data: { items: [post], nextCursor: null, hasMore: false } }
    } else if (path === '/api/v1/contents/post-1/social') {
      body = { data: { viewer: { liked: false, favorited: false, reposted: false }, counts: { likes: 0, reposts: 0, comments: 0 }, pinned: false } }
    } else if (path === '/api/v1/contents/post-1') {
      body = { data: { ...post, state: 'PUBLISHED', version: 1, etag: '"1"' } }
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('http://127.0.0.1:3000/wanghui')
  await expect(page.locator('#creator-profile-title')).toBeVisible()
  await expect(page.getByTestId('luckread-social-post-card')).toBeVisible()

  for (const width of [390, 500, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const bounds = await page.evaluate(() => {
      const main = document.querySelector('main.hover-animation')
      const works = document.querySelector('#works')
      const postCard = document.querySelector('[data-testid="luckread-social-post-card"]')
      if (!main || !works || !postCard) throw new Error('Profile layout elements not found')
      const mainRect = main.getBoundingClientRect()
      const worksRect = works.getBoundingClientRect()
      const postRect = postCard.getBoundingClientRect()
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainLeft: mainRect.left,
        mainRight: mainRect.right,
        worksLeft: worksRect.left,
        worksRight: worksRect.right,
        postLeft: postRect.left,
        postRight: postRect.right,
      }
    })

    expect(bounds.documentWidth, `document width at ${width}px viewport`).toBeLessThanOrEqual(bounds.viewportWidth + 1)
    expect(bounds.mainLeft, `main left edge at ${width}px viewport`).toBeGreaterThanOrEqual(-1)
    expect(bounds.mainRight, `main right edge at ${width}px viewport`).toBeLessThanOrEqual(bounds.viewportWidth + 1)
    expect(bounds.worksLeft, `works left edge at ${width}px viewport`).toBeGreaterThanOrEqual(bounds.mainLeft - 1)
    expect(bounds.worksRight, `works right edge at ${width}px viewport`).toBeLessThanOrEqual(bounds.mainRight + 1)
    expect(bounds.postLeft, `post left edge at ${width}px viewport`).toBeGreaterThanOrEqual(bounds.worksLeft - 1)
    expect(bounds.postRight, `post right edge at ${width}px viewport`).toBeLessThanOrEqual(bounds.worksRight + 1)
  }
})
