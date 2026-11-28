import { expect, test } from '@playwright/test'

test('supports keyboard notification tabs and stops a repeated pagination cursor', async ({ page }) => {
  const requestedCursors: string[] = []
  await page.route('**/api/v1/notifications*', async (route) => {
    const url = new URL(route.request().url())
    const cursor = url.searchParams.get('cursor')
    requestedCursors.push(cursor ?? 'first-page')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          items: [],
          unreadCount: 0,
          nextCursor: cursor ? cursor : 'cursor-a',
          hasMore: true,
        },
      }),
    })
  })

  await page.goto('http://127.0.0.1:3000/notifications')
  const allTab = page.getByRole('tab', { name: '全部' })
  const mentionsTab = page.getByRole('tab', { name: '提及' })
  const panel = page.getByRole('tabpanel')

  await expect(allTab).toHaveAttribute('tabindex', '0')
  await expect(mentionsTab).toHaveAttribute('tabindex', '-1')
  await expect(panel).toHaveAttribute('aria-labelledby', 'notifications-tab-all')

  await allTab.focus()
  await page.keyboard.press('End')
  await expect(mentionsTab).toBeFocused()
  await expect(mentionsTab).toHaveAttribute('aria-selected', 'true')
  await expect(allTab).toHaveAttribute('tabindex', '-1')
  await expect(panel).toHaveAttribute('aria-labelledby', 'notifications-tab-mentions')

  await page.keyboard.press('Home')
  await expect(allTab).toBeFocused()
  await expect(allTab).toHaveAttribute('aria-selected', 'true')

  const loadMore = page.getByRole('button', { name: '加载更多' })
  await expect(loadMore).toBeVisible()
  await loadMore.click()
  await expect(loadMore).toHaveCount(0)
  expect(requestedCursors).toEqual(['first-page', 'cursor-a'])
})
