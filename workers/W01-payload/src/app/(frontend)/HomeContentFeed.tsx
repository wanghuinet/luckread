'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type ContentType = 'article' | 'post' | 'video'

type ContentItem = {
  id: string
  contentType: ContentType
  title: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

const typeLabels: Record<ContentType, string> = {
  article: '文章',
  post: '动态',
  video: '视频',
}

type Page = {
  items: ContentItem[]
}

export default function HomeContentFeed() {
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
          <p className="eyebrow">Latest from LuckRead</p>
          <h2 id="content-feed-title">正在发生的内容</h2>
        </div>
        <Link className="content-feed-all" href="/content">查看全部 ↗</Link>
      </div>
      {error && !loading ? (
        <div className="content-feed-error" role="status">
          <p>内容暂时无法加载。</p>
          <button className="button button-quiet" onClick={retry} type="button">重新加载</button>
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
                    <img alt={item.title ? item.title + '封面' : '内容封面'} loading="lazy" src={cover} />
                  )
                ) : (
                  <span>{item.contentType === 'post' ? 'POST' : 'LUCKREAD'}</span>
                )}
              </div>
              <div className="content-feed-body">
                <div className="content-feed-meta">
                  <span>{typeLabels[item.contentType]}</span>
                  <span>已发布</span>
                </div>
                <h3>{item.title}</h3>
                <span className="content-feed-open">阅读内容 ↗</span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
