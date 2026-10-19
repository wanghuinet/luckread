'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchJson } from '../../../../lib/client-api.js'
import type { PublicLocale } from '../../i18n/public-locale'
import TwitterCloneFollowRow from '../../users/TwitterCloneFollowRow'

type Liker = {
  userId: string
  likedAt: string
}

type LikerPageResponse = {
  data?: {
    items?: Liker[]
    nextCursor?: string | null
    hasMore?: boolean
  }
  error?: { message?: string }
}

type Props = {
  open: boolean
  contentId: string
  likeCount: number | null
  locale: PublicLocale
  onClose: () => void
}

const copyFor = (locale: PublicLocale) => locale === 'en'
  ? {
      title: 'Liked by',
      close: 'Close',
      loading: 'Loading likes…',
      empty: 'No likes yet.',
      loadMore: 'Load more',
      loadingMore: 'Loading…',
      error: 'Could not load likes. Please try again.',
      count: (count: number) => count === 1 ? '1 like' : `${count.toLocaleString('en-US')} likes`,
      likedAt: 'Liked on',
    }
  : locale === 'tw'
    ? {
        title: '按讚者',
        close: '關閉',
        loading: '正在載入按讚名單…',
        empty: '還沒有人按讚。',
        loadMore: '載入更多',
        loadingMore: '載入中…',
        error: '暫時無法載入按讚名單，請稍後重試。',
        count: (count: number) => `${count.toLocaleString('zh-TW')} 個讚`,
        likedAt: '按讚於',
      }
    : {
        title: '点赞的人',
        close: '关闭',
        loading: '正在加载点赞名单…',
        empty: '还没有人点赞。',
        loadMore: '加载更多',
        loadingMore: '加载中…',
        error: '暂时无法加载点赞名单，请稍后重试。',
        count: (count: number) => `${count.toLocaleString('zh-CN')} 个赞`,
        likedAt: '点赞于',
      }

export default function ContentLikesModal({ open, contentId, likeCount, locale, onClose }: Props) {
  const copy = copyFor(locale)
  const [items, setItems] = useState<Liker[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const requestControllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!open) return
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    const requestId = ++requestIdRef.current
    let cancelled = false

    setItems([])
    setNextCursor(null)
    setHasMore(false)
    setError('')
    setLoading(true)
    setLoadingMore(false)

    void (async () => {
      try {
        const query = new URLSearchParams({ limit: '20' })
        const { response, data } = await fetchJson<LikerPageResponse>(
          '/api/v1/contents/' + encodeURIComponent(contentId) + '/likes?' + query.toString(),
          {
            credentials: 'include',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          },
        )
        if (!response.ok || !Array.isArray(data?.data?.items)) throw new Error('LIKERS_LOAD_FAILED')
        if (cancelled || requestId !== requestIdRef.current || controller.signal.aborted) return
        setItems(data.data.items)
        setNextCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
        setHasMore(data.data.hasMore === true)
      } catch (cause) {
        if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return
        if (!cancelled && requestId === requestIdRef.current) setError(copy.error)
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      requestIdRef.current += 1
      requestControllerRef.current?.abort()
      requestControllerRef.current = null
    }
  }, [open, contentId, copy.error])

  async function loadMore() {
    if (loading || loadingMore || !hasMore || !nextCursor) return
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    const requestId = ++requestIdRef.current
    setLoadingMore(true)
    setError('')
    try {
      const query = new URLSearchParams({ limit: '20', cursor: nextCursor })
      const { response, data } = await fetchJson<LikerPageResponse>(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/likes?' + query.toString(),
        {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        },
      )
      if (!response.ok || !Array.isArray(data?.data?.items)) throw new Error('LIKERS_LOAD_FAILED')
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      setItems((current) => {
        const known = new Set(current.map((item) => item.userId + ':' + item.likedAt))
        return [...current, ...data.data!.items!.filter((item) => !known.has(item.userId + ':' + item.likedAt))]
      })
      setNextCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
      setHasMore(data.data.hasMore === true)
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) return
      if (requestId === requestIdRef.current) setError(copy.error)
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-0 py-0 sm:px-4 sm:py-8"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <section
        aria-labelledby="content-likes-title"
        aria-modal="true"
        className="flex h-[min(82vh,672px)] max-h-[672px] w-full max-w-xl flex-col overflow-hidden rounded-none border border-light-border bg-main-background shadow-xl dark:border-dark-border sm:rounded-2xl"
        role="dialog"
      >
        <header className="flex shrink-0 items-center gap-4 border-b border-light-border px-4 py-3 dark:border-dark-border">
          <button
            aria-label={copy.close}
            autoFocus
            className="main-tab grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl hover:bg-light-primary/10 dark:hover:bg-dark-primary/10"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold" id="content-likes-title">{copy.title}</h2>
            {typeof likeCount === 'number' ? (
              <p className="mt-0.5 text-xs text-light-secondary dark:text-dark-secondary">{copy.count(likeCount)}</p>
            ) : null}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-light-secondary dark:text-dark-secondary" role="status">{copy.loading}</p>
          ) : null}
          {!loading && items.length === 0 && !error ? (
            <p className="px-4 py-8 text-center text-sm text-light-secondary dark:text-dark-secondary">{copy.empty}</p>
          ) : null}
          {error ? (
            <p className="px-4 py-4 text-sm text-light-secondary dark:text-dark-secondary" role="alert">{error}</p>
          ) : null}
          {items.map((item) => (
            <TwitterCloneFollowRow
              key={item.userId + ':' + item.likedAt}
              userId={item.userId}
              followedAt={item.likedAt}
              dateLabel={copy.likedAt}
              presentation="x-timeline"
              locale={locale}
            />
          ))}
          {hasMore && nextCursor ? (
            <div className="flex justify-center px-4 py-4">
              <button
                className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                type="button"
              >
                {loadingMore ? copy.loadingMore : copy.loadMore}
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
