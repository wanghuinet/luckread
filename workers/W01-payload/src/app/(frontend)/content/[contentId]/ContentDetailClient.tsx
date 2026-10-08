'use client'

import Link from 'next/link'
import ContentComments from './ContentComments'
import ArticleStructuredRenderer from '../../../../components/ArticleStructuredRenderer.js'
import { plainTextFromArticleDocument, tryDeserializeArticleDocument } from '../../../../lib/article-document.js'
import { extractSocialTokens } from '../../../../social/social-token-parser.js'
import { useEffect, useMemo, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import PublicLanguageToggle, { usePublicLocale } from '../../i18n/PublicLanguageToggle'
import { getPublicCopy, type PublicLocale } from '../../i18n/public-locale'

type ContentType = 'article' | 'post' | 'video'
type Content = {
  id: string
  slug?: string
  creatorId?: string | null
  contentType: ContentType
  state: string
  title: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

const splitBodyIntoParagraphs = (value: string): string[] =>
  value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

export default function ContentDetailPage({
  params,
  initialContent,
}: {
  params: Promise<{ contentId: string }>
  initialContent?: Content
}) {
  const locale = usePublicLocale()
  const copy = getPublicCopy(locale)
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  const typeLabels: Record<ContentType, string> = {
    article: copy.content.tabs.article,
    post: copy.content.tabs.post,
    video: copy.content.tabs.video,
  }

  const [content, setContent] = useState<Content | null>(initialContent ?? null)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(!initialContent)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState<number | null>(null)
  const [likeBusy, setLikeBusy] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const [interactionRestricted, setInteractionRestricted] = useState(false)
  const [followRestricted, setFollowRestricted] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const structuredArticle = useMemo(
    () => content?.contentType === 'article' && body ? tryDeserializeArticleDocument(body) : null,
    [content?.contentType, body],
  )
  const socialTokenBody = structuredArticle ? plainTextFromArticleDocument(structuredArticle) : body
  const socialTokens = useMemo(() => extractSocialTokens(socialTokenBody), [socialTokenBody])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout((): void => {
      void (async () => {
        try {
          const { contentId } = await params
          let resolved = initialContent
          let viewerData: { id?: string } | null = null

          if (!resolved || retryKey > 0) {
            const [contentResult, viewerResult] = await Promise.all([
              fetchJson<Content>(`/api/v1/contents/${encodeURIComponent(contentId)}`, {
                credentials: 'omit',
                headers: { accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
              }),
              fetchJson<{ id?: string }>('/api/v1/users/me', {
                credentials: 'include',
                headers: { accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
              }),
            ])
            const { response, data } = contentResult
            viewerData = viewerResult.data
            if (!response.ok || !data?.id || data.state !== 'PUBLISHED') {
              throw new Error(copy.detail.notFound)
            }
            resolved = data
            if (cancelled) return
            setContent(resolved)
          } else {
            const viewerResult = await fetchJson<{ id?: string }>('/api/v1/users/me', {
              credentials: 'include',
              headers: { accept: 'application/json' },
              cache: 'no-store',
              signal: controller.signal,
            })
            viewerData = viewerResult.data
          }

          if (cancelled || !resolved) return
          setViewerUserId(typeof viewerData?.id === 'string' ? viewerData.id : null)
          try {
            const { response: likeResponse, data: likeData } = await fetchJson<{ data?: { liked?: boolean; likeCount?: number } }>(
              '/api/v1/interactions/likes?targetType=content&targetId=' + encodeURIComponent(resolved.id),
              { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal },
            )
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
            const { response: bookmarkResponse, data: bookmarkData } = await fetchJson<{ data?: { favorited?: boolean } }>(
              '/api/v1/interactions/bookmarks?targetType=content&targetId=' + encodeURIComponent(resolved.id),
              { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal },
            )
            if (!cancelled && bookmarkResponse.ok && typeof bookmarkData?.data?.favorited === 'boolean') {
              setBookmarked(bookmarkData.data.favorited)
            }
          } catch {
            // Favorite state is optional; content remains readable when the status query fails.
          }
          if (resolved.creatorId) {
            try {
              const { response: followResponse, data: followData } = await fetchJson<{
                data?: {
                  following?: boolean
                  relationship?: { blocked?: boolean; blockedBy?: boolean }
                }
              }>(
                '/api/v1/social/follows/' + encodeURIComponent(resolved.creatorId),
                { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal },
              )
              if (!cancelled && followResponse.ok) {
                const blocked = Boolean(followData?.data?.relationship?.blocked)
                const blockedBy = Boolean(followData?.data?.relationship?.blockedBy)
                setInteractionRestricted(blocked || blockedBy)
                setFollowRestricted(blocked || blockedBy)
                setFollowing(!blocked && !blockedBy && followData?.data?.following === true)
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
          setError(copy.detail.notFound)
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
  }, [initialContent, params, retryKey])

  if (loading) {
    return <main aria-busy={loading} className="content-detail"><p className="content-detail-state" role="status">{copy.detail.loading}</p></main>
  }

  if (error || !content) {
    return (
      <main className="content-detail">
        <div className="content-detail-state">
          <p>{error || copy.detail.notFound}</p>
          <button className="content-detail-retry" onClick={() => { setError(''); setLoading(true); setContent(null); setBody(''); setRetryKey((value) => value + 1) }} type="button">{copy.detail.retry}</button>
          <Link href="/">{copy.common.backHome}</Link>
        </div>
      </main>
    )
  }


  async function toggleLike() {
    if (!content || likeBusy) return
    setLikeBusy(true)
    setActionMessage('')
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>('/api/v1/interactions/likes', {
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
        setActionMessage(getApiErrorMessage(data, copy.detail.networkError))
        return
      }
      const nextLiked = !liked
      setLiked(nextLiked)
      setLikeCount((count) => {
        if (count === null) return count
        return Math.max(0, count + (nextLiked ? 1 : -1))
      })
    } catch {
      setActionMessage(copy.detail.networkError)
    } finally {
      setLikeBusy(false)
    }
  }

  async function toggleBookmark() {
    if (!content || bookmarkBusy) return
    setBookmarkBusy(true)
    setActionMessage('')
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>('/api/v1/interactions/bookmarks', {
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
        setActionMessage(getApiErrorMessage(data, copy.detail.networkError))
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
      const { response, data } = await fetchJson<{ data?: { following?: boolean }; error?: { message?: string } }>(
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
        setActionMessage(data?.error?.message || copy.detail.networkError)
        return
      }
      if (following) {
        setFollowing(false)
        return
      }
      if (typeof data?.data?.following !== 'boolean') {
        setActionMessage(copy.detail.networkError)
        return
      }
      setFollowing(data.data.following)
    } catch {
      setActionMessage('网络异常，请稍后重试。')
    } finally {
      setFollowBusy(false)
    }
  }

  async function submitReport() {
    if (!content || reportBusy) return
    const reasonCode = window.prompt(
      locale === 'en'
        ? 'Enter a report reason (for example SPAM, COPYRIGHT, ABUSE)'
        : locale === 'tw'
          ? '請輸入檢舉原因（例如 SPAM、COPYRIGHT、ABUSE）'
          : '请输入举报原因（例如 SPAM、COPYRIGHT、ABUSE）',
      'SPAM',
    )?.trim()
    if (!reasonCode) return

    setReportBusy(true)
    setActionMessage('')
    try {
      const { response, data } = await fetchJson<{ data?: { status?: string }; error?: { message?: string } }>('/api/v1/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'report:content:' + content.id + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({
          targetType: 'content',
          targetId: content.id,
          reasonCode,
        }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data) throw new Error(getApiErrorMessage(data, 'REPORT_FAILED'))
      setActionMessage(
        data.data.status === 'DEDUPLICATED'
          ? (locale === 'en' ? 'Report recorded: you have already reported this content.' : locale === 'tw' ? '檢舉已記錄：你先前已檢舉過此內容。' : '举报已记录：你此前已举报过该内容。')
          : (locale === 'en' ? 'Report submitted.' : locale === 'tw' ? '檢舉已提交。' : '举报已提交。'),
      )
    } catch {
      setActionMessage(locale === 'en' ? 'Could not submit the report. Please try again.' : locale === 'tw' ? '檢舉提交失敗，請稍後再試。' : '举报提交失败，请稍后重试。')
    } finally {
      setReportBusy(false)
    }
  }

  async function copyContentLink() {
    if (shareBusy) return
    setShareBusy(true)
    setActionMessage('')
    try {
      const { response, data } = await fetchJson<{ data?: { shareId?: string }; error?: { message?: string } }>(
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
      const shareId = data?.data?.shareId
      if (!response.ok || typeof shareId !== 'string' || !shareId) {
        setActionMessage(copy.detail.linkError)
        return
      }
      const shareUrl = window.location.origin + '/s/' + encodeURIComponent(shareId)

      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: content.title, url: shareUrl })
          setActionMessage(copy.detail.shareOpened)
          return
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') return
          // Native sharing may be unavailable or blocked; fall back to clipboard.
        }
      }

      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setActionMessage(locale === 'en' ? 'Network error. Could not generate a share link.' : locale === 'tw' ? '網路異常，暫時無法產生分享連結。' : '网络异常，暂时无法生成分享链接。')
    } finally {
      setShareBusy(false)
    }
  }

  return (
    <main className="content-detail">
      <div className="content-detail-top">
        <div className="content-detail-breadcrumbs">
          <Link href="/content">{copy.detail.backDiscover}</Link>
          <Link href="/">{copy.common.home}</Link>
        </div>
        <div className="content-detail-actions">
          <span>{typeLabels[content.contentType]} · {copy.detail.published}</span>
          {content.creatorId ? (
            <>
              <Link className="content-detail-follow" href={'/users/' + encodeURIComponent(content.creatorId)}>{copy.detail.author}</Link>
              {viewerUserId === content.creatorId ? (
                <span className="content-detail-muted">{copy.detail.own}</span>
              ) : followRestricted ? (
                <span className="content-detail-muted">{copy.detail.restricted}</span>
              ) : (
                <button className="content-detail-follow" disabled={followBusy} onClick={() => void toggleFollow()} type="button">
                  {followBusy ? copy.comments.processing : following ? copy.detail.following : copy.detail.follow}
                </button>
              )}
            </>
          ) : null}
          {!interactionRestricted ? (
            <button className="content-detail-like" disabled={likeBusy} onClick={() => void toggleLike()} type="button">
              {likeBusy ? copy.comments.processing : liked ? copy.detail.liked : copy.detail.like}
              {likeCount === null ? '' : ' · ' + likeCount.toLocaleString(dateLocale)}
            </button>
          ) : null}
          <button className="content-detail-like" disabled={bookmarkBusy} onClick={() => void toggleBookmark()} type="button">
            {bookmarkBusy ? copy.comments.processing : bookmarked ? copy.detail.favorited : copy.detail.favorite}
          </button>
          <button className="content-detail-share" disabled={shareBusy} onClick={() => void copyContentLink()} type="button">
            {shareBusy ? copy.detail.generating : copied ? copy.detail.copied : copy.detail.share}
          </button>
          {viewerUserId && viewerUserId !== content.creatorId ? (
            <button className="content-detail-share" disabled={reportBusy} onClick={() => void submitReport()} type="button">
              {reportBusy ? copy.detail.reporting : copy.detail.report}
            </button>
          ) : null}
          {actionMessage ? <span className="content-detail-action-status" role="status">{actionMessage}</span> : null}
        </div>
      </div>
      <article className="content-detail-card">
        <header className="content-detail-header">
          <div className="content-detail-language"><PublicLanguageToggle locale={locale} /></div>
          <p className="eyebrow">LUCKREAD CONTENT</p>
          <h1>{content.title}</h1>
          {content.updatedAt ? (
            <time dateTime={content.updatedAt}>
              {copy.detail.updatedAt} {new Date(content.updatedAt).toLocaleString(dateLocale, { hour12: false })}
            </time>
          ) : null}
        </header>

        {content.contentType === 'video' && content.mediaRefs?.length ? (
          <div className="content-detail-media content-detail-video-gallery">
            {content.mediaRefs.map((url, index) => (
              <video
                aria-label={content.title + ' ' + copy.detail.video + ' ' + (index + 1)}
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

        {content.contentType !== 'video' && (content.coverRef || (content.mediaRefs?.length && !structuredArticle)) ? (
          <div className="content-detail-media">
            {content.coverRef ? (
              <img alt={content.title + ' ' + copy.detail.cover} loading="eager" src={content.coverRef} />
            ) : null}
            {content.mediaRefs
              ?.filter((url) => url !== content.coverRef)
              .map((url, index) => (
                <img alt={content.title + ' ' + copy.detail.image + ' ' + (index + 1)} key={url} loading="lazy" src={url} />
              ))}
          </div>
        ) : null}

        {socialTokens.length > 0 ? (
          <section aria-label={copy.detail.tagAria} className="content-detail-social-tokens">
            {socialTokens.map((token) => (
              <span className="content-detail-social-token" key={token.kind + ':' + token.normalized}>
                {token.value}
              </span>
            ))}
          </section>
        ) : null}

        <div className="content-detail-body">
          {structuredArticle ? (
            <ArticleStructuredRenderer document={structuredArticle} />
          ) : body ? (
            splitBodyIntoParagraphs(body).map((paragraph, index) => (
              <p className="content-detail-paragraph" key={index}>{paragraph}</p>
            ))
          ) : (
            <p className="content-detail-muted">{copy.detail.bodyPreparing}</p>
          )}
        </div>
      </article>
      <ContentComments
        contentId={content.id}
        viewerUserId={viewerUserId}
        interactionRestricted={interactionRestricted}
        locale={locale}
      />
    </main>
  )
}
