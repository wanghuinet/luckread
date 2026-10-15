"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { getCachedPublicProfile, type PublicProfile } from '../../../../lib/social-post-profile-cache.js'
import { resolveSocialPostMedia } from '../../../../lib/social-post-media.js'
import type { PublicLocale } from '../../i18n/public-locale'

/**
 * UI structure adapted from ccrsxx/twitter-clone's Tweet, TweetStats and user
 * components (MIT). All data and mutations here use LuckRead's W01/W05 APIs.
 */
type ContentDetail = {
  id?: string
  creatorId?: string | null
  createdAt?: string
  updatedAt?: string
}

type SocialSummary = {
  data?: {
    counts?: { likes?: number; favorites?: number; comments?: number; shares?: number }
    viewer?: { liked?: boolean; favorited?: boolean } | null
  }
  error?: { message?: string }
}

type ApiResponse<T> = {
  data?: T
  error?: { message?: string }
}

type Props = {
  contentId: string
  slug?: string
  title: string
  creatorId?: string | null
  coverRef?: string | null
  mediaRefs?: string[]
  createdAt?: string
  updatedAt?: string
  locale?: PublicLocale
}

export default function LuckReadSocialPostCard({
  contentId,
  slug,
  title,
  creatorId,
  coverRef,
  mediaRefs,
  createdAt,
  updatedAt,
  locale = 'zh',
}: Props) {
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [resolvedCreatorId, setResolvedCreatorId] = useState<string | null>(creatorId ?? null)
  const [postTimestamp, setPostTimestamp] = useState(createdAt || updatedAt || '')
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState<number | null>(null)
  const [likeStateLoading, setLikeStateLoading] = useState(true)
  const [likeBusy, setLikeBusy] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [message, setMessage] = useState('')

  const contentHref = '/content/' + encodeURIComponent(slug || contentId)
  const mediaItems = resolveSocialPostMedia(mediaRefs, coverRef)
  const singleMedia = mediaItems.length === 1 ? mediaItems[0] : undefined
  const profileName = profile?.displayName?.trim() || profile?.username || (
    locale === 'en' ? 'LuckRead creator' : locale === 'tw' ? 'LuckRead 創作者' : 'LuckRead 创作者'
  )
  const username = profile?.username ? '@' + profile.username : ''
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  const formattedDate = postTimestamp && Number.isFinite(Date.parse(postTimestamp))
    ? new Date(postTimestamp).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })
    : ''

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const load = async () => {
      setResolvedCreatorId(creatorId ?? null)
      setPostTimestamp(createdAt || updatedAt || '')
      setProfile(null)
      setBookmarked(false)
      setLikeStateLoading(true)

      // The public content-list DTO intentionally omits author metadata. Reuse
      // the existing detail endpoint only when the caller cannot supply it.
      const detailRequest = creatorId
        ? Promise.resolve(null)
        : fetchJson<ContentDetail>('/api/v1/contents/' + encodeURIComponent(slug || contentId), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          })
      const socialRequest = fetchJson<SocialSummary>(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/social',
        {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        },
      )

      const [detailResult, socialResult] = await Promise.allSettled([detailRequest, socialRequest])
      if (cancelled) return

      let authorId = creatorId ?? null
      if (detailResult.status === 'fulfilled' && detailResult.value?.response.ok) {
        const detail = detailResult.value.data
        authorId = authorId || (typeof detail?.creatorId === 'string' ? detail.creatorId : null)
        setPostTimestamp(createdAt || updatedAt || detail?.createdAt || detail?.updatedAt || '')
        setResolvedCreatorId(authorId)
      }

      if (socialResult.status === 'fulfilled') {
        const result = socialResult.value
        const summary = result.data?.data
        setLiked(result.response.ok && summary?.viewer?.liked === true)
        setBookmarked(result.response.ok && summary?.viewer?.favorited === true)
        setLikeCount(result.response.ok && typeof summary?.counts?.likes === 'number'
          ? Math.max(0, summary.counts.likes)
          : null)
      }

      if (authorId) {
        try {
          const authorProfile = await getCachedPublicProfile(authorId)
          if (!cancelled) setProfile(authorProfile)
        } catch {
          // The social post remains readable if public profile metadata is unavailable.
        }
      }
      if (!cancelled) setLikeStateLoading(false)
    }

    void load().catch(() => {
      if (!cancelled) setLikeStateLoading(false)
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [contentId, creatorId, createdAt, updatedAt, slug])

  const requireLogin = () => {
    const returnTo = window.location.pathname + window.location.search + window.location.hash
    window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
  }

  const toggleLike = async () => {
    if (likeBusy || likeStateLoading) return
    const previousLiked = liked
    setLikeBusy(true)
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<unknown>>('/api/v1/interactions/likes', {
        method: previousLiked ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'twitter-clone-reuse-like:' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: contentId }),
      })
      if (response.status === 401) {
        requireLogin()
        return
      }
      if (!response.ok && response.status !== 204) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Like failed.' : '点赞失败，请稍后重试。'))
      }
      setLiked(!previousLiked)
      setLikeCount((current) => current === null
        ? null
        : Math.max(0, current + (previousLiked ? -1 : 1)))
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Like failed.' : '点赞失败，请稍后重试。')
    } finally {
      setLikeBusy(false)
    }
  }

  const toggleBookmark = async () => {
    if (bookmarkBusy || likeStateLoading) return
    const previousBookmarked = bookmarked
    setBookmarkBusy(true)
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<unknown>>('/api/v1/interactions/bookmarks', {
        method: previousBookmarked ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'twitter-clone-reuse-bookmark:' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: contentId }),
      })
      if (response.status === 401) {
        requireLogin()
        return
      }
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Bookmark failed.' : '收藏失败，请稍后重试。'))
      }
      setBookmarked(!previousBookmarked)
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Bookmark failed.' : '收藏失败，请稍后重试。')
    } finally {
      setBookmarkBusy(false)
    }
  }


  const reportContent = async () => {
    if (reportBusy) return
    const reasonCode = window.prompt(
      locale === 'en'
        ? 'Enter a report reason (for example SPAM, ABUSE, or COPYRIGHT).'
        : '请输入举报原因（例如 SPAM、ABUSE、COPYRIGHT）',
      'ABUSE',
    )?.trim()
    if (!reasonCode) return

    setReportBusy(true)
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<{ status?: string }>>('/api/v1/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'twitter-clone-reuse-report:content:' + contentId + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: contentId, reasonCode }),
      })
      if (response.status === 401) {
        requireLogin()
        return
      }
      if (!response.ok || !data?.data) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Report failed.' : '举报提交失败，请稍后重试。'))
      }
      setMessage(data.data.status === 'DEDUPLICATED'
        ? (locale === 'en' ? 'You have already reported this post.' : '你此前已举报过这条动态。')
        : (locale === 'en' ? 'Report submitted.' : '举报已提交。'))
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Report failed.' : '举报提交失败，请稍后重试。')
    } finally {
      setReportBusy(false)
    }
  }

  const shareContent = async () => {
    if (shareBusy) return
    setShareBusy(true)
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<{ shareId?: string }>>(
        '/api/v1/content/' + encodeURIComponent(contentId) + '/shares',
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': 'twitter-clone-reuse-share:' + crypto.randomUUID(),
          },
          body: JSON.stringify({ contentId }),
        },
      )
      if (response.status === 401) {
        requireLogin()
        return
      }
      const shareId = data?.data?.shareId
      if (!response.ok || typeof shareId !== 'string' || !shareId) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Could not create a share link.' : '暂时无法生成分享链接。'))
      }
      const shareUrl = window.location.origin + '/s/' + encodeURIComponent(shareId)
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title, url: shareUrl })
          setMessage(locale === 'en' ? 'Share opened.' : locale === 'tw' ? '已開啟分享。' : '已打开分享。')
          return
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') return
          // Fall back to the clipboard if native sharing is unavailable.
        }
      }
      await navigator.clipboard.writeText(shareUrl)
      setMessage(locale === 'en' ? 'Share link copied.' : locale === 'tw' ? '已複製分享連結。' : '已复制分享链接。')
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Could not create a share link.' : '暂时无法生成分享链接。')
    } finally {
      setShareBusy(false)
    }
  }

  return (
    <article className="content-feed-card" data-testid="luckread-social-post-card">
      <div className="content-feed-body">
        <div className="content-feed-meta">
          {resolvedCreatorId ? (
            <Link className="content-detail-follow" href={'/users/' + encodeURIComponent(resolvedCreatorId)}>
              {profileName}
            </Link>
          ) : (
            <strong>{profileName}</strong>
          )}
          {username ? <span>{username}</span> : null}
          {formattedDate ? <time dateTime={postTimestamp}>{formattedDate}</time> : null}
        </div>

        <h3>{title}</h3>

        {singleMedia ? (
          <div className="content-feed-cover">
            {singleMedia.kind === 'video' ? (
              <video
                aria-label={title}
                controls
                muted
                playsInline
                preload="metadata"
                poster={singleMedia.poster}
                src={singleMedia.src}
              />
            ) : (
              <img alt={title} loading="lazy" src={singleMedia.src} />
            )}
          </div>
        ) : mediaItems.length > 1 ? (
          <div className="lr-preview-media" role="group" aria-label={locale === 'en' ? 'Post media' : '动态媒体'}>
            {mediaItems.map((media) => (
              media.kind === 'video' ? (
                <video
                  key={media.src}
                  aria-label={title}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  poster={media.poster}
                  src={media.src}
                />
              ) : (
                <img key={media.src} alt="" loading="lazy" src={media.src} />
              )
            ))}
          </div>
        ) : null}

        <Link
          className="content-feed-open"
          href={contentHref}
          data-umami-event="content-open"
          data-umami-event-content-type="post"
        >
          {locale === 'en' ? 'Open discussion ↗' : locale === 'tw' ? '查看討論 ↗' : '查看讨论 ↗'}
        </Link>

        <footer className="content-detail-actions">
          <Link className="content-comment-reply" href={contentHref} aria-label={locale === 'en' ? 'Open replies' : '打开评论'}>
            {locale === 'en' ? 'Discuss' : locale === 'tw' ? '討論' : '讨论'}
          </Link>
          <button
            className="content-detail-like"
            type="button"
            disabled={likeBusy || likeStateLoading}
            aria-pressed={liked}
            onClick={() => void toggleLike()}
          >
            {likeStateLoading
              ? '…'
              : likeCount === null
                ? (liked ? (locale === 'en' ? 'Liked' : '已赞') : (locale === 'en' ? 'Like' : '点赞'))
                : (locale === 'en' ? 'Likes ' : '点赞 ') + likeCount.toLocaleString(dateLocale)}
          </button>
          <button
            className="content-detail-like"
            type="button"
            disabled={bookmarkBusy || likeStateLoading}
            aria-pressed={bookmarked}
            onClick={() => void toggleBookmark()}
          >
            {bookmarkBusy
              ? (locale === 'en' ? 'Saving…' : locale === 'tw' ? '處理中…' : '处理中…')
              : bookmarked
                ? (locale === 'en' ? 'Saved' : locale === 'tw' ? '已收藏' : '已收藏')
                : (locale === 'en' ? 'Bookmark' : locale === 'tw' ? '收藏' : '收藏')}
          </button>
          <button
            className="content-detail-share"
            type="button"
            disabled={shareBusy}
            onClick={() => void shareContent()}
          >
            {shareBusy
              ? (locale === 'en' ? 'Sharing…' : locale === 'tw' ? '分享中…' : '分享中…')
              : (locale === 'en' ? 'Share' : locale === 'tw' ? '分享' : '分享')}
          </button>
          <button
            className="content-detail-like"
            type="button"
            disabled={reportBusy}
            onClick={() => void reportContent()}
          >
            {reportBusy
              ? (locale === 'en' ? 'Reporting…' : locale === 'tw' ? '舉報中…' : '举报中…')
              : (locale === 'en' ? 'Report' : locale === 'tw' ? '舉報' : '举报')}
          </button>
          {message ? <span className="content-detail-action-status" role="status">{message}</span> : null}
        </footer>
      </div>
    </article>
  )
}
