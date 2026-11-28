import { createElement, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TwitterCloneHomeFeed from '../../src/app/(twitter-clone)/TwitterCloneHomeFeed'
import { getTwitterCloneCopy } from '../../src/app/(twitter-clone)/twitter-clone-copy'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }): ReactNode => createElement('a', { href }, children),
}))

vi.mock('../../src/app/(frontend)/components/reuse/LuckReadSocialPostCard', () => ({
  default: ({ contentId }: { contentId: string }): ReactNode =>
    createElement('div', { 'data-testid': 'post-card', 'data-content-id': contentId }),
}))

const emptyPage = { items: [] as never[], nextCursor: null as string | null, hasMore: false }

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
  it('preserves the return scroll position after an initial failure and restores it after retry', async () => {
    window.history.replaceState({}, '', '/home?feed=following')
    sessionStorage.setItem('luckread:home-feed:return-scroll', JSON.stringify({
      href: '/home?feed=following',
      y: 640,
    }))
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Feed temporarily unavailable' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        items: [{ id: 'restored-post', title: 'Restored post', contentType: 'post' }],
        nextCursor: null,
        hasMore: false,
      } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

    render(createElement(TwitterCloneHomeFeed, {
      initialPage: emptyPage,
      locale: 'en',
      feedMode: 'following',
    }))

    await screen.findByText('Feed temporarily unavailable')
    expect(sessionStorage.getItem('luckread:home-feed:return-scroll')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: getTwitterCloneCopy('en').feed.retry }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: 'auto' }))
    await waitFor(() => expect(sessionStorage.getItem('luckread:home-feed:return-scroll')).toBeNull())
    scrollTo.mockRestore()
  })

  it('switches to sign-in recovery when Following pagination loses authentication', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        items: [{ id: 'followed-post', title: 'Existing post', contentType: 'post' }],
        nextCursor: 'cursor-page-2',
        hasMore: true,
      } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }))

    render(createElement(TwitterCloneHomeFeed, {
      initialPage: {
        items: [{ id: 'followed-post', title: 'Existing post', contentType: 'post' }],
        nextCursor: 'cursor-page-2',
        hasMore: true,
      },
      locale: 'en',
      feedMode: 'following',
    }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const loadMoreButton = screen.getByRole('button', { name: getTwitterCloneCopy('en').feed.loadingMore }) as HTMLButtonElement
    await waitFor(() => expect(loadMoreButton.disabled).toBe(false))
    fireEvent.click(loadMoreButton)

    await screen.findByRole('heading', {
      name: 'Sign in to see posts from accounts you follow',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/feed/following?limit=20&cursor=cursor-page-2')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      credentials: 'include',
      cache: 'no-store',
    })
    expect(screen.queryByRole('button', { name: getTwitterCloneCopy('en').feed.loadingMore })).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toContain('/login?returnTo=')
  })

  it('deduplicates repeated post IDs and stops when pagination returns an already requested cursor', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: {
      items: [
        { id: 'existing-post', title: 'Duplicate existing post', contentType: 'post' },
        { id: 'new-post', title: 'New post', contentType: 'post' },
      ],
      nextCursor: 'cursor-page-2',
      hasMore: true,
    } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    render(createElement(TwitterCloneHomeFeed, {
      initialPage: {
        items: [{ id: 'existing-post', title: 'Existing post', contentType: 'post' }],
        nextCursor: 'cursor-page-2',
        hasMore: true,
      },
      locale: 'en',
      feedMode: 'for-you',
    }))

    fireEvent.click(screen.getByRole('button', { name: getTwitterCloneCopy('en').feed.loadingMore }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getAllByTestId('post-card')).toHaveLength(2))
    expect(screen.getAllByTestId('post-card').map(card => card.getAttribute('data-content-id'))).toEqual([
      'existing-post',
      'new-post',
    ])
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/contents?limit=20&cursor=cursor-page-2')
    await waitFor(() => expect(screen.queryByRole('button', { name: getTwitterCloneCopy('en').feed.loadingMore })).toBeNull())
  })

})
