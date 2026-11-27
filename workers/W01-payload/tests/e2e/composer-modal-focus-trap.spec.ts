import { expect, test } from '@playwright/test'

test('keeps keyboard focus inside the post composer modal and restores it on close', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://127.0.0.1:3000/home')
  const trigger = page.locator('button[aria-haspopup="dialog"]').first()
  await expect(trigger).toBeVisible()
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const textarea = dialog.locator('textarea').first()
  await expect(textarea).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await expect(dialog).toContainElement(page.locator(':focus'))

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})
