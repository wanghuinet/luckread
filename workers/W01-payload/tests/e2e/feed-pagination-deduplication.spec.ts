import { expect, test } from '@playwright/test'

const post = (id: string) => ({
  id, slug: id, ownerUserId: 'creator-1', creatorId: 'creator-1',
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  contentType: 'post' as const, title: `Feed post ${id}`, mediaRefs: [], coverRef: null,
})

const mockSocial = async (page: import('@playwright/test').Page) => {
  await page.route('**/api/v1/contents/*/social', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: { viewer: { liked: false, favorited: false, reposted: false }, counts: { likes: 0, reposts: 0, comments: 0 } } }),
  }))
  await page.route('**/api/v1/users/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) }))
}

test('Following feed paginates without duplicating overlapping post IDs', async ({ page }) => {
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
  await mockSocial(page)
  await page.goto('http://127.0.0.1:3000/home?feed=following')
  const cards = page.getByTestId('luckread-social-post-card')
  await expect(cards).toHaveCount(2)
  await page.getByRole('button', { name: /继续滚动|加载更多|Load more|Loading more/i }).click()
  await expect(cards).toHaveCount(3)
  await expect(page.getByText('Feed post feed-2', { exact: true })).toHaveCount(1)
  await expect(page.getByText('Feed post feed-3', { exact: true })).toBeVisible()
  expect(pageRequests).toBe(1)
})

test('Following feed stops pagination when the server repeats a cursor', async ({ page }) => {
  let cursorRequests = 0
  await page.route('**/api/v1/feed/following**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('cursor')) {
      cursorRequests += 1
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { items: [post('feed-2')], nextCursor: 'page-2', hasMore: true } }),
      })
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { items: [post('feed-1')], nextCursor: 'page-2', hasMore: true } }),
    })
  })
  await mockSocial(page)
  await page.goto('http://127.0.0.1:3000/home?feed=following')
  const cards = page.getByTestId('luckread-social-post-card')
  await expect(cards).toHaveCount(1)
  await page.getByRole('button', { name: /继续滚动|加载更多|Load more|Loading more/i }).click()
  await expect(cards).toHaveCount(2)
  await expect(page.getByText('Feed post feed-2', { exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /继续滚动|加载更多|Load more|Loading more/i })).toHaveCount(0)
  expect(cursorRequests).toBe(1)
})

test('Following feed preserves existing posts and recovers after a pagination failure', async ({ page }) => {
  let cursorRequests = 0
  await page.route('**/api/v1/feed/following**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('cursor')) {
      cursorRequests += 1
      if (cursorRequests === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Temporary service failure' } }) })
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { items: [post('feed-2')], nextCursor: null, hasMore: false } }),
      })
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { items: [post('feed-1')], nextCursor: 'page-2', hasMore: true } }),
    })
  })
  await mockSocial(page)
  await page.goto('http://127.0.0.1:3000/home?feed=following')
  const cards = page.getByTestId('luckread-social-post-card')
  await expect(cards).toHaveCount(1)
  await page.getByRole('button', { name: /继续滚动|加载更多|Load more|Loading more/i }).click()
  await expect(page.getByText('Temporary service failure')).toBeVisible()
  await expect(cards).toHaveCount(1)
  await page.getByRole('button', { name: /重试|Retry/i }).click()
  await expect(cards).toHaveCount(2)
  await expect(page.getByText('Feed post feed-2', { exact: true })).toBeVisible()
  expect(cursorRequests).toBe(2)
})


test('Following feed initial unauthenticated response offers sign-in recovery', async ({ page }) => {
  await page.route('**/api/v1/feed/following**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }) }))
  await mockSocial(page)
  await page.goto('http://127.0.0.1:3000/home?feed=following')
  await expect(page.getByRole('heading', { name: /sign in to see posts|登录后查看你关注账号|登入後查看你追蹤帳號/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /sign in|登录|登入/i })).toHaveAttribute('href', /returnTo=.*home.*feed.*following/)
})
