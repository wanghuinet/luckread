import { expect, test } from '@playwright/test'

test('renders Creator Center inside the native Payload Admin session', async ({ page }) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const email = `creator-center-${suffix}@example.com`
  const username = `creator_${suffix}`
  const password = `LuckRead-${suffix}-P@ss`

  const register = await page.request.post('http://localhost:3000/auth/register', {
    headers: {
      'Idempotency-Key': `creator-center-e2e-${suffix}`,
    },
    data: {
      identityType: 'email',
      identity: email,
      credential: password,
      username,
      consent: {
        purpose: 'ACCOUNT_REGISTRATION',
        policyVersion: 'DEV-2026-09-28.1',
      },
    },
  })

  expect(register.ok()).toBeTruthy()

  await page.goto('http://localhost:3000/admin/login')
  await page.locator('input[type="email"], input[name="email"]').first().fill(email)
  await page.locator('input[type="password"], input[name="password"]').first().fill(password)
  await page.getByRole('button', { name: /login|sign in|登录/i }).click()

  await expect(page).toHaveURL(/\/admin(?:\/)?(?:\?.*)?$/)

  await page.goto('http://localhost:3000/admin/creator-center')
  await expect(page.getByRole('heading', { name: '创作者中心' })).toBeVisible()
  await expect(page.getByText('LuckRead Creator Center')).toBeVisible()
  await expect(page.getByRole('link', { name: '发布内容' })).toHaveAttribute('href', '/publish')
  await expect(page.getByRole('link', { name: '返回 Payload Admin' })).toHaveAttribute('href', '/admin')
})
