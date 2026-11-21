import { createElement, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ContentLikesModal from '../../src/app/(frontend)/content/[contentId]/ContentLikesModal'

const contentId = 'content-likes-modal-test'
const requests: string[] = []

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const url = new URL(raw, 'https://luckread.test')
  requests.push(url.pathname + url.search)

  if (url.pathname === '/api/v1/contents/' + contentId + '/likes') {
    if (url.searchParams.get('cursor') === 'cursor-page-2') {
      return response({
        data: {
          items: [{ userId: 'liker-modal-three', likedAt: '2026-10-17T10:00:00.000Z' }],
          nextCursor: null,
          hasMore: false,
        },
      })
    }
    return response({
      data: {
        items: [
          { userId: 'liker-modal-one', likedAt: '2026-10-19T10:00:00.000Z' },
          { userId: 'liker-modal-two', likedAt: '2026-10-18T10:00:00.000Z' },
        ],
        nextCursor: 'cursor-page-2',
        hasMore: true,
      },
    })
  }

  const userMatch = /^\/api\/v1\/users\/([^/]+)$/.exec(url.pathname)
  if (userMatch) {
    const userId = decodeURIComponent(userMatch[1] ?? '')
    const labels: Record<string, string> = {
      'liker-modal-one': 'Liker One',
      'liker-modal-two': 'Liker Two',
      'liker-modal-three': 'Liker Three',
    }
    return response({
      id: userId,
      username: userId,
      displayName: labels[userId] ?? userId,
      avatar: null,
    })
  }

  return response({ error: { message: 'not found' } }, 404)
})

function ModalHarness() {
  const [open, setOpen] = useState(true)
  return open
    ? createElement(ContentLikesModal, {
        contentId,
        likeCount: 2,
        locale: 'zh',
        onClose: () => setOpen(false),
      })
    : null
}

describe('content liked-by modal', () => {
  beforeEach(() => {
    requests.length = 0
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('loads likers, paginates through W01, and closes accessibly', async () => {
    render(createElement(ModalHarness))

    const dialog = await screen.findByRole('dialog', { name: '点赞的人' })
    expect(dialog.className).toContain('w-full')
    expect(dialog.className).toContain('max-w-xl')
    expect(dialog.className).toContain('rounded-none')
    expect(dialog.className).toContain('sm:rounded-2xl')

    await screen.findByRole('heading', { name: 'Liker One' })
    await screen.findByRole('heading', { name: 'Liker Two' })

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await screen.findByRole('heading', { name: 'Liker Three' })
    expect(requests.some((entry) => entry.includes('cursor=cursor-page-2'))).toBe(true)

    fireEvent.keyDown(screen.getByRole('dialog', { name: '点赞的人' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '点赞的人' })).toBeNull())
  })
})
