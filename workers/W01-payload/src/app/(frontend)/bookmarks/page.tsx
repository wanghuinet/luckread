'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import PublicLanguageToggle, { usePublicLocale } from '../i18n/PublicLanguageToggle'
import LuckReadSocialPostCard from '../components/reuse/LuckReadSocialPostCard'
import ArticleSummaryPreview from '../../../components/ArticleSummaryPreview.js'

type ContentType = 'article' | 'post' | 'video'

type BookmarkItem = {
  id: string
  slug?: string
  ownerUserId?: string
  creatorId?: string | null
  createdAt?: string
  updatedAt?: string
  contentType: ContentType
  title: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
}

type BookmarkPage = {
  items: BookmarkItem[]
  nextCursor: string | null
  hasMore: boolean
}

type BookmarkResponse = {
  data?: BookmarkPage
  error?: { message?: string } | null
}

export default function BookmarksPage() {
  const locale = usePublicLocale()
  const [page, setPage] = useState<BookmarkPage>({ items: [], nextCursor: null, hasMore: false })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')
  const [authRequired, setAuthRequired] = useState(false)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const labels = {
    title: locale === 'en' ? 'Bookmarks' : locale === 'tw' ? '已收藏' : '我的收藏',
    eyebrow: locale === 'en' ? 'YOUR READING LIST' : locale === 'tw' ? '你的收藏清單' : '我的内容收藏',
    description: locale === 'en'
      ? 'Posts, articles, and videos you saved for later.'
      : locale === 'tw' ? '稍後想再閱讀的動態、文章與影片。' : '把收藏的动态、文章和视频集中在这里，方便稍后继续阅读。',
    remove: locale === 'en' ? 'Remove saved item' : locale === 'tw' ? '取消收藏' : '取消收藏',
    removing: locale === 'en' ? 'Removing…' : locale === 'tw' ? '取消中…' : '取消中…',
    open: locale === 'en' ? 'Open content ↗' : locale === 'tw' ? '開啟內容 ↗' : '打开内容 ↗',
    empty: locale === 'en'
      ? 'Nothing saved yet. Bookmark a post, article, or video to find it here.'
      : locale === 'tw' ? '目前還沒有收藏。收藏動態、文章或影片後，就會出現在這裡。' : '你还没有收藏内容。点击动态、文章或视频上的收藏按钮，它们就会出现在这里。',
    errorFallback: locale === 'en' ? 'Your bookmarks could not be loaded.' : locale === 'tw' ? '無法載入收藏。' : '收藏列表加载失败，请稍后重试。',
    removeError: locale === 'en' ? 'Could not remove this bookmark.' : locale === 'tw' ? '取消收藏失敗，請稍後再試。' : '取消收藏失败，请稍后重试。',
    loading: locale === 'en' ? 'Loading bookmarks…' : locale === 'tw' ? '正在載入收藏…' : '正在加载收藏…',
    more: locale === 'en' ? 'Load more' : locale === 'tw' ? '載入更多' : '加载更多',
    loadingMore: locale === 'en' ? 'Loading…' : locale === 'tw' ? '載入中…' : '加载中…',
    retry: locale === 'en' ? 'Try again' : locale === 'tw' ? '重新載入' : '重新加载',
    login: locale === 'en' ? 'Sign in' : locale === 'tw' ? '登入' : '登录',
    loginMessage: locale === 'en'
      ? 'Sign in to view your bookmarks.'
      : locale === 'tw' ? '登入後即可查看你的收藏。' : '登录后即可查看你收藏的内容。',
    discover: locale === 'en' ? 'Discover content' : locale === 'tw' ? '探索內容' : '去发现内容',
    summary: locale === 'en' ? 'Summary' : '文章摘要',
  }

  const load = useCallback(async (cursor: string | null): Promise<void> => {
    const requestId = ++requestIdRef.current
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError('')
    setAuthRequired(false)

    try {
      const params = new URLSearchParams({ list: 'true', limit: '18' })
      if (cursor) params.set('cursor', cursor)
      const { response, data } = await fetchJson<BookmarkResponse>(
        '/api/v1/interactions/bookmarks?' + params.toString(),
        {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        },
      )
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (response.status === 401) {
        setAuthRequired(true)
        setError(labels.loginMessage)
        return
      }
      if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
        throw new Error(getApiErrorMessage(data, labels.errorFallback))
      }

      const incoming = data.data
      setPage((current) => {
        if (!cursor) return incoming
        const known = new Set(current.items.map((item) => item.id))
        return {
          items: [...current.items, ...incoming.items.filter((item) => !known.has(item.id))],
          nextCursor: incoming.nextCursor ?? null,
          hasMore: incoming.hasMore === true,
        }
      })
    } catch (cause) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : labels.errorFallback)
    } finally {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      setLoading(false)
      setLoadingMore(false)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    }
  }, [labels.errorFallback, labels.loginMessage])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(null)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      requestIdRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [load])

  const removeFromPage = (contentId: string) => {
    setPage((current) => ({ ...current, items: current.items.filter((item) => item.id !== contentId) }))
  }

  const removeBookmark = async (item: BookmarkItem) => {
    if (removingIds.has(item.id)) return
    setRemovingIds((current) => new Set(current).add(item.id))
    setError('')
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>(
        '/api/v1/interactions/bookmarks',
        {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': 'luckread-bookmark-list-remove:' + crypto.randomUUID(),
          },
          body: JSON.stringify({ targetType: 'content', targetId: item.id }),
          cache: 'no-store',
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) throw new Error(getApiErrorMessage(data, labels.removeError))
      removeFromPage(item.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.removeError)
    } finally {
      setRemovingIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  return (
    <main className="content-browse">
      <header className="content-browse-top">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1>{labels.title}</h1>
          <p>{labels.description}</p>
        </div>
        <div className="content-browse-actions">
          <Link className="button button-quiet" href="/">{locale === 'en' ? 'Home' : locale === 'tw' ? '首頁' : '返回首页'}</Link>
          <Link className="button button-quiet" href="/content">{labels.discover}</Link>
          <PublicLanguageToggle locale={locale} />
        </div>
      </header>

      {loading ? (
        <>
          <div className="content-browse-state" role="status">{labels.loading}</div>
          <section className="content-browse-grid" aria-label={labels.loading} aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="content-feed-card content-feed-card-skeleton" key={index} aria-hidden="true">
                <div className="content-feed-cover content-feed-skeleton-block" />
                <div className="content-feed-body">
                  <span className="content-feed-skeleton-line content-feed-skeleton-line-short" />
                  <span className="content-feed-skeleton-line content-feed-skeleton-line-title" />
                  <span className="content-feed-skeleton-line content-feed-skeleton-line-title" />
                  <span className="content-feed-skeleton-line content-feed-skeleton-line-meta" />
                </div>
              </div>
            ))}
          </section>
        </>
      ) : null}

      {!loading && error ? (
        <div className="content-browse-state" role="status">
          <p>{error}</p>
          {authRequired ? (
            <Link className="button button-primary" href={'/login?returnTo=' + encodeURIComponent('/bookmarks')}>{labels.login}</Link>
          ) : (
            <button className="button button-quiet" type="button" onClick={() => void load(null)}>{labels.retry}</button>
          )}
        </div>
      ) : null}

      {!loading && !error && page.items.length === 0 && !page.hasMore ? (
        <div className="content-browse-state">
          <p>{labels.empty}</p>
          <Link className="button button-primary" href="/content">{labels.discover}</Link>
        </div>
      ) : null}

      {!loading && !error && page.items.length === 0 && page.hasMore && page.nextCursor ? (
        <div className="content-browse-state">
          <p>{locale === 'en' ? 'Checking more saved items…' : locale === 'tw' ? '正在查看更多收藏…' : '当前页没有可展示的已发布内容，还可以继续查看后续收藏。'}</p>
          <button className="button button-quiet" type="button" disabled={loadingMore} onClick={() => void load(page.nextCursor)}>
            {loadingMore ? labels.loadingMore : labels.more}
          </button>
        </div>
      ) : null}

      {!loading && page.items.length > 0 ? (
        <>
          <section className="content-browse-grid" aria-label={labels.title}>
            {page.items.map((item) => {
              if (item.contentType === 'post') {
                return (
                  <LuckReadSocialPostCard
                    key={item.id}
                    contentId={item.id}
                    slug={item.slug}
                    title={item.title}
                    creatorId={item.creatorId}
                    coverRef={item.coverRef}
                    mediaRefs={item.mediaRefs}
                    createdAt={item.createdAt}
                    updatedAt={item.updatedAt}
                    locale={locale}
                    onBookmarkChanged={(bookmarked) => {
                      if (!bookmarked) removeFromPage(item.id)
                    }}
                  />
                )
              }

              const cover = item.coverRef
              const href = '/content/' + encodeURIComponent(item.slug || item.id)
              return (
                <article className="content-feed-card" key={item.id}>
                  <div className="content-feed-cover">
                    {cover ? (
                      item.contentType === 'video' ? (
                        <video aria-label={item.title} controls muted playsInline preload="metadata" src={cover} />
                      ) : (
                        <img alt={item.title ? item.title + (locale === 'en' ? ' cover' : '封面') : labels.title} loading="lazy" src={cover} />
                      )
                    ) : (
                      <span>{item.contentType.toUpperCase()}</span>
                    )}
                  </div>
                  <div className="content-feed-body">
                    <div className="content-feed-meta">
                      <span>{item.contentType === 'article' ? (locale === 'en' ? 'Article' : locale === 'tw' ? '文章' : '文章') : (locale === 'en' ? 'Video' : locale === 'tw' ? '影片' : '视频')}</span>
                      <time dateTime={item.createdAt || item.updatedAt || undefined}>{item.createdAt ? new Date(item.createdAt).toLocaleDateString(locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN') : ''}</time>
                    </div>
                    <h2>{item.title}</h2>
                    {item.contentType === 'article' ? (
                      <ArticleSummaryPreview
                        key={item.bodyRef || item.id}
                        bodyRef={item.bodyRef}
                        label={labels.summary}
                      />
                    ) : null}
                    <div className="content-browse-actions">
                      <Link className="content-feed-open" href={href}>{labels.open}</Link>
                      <button
                        className="content-detail-like"
                        type="button"
                        disabled={removingIds.has(item.id)}
                        onClick={() => void removeBookmark(item)}
                      >
                        {removingIds.has(item.id) ? labels.removing : labels.remove}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </section>
          {page.hasMore && page.nextCursor && !error ? (
            <div className="content-browse-more">
              <button
                aria-busy={loadingMore}
                className="button button-quiet"
                disabled={loadingMore}
                onClick={() => void load(page.nextCursor)}
                type="button"
              >
                {loadingMore ? labels.loadingMore : labels.more}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  )
}
