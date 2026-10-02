'use client'

import Link from 'next/link'
import ContentComments from './ContentComments'
import { extractSocialTokens } from '../../../social/social-token-parser.js'
import { useEffect, useMemo, useState } from 'react'

type ContentType = 'article' | 'post' | 'video'
type Content = {
  id: string
  creatorId?: string | null
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
  const [copied, setCopied] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState<number | null>(null)
  const [likeBusy, setLikeBusy] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const socialTokens = useMemo(() => extractSocialTokens(body), [body])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout((): void => {
      void (async () => {
        try {
          const { contentId } = await params
          const [response, viewerResponse] = await Promise.all([
            fetch(`/api/v1/contents/${encodeURIComponent(contentId)}`, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
              signal: controller.signal,
            }),
            fetch('/api/v1/users/me', {
              credentials: 'include',
              headers: { accept: 'application/json' },
              cache: 'no-store',
              signal: controller.signal,
            }),
          ])
          const data = await response.json().catch((): null => null)
          const viewerData = await viewerResponse.json().catch((): null => null) as { id?: string } | null
          if (!response.ok || !data?.id || data.state !== 'PUBLISHED') {
            throw new Error('CONTENT_NOT_FOUND')
          }
          if (cancelled) return
          const resolved = data as Content
          setContent(resolved)
          setViewerUserId(typeof viewerData?.id === 'string' ? viewerData.id : null)
          try {
            const likeResponse = await fetch(
              '/api/v1/interactions/likes?targetType=content&targetId=' + encodeURIComponent(resolved.id),
              { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal },
            )
            const likeData = await likeResponse.json().catch((): null => null) as { data?: { liked?: boolean; likeCount?: number } } | null
            if (!cancelled && likeResponse.ok && typeof likeData?.data?.liked === 'boolean') {
              setLiked(likeData.data.liked)
              setLikeCount(
                typeof likeData?.data?.likeCount === 'number'
                  ? Math.max(0, likeData.data.likeCount)
                  : null,
              )
            }
          } catch {
            // Like state is optional; content remains readable when the status query fails.
          }
          try {
            const bookmarkResponse = await fetch(
              '/api/v1/interactions/bookmarks?targetType=content&targetId=' + encodeURIComponent(resolved.id),
              { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal },
            )
            const bookmarkData = await bookmarkResponse.json().catch((): null => null) as { data?: { favorited?: boolean } } | null
            if (!cancelled && bookmarkResponse.ok && typeof bookmarkData?.data?.favorited === 'boolean') {
              setBookmarked(bookmarkData.data.favorited)
            }
          } catch {
            // Favorite state is optional; content remains readable when the status query fails.
          }
          if (resolved.creatorId) {
            try {
              const followResponse = await fetch(
                '/api/v1/social/follows/' + encodeURIComponent(resolved.creatorId),
                { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal },
              )
              const followData = await followResponse.json().catch((): null => null) as { data?: { following?: boolean } } | null
              if (!cancelled && followResponse.ok && typeof followData?.data?.following === 'boolean') {
                setFollowing(followData.data.following)
              }
            } catch {
              // Follow state is optional; content remains readable when the status query fails.
            }
          }
          if (resolved.bodyRef) {
            try {
              const bodyResponse = await fetch(resolved.bodyRef, { cache: 'no-store', signal: controller.signal })
              if (bodyResponse.ok && !cancelled) setBody(await bodyResponse.text())
            } catch {
              // Body media is optional; metadata/media should still render.
            }
          }
        } catch (cause) {
          if (cancelled || controller.signal.aborted) return
          if (cause instanceof DOMException && cause.name === 'AbortError') return
          setError('内容不存在，或暂时无法读取。')
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, 0)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [params, retryKey])

  if (loading) {
    return <main aria-busy={loading} className="content-detail"><p className="content-detail-state" role="status">正在加载内容…</p></main>
  }

  if (error || !content) {
    return (
      <main className="content-detail">
        <div className="content-detail-state">
          <p>{error || '内容不存在。'}</p>
          <button className="content-detail-retry" onClick={() => { setError(''); setLoading(true); setContent(null); setBody(''); setRetryKey((value) => value + 1) }} type="button">重新加载</button>
          <Link href="/">返回首页</Link>
        </div>
      </main>
    )
  }


  async function toggleLike() {
    if (!content || likeBusy) return
    setLikeBusy(true)
    setActionMessage('')
    try {
      const response = await fetch('/api/v1/interactions/likes', {
        method: liked ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'Idempotency-Key': 'social-like:' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: content.id }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        const data = await response.json().catch((): null => null)
        setActionMessage(data?.error?.message || '点赞操作失败，请稍后重试。')
        return
      }
      const nextLiked = !liked
      setLiked(nextLiked)
      setLikeCount((count) => {
        if (count === null) return count
        return Math.max(0, count + (nextLiked ? 1 : -1))
      })
    } catch {
      setActionMessage('网络异常，请稍后重试。')
    } finally {
      setLikeBusy(false)
    }
  }

  async function toggleBookmark() {
    if (!content || bookmarkBusy) return
    setBookmarkBusy(true)
    setActionMessage('')
    try {
      const response = await fetch('/api/v1/interactions/bookmarks', {
        method: bookmarked ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'Idempotency-Key': 'social-bookmark:' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: content.id }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        const data = await response.json().catch((): null => null)
        setActionMessage(data?.error?.message || '收藏操作失败，请稍后重试。')
        return
      }
      setBookmarked((value) => !value)
    } catch {
      setActionMessage('网络异常，请稍后重试。')
    } finally {
      setBookmarkBusy(false)
    }
  }

  async function toggleFollow() {
    if (!content?.creatorId || followBusy) return
    setFollowBusy(true)
    setActionMessage('')
    try {
      const response = await fetch(
        '/api/v1/social/follows/' + encodeURIComponent(content.creatorId),
        {
          method: following ? 'DELETE' : 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'social-follow:' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        const data = await response.json().catch((): null => null)
        setActionMessage(data?.error?.message || '关注操作失败，请稍后重试。')
        return
      }
      setFollowing((value) => !value)
    } catch {
      setActionMessage('网络异常，请稍后重试。')
    } finally {
      setFollowBusy(false)
    }
  }

  async function copyContentLink() {
    if (shareBusy) return
    setShareBusy(true)
    setActionMessage('')
    try {
      const response = await fetch(
        '/api/v1/content/' + encodeURIComponent(content.id) + '/shares',
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': 'social-share:' + crypto.randomUUID(),
          },
          body: JSON.stringify({ contentId: content.id }),
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      const data = await response.json().catch((): null => null) as { data?: { shareId?: string } } | null
      const shareId = data?.data?.shareId
      if (!response.ok || typeof shareId !== 'string' || !shareId) {
        setActionMessage('分享链接生成失败，请稍后重试。')
        return
      }
      await navigator.clipboard.writeText(window.location.origin + '/s/' + encodeURIComponent(shareId))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setActionMessage('网络异常，暂时无法生成分享链接。')
    } finally {
      setShareBusy(false)
    }
  }

  return (
    <main className="content-detail">
      <div className="content-detail-top">
        <div className="content-detail-breadcrumbs">
          <Link href="/content">← 返回发现</Link>
          <Link href="/">首页</Link>
        </div>
        <div className="content-detail-actions">
          <span>{typeLabels[content.contentType]} · 已发布</span>
          {content.creatorId ? (
            <>
              <Link className="content-detail-follow" href={'/users/' + encodeURIComponent(content.creatorId)}>查看作者</Link>
              {viewerUserId === content.creatorId ? (
                <span className="content-detail-muted">这是你的作品</span>
              ) : (
                <button className="content-detail-follow" disabled={followBusy} onClick={() => void toggleFollow()} type="button">
                  {followBusy ? '处理中…' : following ? '已关注作者' : '关注作者'}
                </button>
              )}
            </>
          ) : null}
          <button className="content-detail-like" disabled={likeBusy} onClick={() => void toggleLike()} type="button">
            {likeBusy ? '处理中…' : liked ? '已点赞' : '点赞'}
            {likeCount === null ? '' : ' · ' + likeCount.toLocaleString('zh-CN')}
          </button>
          <button className="content-detail-like" disabled={bookmarkBusy} onClick={() => void toggleBookmark()} type="button">
            {bookmarkBusy ? '处理中…' : bookmarked ? '已收藏' : '收藏'}
          </button>
          <button className="content-detail-share" disabled={shareBusy} onClick={() => void copyContentLink()} type="button">
            {shareBusy ? '生成中…' : copied ? '分享链接已复制' : '分享'}
          </button>
          {actionMessage ? <span className="content-detail-action-status" role="status">{actionMessage}</span> : null}
        </div>
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
          <div className="content-detail-media content-detail-video-gallery">
            {content.mediaRefs.map((url, index) => (
              <video
                aria-label={content.title + ' 视频 ' + (index + 1)}
                controls
                key={url}
                playsInline
                preload={index === 0 ? 'metadata' : 'none'}
                poster={index === 0 ? content.coverRef || undefined : undefined}
                src={url}
              />
            ))}
          </div>
        ) : null}

        {content.contentType !== 'video' && (content.coverRef || content.mediaRefs?.length) ? (
          <div className="content-detail-media">
            {content.coverRef ? (
              <img alt={content.title + ' 封面'} loading="eager" src={content.coverRef} />
            ) : null}
            {content.mediaRefs
              ?.filter((url) => url !== content.coverRef)
              .map((url, index) => (
                <img alt={content.title + ' 配图 ' + (index + 1)} key={url} loading="lazy" src={url} />
              ))}
          </div>
        ) : null}

        {socialTokens.length > 0 ? (
          <section aria-label="内容标签与提及" className="content-detail-social-tokens">
            {socialTokens.map((token) => (
              <span className="content-detail-social-token" key={token.kind + ':' + token.normalized}>
                {token.value}
              </span>
            ))}
          </section>
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
      <ContentComments contentId={content.id} />
    </main>
  )
}
