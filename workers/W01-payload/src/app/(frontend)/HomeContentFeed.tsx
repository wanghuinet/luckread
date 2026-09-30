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

  useEffect(() => {
    const timer = window.setTimeout((): void => {
      void (async () => {
        try {
          const response = await fetch('/api/v1/contents?limit=6', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const data = await response.json().catch((): null => null)
          if (!response.ok || !data?.data) return
          setItems((data.data as Page).items ?? [])
        } catch {
          // The homepage remains usable when the optional content feed is unavailable.
        } finally {
          setLoading(false)
        }
      })()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  if (!loading && items.length === 0) return null

  return (
    <section className="content-feed" id="content-feed" aria-labelledby="content-feed-title">
      <div className="content-feed-heading">
        <div>
          <p className="eyebrow">Latest from LuckRead</p>
          <h2 id="content-feed-title">正在发生的内容</h2>
        </div>
        <span className="content-feed-note">实时读取已发布内容</span>
      </div>
      <div className="content-feed-grid">
        {items.map((item) => {
          const cover = item.coverRef || item.mediaRefs?.[0]
          return (
            <Link className="content-feed-card" href={`/content/${encodeURIComponent(item.id)}`} key={item.id}>
              <div className="content-feed-cover">
                {cover ? (
                  item.contentType === 'video' ? (
                    <video aria-label={item.title} muted playsInline preload="metadata" src={cover} />
                  ) : (
                    <img alt="" loading="lazy" src={cover} />
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
