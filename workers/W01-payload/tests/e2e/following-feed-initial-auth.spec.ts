import { expect, test } from '@playwright/test'

test('Following feed initial load converts UNAUTHENTICATED response into sign-in state', async ({ page }) => {
  await page.route((url) => url.pathname.startsWith('/api/v1/'), async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/feed/following') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) })
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://127.0.0.1:3000/home?feed=following')
  await expect(page.getByRole('heading', { name: /sign in to see posts|登录后查看|登入後查看/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /sign in|登录|登入/i })).toHaveAttribute('href', /returnTo/)
})
