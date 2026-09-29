import { expect, test } from '@playwright/test'

test('renders the LuckRead public homepage experience', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/')

  await expect(page).toHaveTitle(/LuckRead/)
  console.log('HOMEPAGE_BODY_START')
  console.log((await page.locator('body').innerText()).slice(0, 5000))
  console.log('HOMEPAGE_BODY_END')
  await expect(page.getByRole('heading', { name: /让好内容被看见/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /创作者中心/ })).toHaveAttribute('href', '/publish')
  await expect(page.getByRole('link', { name: /立即创作/ })).toHaveAttribute('href', '/publish')
  await expect(page.getByText('发现 · 创作 · 连接')).toBeVisible()
})
