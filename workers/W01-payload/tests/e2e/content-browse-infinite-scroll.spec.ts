import { expect, test } from '@playwright/test'

test('automatically appends the next public content page when the list sentinel enters the prefetch window', async ({ page }) => {
  const firstPageItems = Array.from({ length: 18 }, (_, index) => ({
    id: 'public-article-' + index,
    slug: 'public-article-' + index,
    contentType: 'article' as const,
    title: 'First page article ' + (index + 1),
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    coverRef: null as string | null,
  }))
  const secondPageItem = {
    id: 'public-article-next',
    slug: 'public-article-next',
    contentType: 'article' as const,
    title: 'Second page article loaded automatically',
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    coverRef: null as string | null,
  }
  let contentPageRequests = 0

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/contents') {
      contentPageRequests += 1
      const cursor = url.searchParams.get('cursor')
      const data = cursor
        ? { items: [secondPageItem], nextCursor: null, hasMore: false }
        : { items: firstPageItems, nextCursor: 'content-page-2', hasMore: true }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {} }),
    })
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://127.0.0.1:3000/content')
  await expect(page.getByRole('heading', { name: 'First page article 1' })).toBeVisible()
  await page.getByTestId('content-browse-load-more-sentinel').scrollIntoViewIfNeeded()
  await expect(page.getByRole('heading', { name: secondPageItem.title })).toBeVisible()
  expect(contentPageRequests).toBe(2)
})
