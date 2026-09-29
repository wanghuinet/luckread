import { expect, test } from '@playwright/test'

test('creator center is protected by the native Payload admin login', async ({ page }) => {
  const response = await page.goto('http://127.0.0.1:3000/admin/creator-center')

  expect(response?.status()).toBeGreaterThanOrEqual(200)
  await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/)
  await expect(page.locator('input[type="email"], input[name="email"]').first()).toBeVisible()
})
