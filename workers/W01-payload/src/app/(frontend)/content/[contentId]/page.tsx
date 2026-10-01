'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type ContentType = 'article' | 'post' | 'video'
type Content = {
  id: string
  contentType: ContentType
  state: string
  title: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

const typeLabels: Record<ContentType, string> = {
  article: '文章',
  post: '动态',
  video: '视频',
}

const splitBodyIntoParagraphs = (value: string): string[] =>
  value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

export default function ContentDetailPage({
  params,
}: {
  params: Promise<{ contentId: string }>
}) {
  const [content, setContent] = useState<Content | null>(null)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout((): void => {
      void (async () => {
        try {
          const { contentId } = await params
          const response = await fetch(`/api/v1/contents/${encodeURIComponent(contentId)}`, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const data = await response.json().catch((): null => null)
          if (!response.ok || !data?.id || data.state !== 'PUBLISHED') {
            throw new Error('CONTENT_NOT_FOUND')
          }
          if (cancelled) return
          const resolved = data as Content
          setContent(resolved)
          if (resolved.bodyRef) {
            try {
              const bodyResponse = await fetch(resolved.bodyRef, { cache: 'no-store' })
              if (bodyResponse.ok) setBody(await bodyResponse.text())
            } catch {
              // Body media is optional; metadata/media should still render.
            }
          }
        } catch {
          if (!cancelled) setError('内容不存在，或暂时无法读取。')
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [params])

  if (loading) {
    return <main className="content-detail"><p className="content-detail-state">正在加载内容…</p></main>
  }

  if (error || !content) {
    return (
      <main className="content-detail">
        <div className="content-detail-state">
          <p>{error || '内容不存在。'}</p>
          <Link href="/">返回首页</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="content-detail">
      <div className="content-detail-top">
        <Link href="/">← 返回首页</Link>
        <span>{typeLabels[content.contentType]} · 已发布</span>
      </div>
      <article className="content-detail-card">
        <header className="content-detail-header">
          <p className="eyebrow">LUCKREAD CONTENT</p>
          <h1>{content.title}</h1>
          {content.updatedAt ? (
            <time dateTime={content.updatedAt}>
              更新于 {new Date(content.updatedAt).toLocaleString('zh-CN', { hour12: false })}
            </time>
          ) : null}
        </header>

        {content.contentType === 'video' && content.mediaRefs?.length ? (
          <div className="content-detail-media">
            <video
              controls
              playsInline
              preload="metadata"
              poster={content.coverRef || undefined}
              src={content.mediaRefs[0]}
            />
          </div>
        ) : null}

        {content.contentType !== 'video' && (content.coverRef || content.mediaRefs?.length) ? (
          <div className="content-detail-media">
            {content.coverRef ? (
              <img alt="" loading="eager" src={content.coverRef} />
            ) : null}
            {content.mediaRefs
              ?.filter((url) => url !== content.coverRef)
              .map((url) => (
                <img alt="" key={url} loading="lazy" src={url} />
              ))}
          </div>
        ) : null}

        <div className="content-detail-body">
          {body ? (
            splitBodyIntoParagraphs(body).map((paragraph, index) => (
              <p className="content-detail-paragraph" key={index}>{paragraph}</p>
            ))
          ) : (
            <p className="content-detail-muted">正文内容正在准备中。</p>
          )}
        </div>
      </article>
    </main>
  )
}
