import { expect, test } from '@playwright/test'

const content = {
  id: 'post-1',
  slug: 'liked-by-e2e-post',
  creatorId: 'author-1',
  contentType: 'post' as const,
  state: 'PUBLISHED',
  title: 'Liked-by modal regression post',
  bodyRef: '',
  mediaRefs: [],
  coverRef: null,
  createdAt: '2026-10-19T10:00:00.000Z',
  updatedAt: '2026-10-19T10:00:00.000Z',
}

const profiles = {
  'liker-1': { id: 'liker-1', username: 'likerone', displayName: 'Liker One', avatar: null },
  'liker-2': { id: 'liker-2', username: 'likertwo', displayName: 'Liker Two', avatar: null },
  'liker-3': { id: 'liker-3', username: 'likerthree', displayName: 'Liker Three', avatar: null },
}

for (const viewport of [
  { name: 'H5', width: 390, height: 844 },
  { name: 'PC', width: 1280, height: 900 },
]) {
  test(`content likes count opens a paginated, responsive liked-by dialog on ${viewport.name}`, async ({ page }) => {
    const listRequests: string[] = []
    await page.route((url) => url.pathname.startsWith('/api/v1/'), async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname
      const fulfill = (body: unknown) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })

      if (path === '/api/v1/users/me') {
        return fulfill({ id: 'viewer-1', username: 'viewer', displayName: 'Viewer', avatar: null })
      }
      if (path === '/api/v1/contents/post-1') return fulfill(content)
      if (path === '/api/v1/contents/post-1/social') {
        return fulfill({ data: { counts: { likes: 2, comments: 0, favorites: 0, shares: 0 }, viewer: { liked: false, favorited: false }, topics: [], mentions: [] } })
      }
      if (path === '/api/v1/social/follows/author-1') {
        return fulfill({ data: { following: false, relationship: { mutualFollow: false, blocked: false, blockedBy: false, muted: false } } })
      }
      if (path === '/api/v1/contents/post-1/likes') {
        listRequests.push(url.search)
        if (url.searchParams.get('cursor') === 'likes-page-2') {
          return fulfill({ data: { items: [{ userId: 'liker-3', likedAt: '2026-10-17T10:00:00.000Z' }], nextCursor: null, hasMore: false } })
        }
        return fulfill({
          data: {
            items: [
              { userId: 'liker-1', likedAt: '2026-10-19T10:00:00.000Z' },
              { userId: 'liker-2', likedAt: '2026-10-18T10:00:00.000Z' },
            ],
            nextCursor: 'likes-page-2',
            hasMore: true,
          },
        })
      }
      const userMatch = /^\/api\/v1\/users\/([^/]+)$/.exec(path)
      if (userMatch) {
        const userId = decodeURIComponent(userMatch[1] ?? '')
        return fulfill(profiles[userId as keyof typeof profiles] ?? {
          id: userId,
          username: userId,
          displayName: userId,
          avatar: null,
        })
      }
      return fulfill({ data: {} })
    })

    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('http://127.0.0.1:3000/content/post-1')

    const countButton = page.getByRole('button', { name: '2 个赞' })
    await expect(countButton).toBeVisible()
    await countButton.click()

    const dialog = page.getByRole('dialog', { name: '点赞的人' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '点赞的人' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Liker One' })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Liker Two' })).toBeVisible()

    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        left: rect.left,
        right: rect.right,
      }
    })
    expect(bounds.left, `${viewport.name} dialog left edge`).toBeGreaterThanOrEqual(-1)
    expect(bounds.right, `${viewport.name} dialog right edge`).toBeLessThanOrEqual(bounds.viewportWidth + 1)
    expect(bounds.documentWidth, `${viewport.name} document width`).toBeLessThanOrEqual(bounds.viewportWidth + 1)

    await dialog.getByRole('button', { name: '加载更多' }).click()
    await expect(dialog.getByRole('heading', { name: 'Liker Three' })).toBeVisible()
    expect(listRequests.some((query) => query.includes('cursor=likes-page-2'))).toBe(true)

    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect(dialog).toBeHidden()
  })
}
