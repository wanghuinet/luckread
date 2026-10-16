import { expect, test } from '@playwright/test'

test('renders the reused Twitter Clone landing experience on LuckRead', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/')

  await expect(page).toHaveTitle(/LuckRead/)
  await expect(page.getByRole('heading', { level: 1, name: '正在发生的事' })).toBeVisible()
  await expect(page.getByRole('link', { name: '使用邮箱注册' })).toHaveAttribute('href', '/register')
  await expect(page.getByRole('link', { name: '登录' }).first()).toHaveAttribute('href', '/login')
  await expect(page.getByRole('link', { name: '发现内容' })).toHaveAttribute('href', '/content')
})
