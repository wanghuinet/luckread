import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TwitterCloneHomeFeed from '../../src/app/(twitter-clone)/TwitterCloneHomeFeed'
import { getTwitterCloneCopy } from '../../src/app/(twitter-clone)/twitter-clone-copy'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => createElement('a', { href }, children),
}))

vi.mock('../../src/app/(frontend)/components/reuse/LuckReadSocialPostCard', () => ({
  default: () => null,
}))

const emptyPage = { items: [], nextCursor: null, hasMore: false }

describe('H5 home feed initial-load recovery', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('distinguishes a failed For You first-page request from a genuinely empty timeline and retries it', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: emptyPage }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    render(createElement(TwitterCloneHomeFeed, {
      initialPage: { ...emptyPage, initialLoadError: true },
      locale: 'en',
      feedMode: 'for-you',
    }))

    expect(screen.getByText(getTwitterCloneCopy('en').feed.loadError)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: getTwitterCloneCopy('en').feed.retry }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/contents?limit=20')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', cache: 'no-store' })
    await screen.findByRole('heading', { name: getTwitterCloneCopy('en').feed.noPublicContent })
    expect(screen.queryByText(getTwitterCloneCopy('en').feed.loadError)).toBeNull()
  })
})
