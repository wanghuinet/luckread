'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type ContentType = 'article' | 'post' | 'video'
type ContentItem = {
  id: string
  contentType: ContentType
  title: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}
type ContentPage = {
  items: ContentItem[]
  nextCursor: string | null
  hasMore: boolean
}

type ContentApiResponse = {
  data?: ContentPage
  error?: { message?: string } | null
}

const labels: Record<ContentType | 'all', string> = {
  all: '全部',
  article: '文章',
  post: '动态',
  video: '视频',
}

export default function ContentBrowsePage() {
  const [page, setPage] = useState<ContentPage>({ items: [], nextCursor: null, hasMore: false })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function load(cursor: string | null = null): Promise<void> {
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({ limit: '18' })
      if (cursor) params.set('cursor', cursor)

      const response = await fetch('/api/v1/contents?' + params.toString(), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      const data: ContentApiResponse = await response.json().catch((): null => null)
      if (!response.ok || !data?.data) {
        throw new Error(data?.error?.message || '内容加载失败')
      }

      const next = data.data as ContentPage
      setPage((current) =>
        cursor
          ? { items: [...current.items, ...(next.items ?? [])], nextCursor: next.nextCursor, hasMore: next.hasMore }
          : next,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '内容加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  return (
    <main className="content-browse">
      <header className="content-browse-top">
        <div>
          <p className="eyebrow">EXPLORE LUCKREAD</p>
          <h1>发现内容</h1>
          <p>从文章、动态到视频，浏览已经通过发布流程并公开展示的内容。</p>
        </div>
        <div className="content-browse-actions">
          <Link className="button button-quiet" href="/">返回首页</Link>
          <Link className="button button-primary" href="/publish">开始创作 ↗</Link>
        </div>
      </header>

      {loading ? (
        <>
          <div className="content-browse-state">正在加载内容…</div>
          <section className="content-browse-grid" aria-label="正在加载公开内容" aria-busy="true">
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
          <button className="button button-quiet" onClick={() => void load()} type="button">重新加载</button>
        </div>
      ) : null}
      {!loading && !error && page.items.length === 0 ? (
        <div className="content-browse-state">
          <p>还没有公开内容。</p>
          <Link className="button button-primary" href="/publish">发布第一篇内容</Link>
        </div>
      ) : null}

      {!loading && !error && page.items.length > 0 ? (
        <>
          <section className="content-browse-grid" aria-label="公开内容列表">
            {page.items.map((item) => {
              const cover = item.coverRef
              return (
                <Link className="content-feed-card" href={'/content/' + encodeURIComponent(item.id)} key={item.id}>
                  <div className="content-feed-cover">
                    {cover ? (
                      <img alt={item.title ? item.title + '封面' : '内容封面'} loading="lazy" src={cover} />
                    ) : (
                      <span>{labels[item.contentType].toUpperCase()}</span>
                    )}
                  </div>
                  <div className="content-feed-body">
                    <div className="content-feed-meta">
                      <span>{labels[item.contentType]}</span>
                      <span>已发布</span>
                    </div>
                    <h2>{item.title}</h2>
                    {item.updatedAt ? (
                      <time dateTime={item.updatedAt}>
                        {new Date(item.updatedAt).toLocaleDateString('zh-CN')}
                      </time>
                    ) : null}
                    <span className="content-feed-open">打开内容 ↗</span>
                  </div>
                </Link>
              )
            })}
          </section>
          {page.hasMore && page.nextCursor ? (
            <div className="content-browse-more">
              <button
                aria-busy={loadingMore}
                className="button button-quiet"
                disabled={loadingMore}
                onClick={() => void load(page.nextCursor)}
                type="button"
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </main>
  )
}
