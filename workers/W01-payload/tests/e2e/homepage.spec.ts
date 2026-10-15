import { expect, test } from '@playwright/test'

test('renders the Twitter Clone-inspired LuckRead public landing', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/')

  await expect(page).toHaveTitle(/LuckRead/)
  await expect(page.getByRole('heading', { name: 'Happening now' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign up with email' })).toHaveAttribute('href', '/register')
  await expect(page.locator('a[href="/login"]').first()).toHaveAttribute('href', '/login')
  await expect(page.getByRole('link', { name: 'Explore', exact: true })).toHaveAttribute('href', '/content')
  await expect(page.getByRole('link', { name: 'Short videos', exact: true })).toHaveAttribute('href', '/shorts')
  await expect(page.getByRole('link', { name: 'Creator Studio', exact: true })).toHaveAttribute('href', '/creator-center')
})
