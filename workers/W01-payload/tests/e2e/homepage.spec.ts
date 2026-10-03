import { expect, test } from '@playwright/test'

test('renders the LuckRead public homepage experience', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/')

  await expect(page).toHaveTitle(/LuckRead/)
  await expect(page.locator('h1')).toContainText('让好内容被看见')
  await expect(page.getByRole('link', { name: '创作者中心', exact: true })).toHaveAttribute('href', 'https://mp.luckread.cn/')
  await expect(page.getByRole('link', { name: /立即创作/ })).toHaveAttribute('href', 'https://mp.luckread.cn/')
  await expect(page.getByText('发现 · 创作 · 连接')).toBeVisible()
})
