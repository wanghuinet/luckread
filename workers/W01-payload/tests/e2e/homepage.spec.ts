import { expect, test } from '@playwright/test'

test('renders the LuckRead public homepage experience', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(/LuckRead/)
  await expect(page.getByRole('heading', { name: /让好内容被看见/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /创作者中心/ })).toHaveAttribute('href', '/publish')
  await expect(page.getByRole('link', { name: /立即创作/ })).toHaveAttribute('href', '/publish')
  await expect(page.getByText('发现 · 创作 · 连接')).toBeVisible()
})
