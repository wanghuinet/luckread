import { expect, test, type Page } from '@playwright/test'

type AudienceChoice = {
  optionLabel: string
  summaryLabel: string
}

const audienceChoices: AudienceChoice[] = [
  { optionLabel: '每个人', summaryLabel: '所有人可以回复' },
  { optionLabel: '认证账号', summaryLabel: '认证账号可以回复' },
  { optionLabel: '你关注的账号', summaryLabel: '你关注的账号可以回复' },
  { optionLabel: '只有你提及的账号', summaryLabel: '只有你提及的账号可以回复' },
  {
    optionLabel: '你关注的账号及其关注的账号',
    summaryLabel: '你关注的账号及其关注的账号可以回复',
  },
]

async function installApiMocks(page: Page) {
  const operations: string[] = []
  const policyWrites: Array<{ replyAudience: string; text: string }> = []
  let draftVersion = 1

  await page.route((url) => url.pathname.startsWith('/api/v1/'), async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const fulfillJson = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (path === '/api/v1/users/me') {
      return fulfillJson({
        id: 'reply-audience-viewer',
        username: 'reply-audience-viewer',
        displayName: 'Reply Audience Test',
        avatar: null,
      })
    }

    if (path === '/api/v1/feed/following') {
      return fulfillJson({
        data: { items: [], nextCursor: null, hasMore: false, candidateWindowTruncated: false },
      })
    }

    if (path === '/api/v1/media' && method === 'POST') {
      return fulfillJson({
        doc: {
          id: 'reply-audience-body-asset',
          url: 'https://assets.example.test/reply-audience-body.txt',
          filename: 'reply-audience-body.txt',
        },
      })
    }

    if (path === '/api/v1/contents' && (method === 'POST' || method === 'PATCH')) {
      if (method === 'PATCH') draftVersion += 1
      operations.push('content-save')
      const payload = request.postDataJSON() as {
        title?: string
        bodyRef?: string
        mediaRefs?: string[]
        coverRef?: string | null
      }
      return fulfillJson({
        id: 'reply-audience-e2e-content',
        slug: 'reply-audience-e2e-content',
        state: 'DRAFT',
        version: draftVersion,
        etag: 'reply-audience-etag-' + draftVersion,
        contentType: 'post',
        title: payload.title ?? 'Reply audience regression',
        bodyRef: payload.bodyRef ?? 'https://assets.example.test/reply-audience-body.txt',
        mediaRefs: payload.mediaRefs ?? [],
        coverRef: payload.coverRef ?? null,
      })
    }

    const audienceMatch = /^\/api\/v1\/contents\/([^/]+)\/reply-audience$/.exec(path)
    if (audienceMatch && method === 'PUT') {
      const payload = request.postDataJSON() as { replyAudience: string; text: string }
      policyWrites.push(payload)
      operations.push('reply-audience')
      return fulfillJson({ data: { replyAudience: payload.replyAudience } })
    }

    if (/^\/api\/v1\/contents\/[^/]+\/state$/.test(path) && method === 'POST') {
      operations.push('publish')
      return fulfillJson({
        to: 'PUBLISHED',
        version: draftVersion + 1,
        etag: 'reply-audience-etag-published',
      })
    }

    return fulfillJson({ data: {} })
  })

  return { operations, policyWrites }
}

for (const viewport of [
  { name: 'H5', width: 390, height: 844 },
  { name: 'PC', width: 1280, height: 900 },
]) {
  test(`reply audience modal selects and saves a policy on ${viewport.name}`, async ({ page }) => {
    const { operations, policyWrites } = await installApiMocks(page)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('http://127.0.0.1:3000/home?feed=following')

    const postTriggers = page.locator('button[aria-haspopup="dialog"]')
    let triggerClicked = false
    for (let index = 0; index < await postTriggers.count(); index += 1) {
      const trigger = postTriggers.nth(index)
      if (await trigger.isVisible()) {
        await trigger.click()
        triggerClicked = true
        break
      }
    }
    expect(triggerClicked, 'a visible X-style post trigger should be available').toBe(true)

    const composer = page.getByRole('dialog', { name: '发布动态窗口' })
    await expect(composer).toBeVisible()
    let currentSummaryLabel = '所有人可以回复'

    // Verify all five options remain usable in both the compact mobile sheet
    // and the centered desktop dialog, without the selector extending off-screen.
    for (const choice of audienceChoices) {
      await composer.getByRole('button', { name: currentSummaryLabel }).click()
      const selector = page.getByRole('dialog', { name: '谁可以回复？' })
      await expect(selector).toBeVisible()

      const bounds = await selector.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          viewportWidth: document.documentElement.clientWidth,
          left: rect.left,
          right: rect.right,
        }
      })
      expect(bounds.left, 'reply audience sheet left edge').toBeGreaterThanOrEqual(-1)
      expect(bounds.right, 'reply audience sheet right edge').toBeLessThanOrEqual(bounds.viewportWidth + 1)

      await selector.getByRole('button', { name: new RegExp(choice.optionLabel) }).click()
      await expect(composer.getByRole('button', { name: choice.summaryLabel })).toBeVisible()
      currentSummaryLabel = choice.summaryLabel
    }

    // Publish once through the real composer path to verify the selected policy
    // is written before the post transitions to PUBLISHED.
    const finalChoice = audienceChoices[audienceChoices.length - 1]
    await composer.getByRole('textbox', { name: '推文正文' }).fill('Reply audience permission regression test')
    await composer.getByRole('button', { name: '发帖', exact: true }).click()

    await expect(composer.getByText('动态已发布，已进入公开信息流。')).toBeVisible()
    expect(policyWrites.length).toBeGreaterThan(0)
    expect(policyWrites[policyWrites.length - 1]).toMatchObject({
      replyAudience: 'followingNetwork',
      text: 'Reply audience permission regression test',
    })
    expect(await composer.getByRole('button', { name: finalChoice.summaryLabel }).isVisible()).toBe(true)

    const policyWriteIndex = operations.lastIndexOf('reply-audience')
    const publishIndex = operations.lastIndexOf('publish')
    expect(policyWriteIndex).toBeGreaterThanOrEqual(0)
    expect(publishIndex).toBeGreaterThan(policyWriteIndex)
  })
}
