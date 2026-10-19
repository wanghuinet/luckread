import { expect, test } from '@playwright/test'

test('renders the Following timeline without horizontal overflow on H5 and PC widths', async ({ page }) => {
  const post = {
    id: 'following-post-1',
    slug: 'following-timeline-regression-post',
    ownerUserId: 'creator-1',
    creatorId: 'creator-1',
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
    contentType: 'post' as const,
    title: 'Following timeline regression post',
    mediaRefs: [],
    coverRef: null,
  }

  await page.route((url) => url.pathname.startsWith('/api/v1/'), async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/feed/following') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { items: [post], nextCursor: null, hasMore: false, candidateWindowTruncated: false },
        }),
      })
      return
    }
    if (url.pathname === '/api/v1/contents/following-post-1/social') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            viewer: { liked: false, favorited: false, reposted: false },
            counts: { likes: 0, reposts: 0, comments: 0 },
            pinned: false,
          },
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) })
  })

  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('http://127.0.0.1:3000/home?feed=following')
  const postCard = page.getByTestId('luckread-social-post-card')
  await expect(postCard).toBeVisible()
  await expect(postCard.getByText(post.title, { exact: true })).toBeVisible()

  for (const width of [390, 500, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const bounds = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="luckread-social-post-card"]')
      if (!card) throw new Error('Following timeline post card not found')
      const rect = card.getBoundingClientRect()
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        cardLeft: rect.left,
        cardRight: rect.right,
      }
    })

    expect(bounds.documentWidth, `document width at ${width}px viewport`).toBeLessThanOrEqual(bounds.viewportWidth + 1)
    expect(bounds.cardLeft, `post left edge at ${width}px viewport`).toBeGreaterThanOrEqual(-1)
    expect(bounds.cardRight, `post right edge at ${width}px viewport`).toBeLessThanOrEqual(bounds.viewportWidth + 1)
  }
})
