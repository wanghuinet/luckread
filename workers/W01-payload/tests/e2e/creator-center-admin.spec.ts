import { expect, test } from '@playwright/test'

test('renders Creator Center inside the native Payload Admin session', async ({ page }) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const email = `creator-center-${suffix}@example.com`
  const password = `LuckRead-${suffix}-P@ss`

  const createUser = await page.request.post('http://127.0.0.1:3000/api/users', {
    data: {
      email,
      password,
      username: `creator_${suffix}`,
      displayName: 'Creator Center E2E',
      locale: 'zh-CN',
      timezone: 'UTC',
    },
  })

  expect(createUser.ok()).toBeTruthy()

  await page.goto('http://127.0.0.1:3000/admin/login')
  await page.locator('input[type="email"], input[name="email"]').first().fill(email)
  await page.locator('input[type="password"], input[name="password"]').first().fill(password)
  await page.getByRole('button', { name: /login|sign in|登录/i }).click()

  await expect(page).toHaveURL(/\/admin(?:\/)?(?:\?.*)?$/)

  await page.goto('http://127.0.0.1:3000/admin/creator-center')
  await expect(page.getByRole('heading', { name: '创作者中心' })).toBeVisible()
  await expect(page.getByText('LuckRead Creator Center')).toBeVisible()
  await expect(page.getByRole('link', { name: '发布内容' })).toHaveAttribute('href', '/publish')
  await expect(page.getByRole('link', { name: '返回 Payload Admin' })).toHaveAttribute('href', '/admin')
})
