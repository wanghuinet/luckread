import { expect, test } from '@playwright/test'

test('Following feed paginates without duplicating overlapping post IDs', async ({ page }) => {
  const post = (id: string) => ({
    id, slug: id, ownerUserId: 'creator-1', creatorId: 'creator-1',
    createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    contentType: 'post' as const, title: `Feed post ${id}`, mediaRefs: [], coverRef: null,
  })
  let pageRequests = 0
  await page.route('**/api/v1/feed/following**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('cursor')) {
      pageRequests += 1
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { items: [post('feed-2'), post('feed-3')], nextCursor: null, hasMore: false } }),
      })
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { items: [post('feed-1'), post('feed-2')], nextCursor: 'page-2', hasMore: true } }),
    })
  })
  await page.route('**/api/v1/contents/*/social', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: { viewer: { liked: false, favorited: false, reposted: false }, counts: { likes: 0, reposts: 0, comments: 0 } } }),
  }))
  await page.route('**/api/v1/users/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) }))

  await page.goto('http://127.0.0.1:3000/home?feed=following')
  const cards = page.getByTestId('luckread-social-post-card')
  await expect(cards).toHaveCount(2)
  await page.getByRole('button', { name: /加载更多|Load more|Loading more/i }).click()
  await expect(cards).toHaveCount(3)
  await expect(page.getByText('Feed post feed-2', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Feed post feed-3', { exact: true })).toBeVisible()
  expect(pageRequests).toBe(1)
})
