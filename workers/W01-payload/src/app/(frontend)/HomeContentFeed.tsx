'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { getPublicCopy, type PublicLocale } from './i18n/public-locale'
import { fetchJson } from '../../lib/client-api.js'
import LuckReadSocialPostCard from './components/reuse/LuckReadSocialPostCard'
import ArticleSummaryPreview from '../../components/ArticleSummaryPreview.js'

type ContentType = 'article' | 'post' | 'video'

type PublicAuthor = {
  id: string
  username?: string
  displayName?: string | null
  avatar?: string | null
}

type ContentItem = {
  id: string
  slug?: string
  ownerUserId?: string | null
  creatorId?: string | null
  creator?: PublicAuthor | null
  author?: PublicAuthor | null
  createdAt?: string
  contentType: ContentType
  title: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

type Page = {
  items: ContentItem[]
  nextCursor?: string | null
  hasMore?: boolean
  candidateWindowTruncated?: boolean
}

export default function HomeContentFeed({
  locale = 'zh',
  initialItems,
}: {
  locale?: PublicLocale
  initialItems?: ContentItem[]
}) {
  const copy = getPublicCopy(locale)
  const typeLabels: Record<ContentType, string> = {
    article: copy.content.tabs.article,
    post: copy.content.tabs.post,
    video: copy.content.tabs.video,
  }

  const hasInitialItems = Array.isArray(initialItems)
  const [items, setItems] = useState<ContentItem[]>(initialItems ?? [])
  const [loading, setLoading] = useState(!hasInitialItems)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [activeFeed, setActiveFeed] = useState<'forYou' | 'following'>('forYou')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [candidateWindowTruncated, setCandidateWindowTruncated] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (activeFeed === 'forYou' && hasInitialItems && retryKey === 0) return

    const controller = new AbortController()
    abortControllerRef.current?.abort()
    abortControllerRef.current = controller
    const timer = window.setTimeout((): void => {
      void (async () => {
        const requestId = ++requestIdRef.current
        try {
          setError(false)
          const endpoint = activeFeed === 'following'
            ? '/api/v1/feed/following?limit=6'
            : '/api/v1/contents?limit=6'
          const { response, data } = await fetchJson<{ data?: Page; error?: { message?: string } }>(endpoint, {
            headers: { accept: 'application/json' },
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
          })
          if (!response.ok || !data?.data) {
            if (requestId !== requestIdRef.current) return
            setAuthRequired(response.status === 401)
            setError(true)
            return
          }
          if (requestId !== requestIdRef.current) return
          setAuthRequired(false)
          setItems(data.data.items ?? [])
          setNextCursor(data.data.nextCursor ?? null)
          setHasMore(data.data.hasMore === true)
          setCandidateWindowTruncated(data.data.candidateWindowTruncated === true)
        } catch (cause) {
          if (requestId !== requestIdRef.current || controller.signal.aborted) return
          if (cause instanceof DOMException && cause.name === 'AbortError') return
          setError(true)
        } finally {
          if (requestId !== requestIdRef.current || controller.signal.aborted) return
          setLoading(false)
        }
      })()
    }, 0)

    return () => {
      requestIdRef.current += 1
      controller.abort()
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      window.clearTimeout(timer)
    }
  }, [activeFeed, hasInitialItems, retryKey])

  const switchFeed = (feed: 'forYou' | 'following') => {
    if (feed === activeFeed) return
    setActiveFeed(feed)
    setLoading(true)
    setError(false)
    setAuthRequired(false)
    setItems([])
    setNextCursor(null)
    setHasMore(false)
    setCandidateWindowTruncated(false)
    setRetryKey((value) => value + 1)
  }

  const retry = () => {
    setLoading(true)
    setError(false)
    setItems([])
    setNextCursor(null)
    setHasMore(false)
    setCandidateWindowTruncated(false)
    setAuthRequired(false)
    setRetryKey((value) => value + 1)
  }

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    const requestId = ++requestIdRef.current
    const controller = new AbortController()
    abortControllerRef.current?.abort()
    abortControllerRef.current = controller
    setLoadingMore(true)
    try {
      const endpoint = activeFeed === 'following' ? '/api/v1/feed/following' : '/api/v1/contents'
      const query = new URLSearchParams({ limit: '6', cursor: nextCursor })
      const { response, data } = await fetchJson<{ data?: Page; error?: { message?: string } }>(endpoint + '?' + query.toString(), {
        headers: { accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (!response.ok || !data?.data) {
        setAuthRequired(response.status === 401)
        setError(true)
        return
      }
      setAuthRequired(false)
      setItems((current) => {
        const known = new Set(current.map((item) => item.id))
        return [...current, ...(data.data?.items ?? []).filter((item) => !known.has(item.id))]
      })
      setNextCursor(data.data.nextCursor ?? null)
      setHasMore(data.data.hasMore === true)
      setCandidateWindowTruncated(data.data.candidateWindowTruncated === true)
    } catch (cause) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(true)
    } finally {
      if (requestId === requestIdRef.current && !controller.signal.aborted) setLoadingMore(false)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    }
  }

  const followingLabel = locale === 'en' ? 'Following' : locale === 'tw' ? '正在追蹤' : '正在关注'
  const forYouLabel = locale === 'en' ? 'For you' : locale === 'tw' ? '為你推薦' : '为你推荐'
  const emptyFollowing = locale === 'en'
    ? 'No public posts from people you follow yet.'
    : locale === 'tw' ? '你追蹤的創作者目前還沒有可展示的公開內容。' : '你关注的创作者暂时还没有可展示的公开内容。'

  return (
    <section className="content-feed" id="content-feed" aria-labelledby="content-feed-title" aria-busy={loading}>
      <div className="creator-profile-tabs" role="tablist" aria-label={locale === 'en' ? 'Home timeline' : locale === 'tw' ? '首頁動態' : '首页时间线'}>
        <button aria-selected={activeFeed === 'forYou'} className={'creator-profile-tab' + (activeFeed === 'forYou' ? ' is-active' : '')} onClick={() => switchFeed('forYou')} role="tab" type="button">{forYouLabel}</button>
        <button aria-selected={activeFeed === 'following'} className={'creator-profile-tab' + (activeFeed === 'following' ? ' is-active' : '')} onClick={() => switchFeed('following')} role="tab" type="button">{followingLabel}</button>
      </div>
      <div className="content-feed-heading">
        <div>
          <p className="eyebrow">{copy.home.feedEyebrow}</p>
          <h2 id="content-feed-title">{activeFeed === 'following' ? followingLabel : copy.home.feedTitle}</h2>
        </div>
        <Link className="content-feed-all" href={activeFeed === 'following' ? '/me/following' : '/content'}>{activeFeed === 'following' ? (locale === 'en' ? 'Manage follows ↗' : locale === 'tw' ? '管理追蹤 ↗' : '管理关注 ↗') : copy.home.feedAll}</Link>
      </div>
      {error && !loading ? (
        <div className="content-feed-error" role="status">
          <p>{authRequired
            ? (locale === 'en' ? 'Sign in to see posts from people you follow.' : locale === 'tw' ? '登入後即可查看你追蹤的動態。' : '登录后即可查看你关注的动态。')
            : copy.content.error}</p>
          {authRequired ? <Link className="button button-primary" href="/login?returnTo=%2F">{copy.common.login}</Link> : <button className="button button-quiet" onClick={retry} type="button">{copy.content.retry}</button>}
        </div>
      ) : null}
      {!loading && !error && activeFeed === 'following' && items.length === 0 ? (
        <div className="content-feed-error" role="status">
          <p>{emptyFollowing}</p>
          <Link className="button button-quiet" href="/content">{copy.common.discover}</Link>
        </div>
      ) : null}
      {activeFeed === 'following' && candidateWindowTruncated && !loading ? (
        <div className="content-feed-error" role="status">
          <p>{locale === 'en'
            ? 'This feed currently considers up to 500 followed accounts, so some followed creators may be missing.'
            : locale === 'tw'
              ? '此動態目前最多納入 500 個追蹤帳戶，部分創作者可能未顯示。'
              : '当前关注流最多纳入 500 个关注账号，部分创作者可能暂未显示。'}</p>
        </div>
      ) : null}
      <div className="content-feed-grid">
        {loading ? (
          Array.from({ length: 3 }, (_, index) => (
            <div className="content-feed-card content-feed-card-skeleton" key={index} aria-hidden="true">
              <div className="content-feed-cover content-feed-skeleton-block" />
              <div className="content-feed-body">
                <span className="content-feed-skeleton-line content-feed-skeleton-line-short" />
                <span className="content-feed-skeleton-line content-feed-skeleton-line-title" />
                <span className="content-feed-skeleton-line content-feed-skeleton-line-title" />
                <span className="content-feed-skeleton-line content-feed-skeleton-line-meta" />
              </div>
            </div>
          ))
        ) : items.map((item) => {
          if (item.contentType === 'post') {
            return (
              <LuckReadSocialPostCard
                key={item.id}
                contentId={item.id}
                slug={item.slug}
                title={item.title}
                creatorId={item.ownerUserId || item.creatorId}
                author={item.creator ?? item.author}
                coverRef={item.coverRef}
                mediaRefs={item.mediaRefs}
                createdAt={item.createdAt}
                updatedAt={item.updatedAt}
                locale={locale}
              />
            )
          }
          const cover = item.coverRef
          return (
            <Link className="content-feed-card" data-umami-event="content-open" data-umami-event-content-type={item.contentType} href={`/content/${encodeURIComponent(item.slug || item.id)}`} key={item.id}>
              <div className="content-feed-cover">
                {cover ? (
                  item.contentType === 'video' ? (
                    <video aria-label={item.title} muted playsInline preload="metadata" src={cover} />
                  ) : (
                    <img alt={item.title ? item.title + copy.content.cover : copy.content.cover} loading="lazy" src={cover} />
                  )
                ) : (
                  <span>LUCKREAD</span>
                )}
              </div>
              <div className="content-feed-body">
                <div className="content-feed-meta">
                  <span>{typeLabels[item.contentType]}</span>
                  <span>{copy.content.published}</span>
                </div>
                <h3>{item.title}</h3>
                {item.contentType === 'article' ? (
                  <ArticleSummaryPreview
                    key={item.bodyRef || item.id}
                    contentId={item.id}
                    bodyRef={item.bodyRef}
                    label={locale === 'en' ? 'Summary' : '文章摘要'}
                  />
                ) : null}
                <span className="content-feed-open">{locale === 'en' ? 'Read content ↗' : locale === 'tw' ? '閱讀內容 ↗' : '阅读内容 ↗'}</span>
              </div>
            </Link>
          )
        })}
      </div>
      {!loading && !error && hasMore && nextCursor ? (
        <div className="content-feed-more">
          <button className="button button-quiet" disabled={loadingMore} onClick={loadMore} type="button">
            {loadingMore ? (locale === 'en' ? 'Loading…' : locale === 'tw' ? '載入中…' : '加载中…') : copy.content.more}
          </button>
        </div>
      ) : null}
    </section>
  )
}
