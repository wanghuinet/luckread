import { expect, test } from '@playwright/test'

test('persists light and dark theme choices and reflects the selected document language', async ({ page, context }) => {
  await context.addCookies([{ name: 'luckread-ui-locale', value: 'zh-TW', url: 'http://127.0.0.1:3000' }])
  await page.goto('http://127.0.0.1:3000/content')

  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
  await expect(page.locator('html')).toHaveClass(/dark/)
  const toggle = page.getByTestId('theme-toggle')
  await expect(toggle).toHaveAttribute('aria-label', '切換至淺色模式')
  await toggle.click()

  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await expect(toggle).toHaveAttribute('aria-label', '切換至深色模式')
  await expect.poll(async () => context.cookies()).toContainEqual(expect.objectContaining({
    name: 'luckread-ui-theme',
    value: 'light',
  }))

  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')

  await toggle.click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
})
