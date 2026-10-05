'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { getPublicCopy, type PublicLocale } from './i18n/public-locale'

type ContentType = 'article' | 'post' | 'video'

type ContentItem = {
  id: string
  contentType: ContentType
  title: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

type Page = {
  items: ContentItem[]
}

export default function HomeContentFeed({ locale = 'zh' }: { locale?: PublicLocale }) {
  const copy = getPublicCopy(locale)
  const typeLabels: Record<ContentType, string> = {
    article: copy.content.tabs.article,
    post: copy.content.tabs.post,
    video: copy.content.tabs.video,
  }

  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    abortControllerRef.current?.abort()
    abortControllerRef.current = controller
    const timer = window.setTimeout((): void => {
      void (async () => {
        const requestId = ++requestIdRef.current
        try {
          setError(false)
          const response = await fetch('/api/v1/contents?limit=6', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          })
          const data = await response.json().catch((): null => null)
          if (!response.ok || !data?.data) {
            if (requestId !== requestIdRef.current) return
            setError(true)
            return
          }
          if (requestId !== requestIdRef.current) return
          setItems((data.data as Page).items ?? [])
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
  }, [retryKey])

  if (!loading && items.length === 0 && !error) return null

  const retry = () => {
    setLoading(true)
    setError(false)
    setItems([])
    setRetryKey((value) => value + 1)
  }

  return (
    <section className="content-feed" id="content-feed" aria-labelledby="content-feed-title" aria-busy={loading}>
      <div className="content-feed-heading">
        <div>
          <p className="eyebrow">{copy.home.feedEyebrow}</p>
          <h2 id="content-feed-title">{copy.home.feedTitle}</h2>
        </div>
        <Link className="content-feed-all" href="/content">{copy.home.feedAll}</Link>
      </div>
      {error && !loading ? (
        <div className="content-feed-error" role="status">
          <p>{copy.content.error}</p>
          <button className="button button-quiet" onClick={retry} type="button">{copy.content.retry}</button>
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
          const cover = item.coverRef
          return (
            <Link className="content-feed-card" href={`/content/${encodeURIComponent(item.id)}`} key={item.id}>
              <div className="content-feed-cover">
                {cover ? (
                  item.contentType === 'video' ? (
                    <video aria-label={item.title} muted playsInline preload="metadata" src={cover} />
                  ) : (
                    <img alt={item.title ? item.title + copy.content.cover : copy.content.cover} loading="lazy" src={cover} />
                  )
                ) : (
                  <span>{item.contentType === 'post' ? 'POST' : 'LUCKREAD'}</span>
                )}
              </div>
              <div className="content-feed-body">
                <div className="content-feed-meta">
                  <span>{typeLabels[item.contentType]}</span>
                  <span>{copy.content.published}</span>
                </div>
                <h3>{item.title}</h3>
                <span className="content-feed-open">{locale === 'en' ? 'Read content ↗' : locale === 'tw' ? '閱讀內容 ↗' : '阅读内容 ↗'}</span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
