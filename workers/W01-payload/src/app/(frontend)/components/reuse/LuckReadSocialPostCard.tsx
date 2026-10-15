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

type ContentType = 'article' | 'post' | 'video'

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
  presentation?: 'luckread' | 'twitter-clone'
  contentType?: ContentType
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
  presentation = 'luckread',
  contentType = 'post',
}: Props) {
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [resolvedCreatorId, setResolvedCreatorId] = useState<string | null>(creatorId ?? null)
  const [postTimestamp, setPostTimestamp] = useState(createdAt || updatedAt || '')
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState<number | null>(null)
  const [commentCount, setCommentCount] = useState<number | null>(null)
  const [shareCount, setShareCount] = useState<number | null>(null)
  const [likeStateLoading, setLikeStateLoading] = useState(true)
  const [likeBusy, setLikeBusy] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [favoriteCount, setFavoriteCount] = useState<number | null>(null)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
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
      setFavoriteCount(null)
      setCommentCount(null)
      setShareCount(null)
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
        setFavoriteCount(result.response.ok && typeof summary?.counts?.favorites === 'number'
          ? Math.max(0, summary.counts.favorites)
          : null)
        setLikeCount(result.response.ok && typeof summary?.counts?.likes === 'number'
          ? Math.max(0, summary.counts.likes)
          : null)
        setCommentCount(result.response.ok && typeof summary?.counts?.comments === 'number'
          ? Math.max(0, summary.counts.comments)
          : null)
        setShareCount(result.response.ok && typeof summary?.counts?.shares === 'number'
          ? Math.max(0, summary.counts.shares)
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
      setFavoriteCount((current) => current === null
        ? null
        : Math.max(0, current + (previousBookmarked ? -1 : 1)))
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Bookmark failed.' : '收藏失败，请稍后重试。')
    } finally {
      setBookmarkBusy(false)
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
      setShareCount((current) => current === null ? null : current + 1)
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

  if (presentation === 'twitter-clone') {
    const creatorHref = resolvedCreatorId ? '/users/' + encodeURIComponent(resolvedCreatorId) : '/content'
    const typeLabel = contentType === 'article' ? 'Article' : contentType === 'video' ? 'Video' : 'Post'
    return (
      <article className="hover-animation border-b border-light-border dark:border-dark-border" data-testid="luckread-twitter-clone-card">
        <div className="accent-tab hover-card grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 outline-none duration-200">
          <Link href={creatorHref} aria-label={profileName} className="main-tab row-span-2 h-12 w-12 rounded-full outline-none">
            {profile?.avatar
              ? <img alt={profileName} className="h-12 w-12 rounded-full bg-main-sidebar-background object-cover" loading="lazy" src={profile.avatar} />
              : <span className="grid h-12 w-12 place-items-center rounded-full bg-main-sidebar-background text-lg font-bold">{profileName.slice(0, 1).toUpperCase()}</span>}
          </Link>
          <div className="flex min-w-0 items-center gap-x-1 text-[15px] leading-5">
            {resolvedCreatorId
              ? <Link className="main-tab trim-alt font-bold text-light-primary outline-none dark:text-dark-primary" href={creatorHref}>{profileName}</Link>
              : <strong className="trim-alt">{profileName}</strong>}
            {username ? <span className="trim-alt text-light-secondary dark:text-dark-secondary">{username}</span> : null}
            {formattedDate ? <span className="shrink-0 text-light-secondary dark:text-dark-secondary">· {formattedDate}</span> : null}
            <span className="ml-auto shrink-0 rounded-full bg-main-sidebar-background px-2 py-0.5 text-[11px] text-light-secondary dark:text-dark-secondary">{typeLabel}</span>
          </div>
          <Link href={contentHref} className="main-tab min-w-0 whitespace-pre-wrap break-words text-[15px] leading-5 outline-none">{title}</Link>
          {mediaItems.length > 0 ? (
            <Link href={contentHref} className="main-tab col-start-2 mt-3 block overflow-hidden rounded-2xl border border-light-line-reply outline-none dark:border-dark-border" aria-label={title}>
              {singleMedia ? (
                singleMedia.kind === 'video'
                  ? <video aria-label={title} className="max-h-[520px] w-full bg-main-sidebar-background object-contain" controls muted playsInline preload="metadata" poster={singleMedia.poster} src={singleMedia.src} />
                  : <img alt={title} className="max-h-[520px] w-full bg-main-sidebar-background object-cover" loading="lazy" src={singleMedia.src} />
              ) : (
                <div className="grid grid-cols-2 gap-px bg-dark-border">
                  {mediaItems.slice(0, 4).map((media) => media.kind === 'video'
                    ? <video key={media.src} aria-label={title} className="aspect-square w-full bg-main-sidebar-background object-cover" controls muted playsInline preload="metadata" poster={media.poster} src={media.src} />
                    : <img key={media.src} alt="" className="aspect-square w-full bg-main-sidebar-background object-cover" loading="lazy" src={media.src} />)}
                </div>
              )}
            </Link>
          ) : null}
          <div className="col-start-2 mt-3 flex max-w-md items-center justify-between text-light-secondary dark:text-dark-secondary">
            <Link href={contentHref} aria-label={commentCount !== null ? 'Open replies, ' + commentCount + ' comments' : 'Open replies'} className="group flex min-w-0 items-center gap-2 rounded-full p-2 outline-none transition hover:text-accent-blue focus-visible:text-accent-blue">
              <span className="grid h-9 w-9 place-items-center rounded-full transition group-hover:bg-accent-blue/10 group-active:bg-accent-blue/20 group-focus-visible:ring-2 group-focus-visible:ring-accent-blue/80">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3.75h6m-9.75 7.5 2.5-3.5A8.25 8.25 0 1 1 20.25 12a8.2 8.2 0 0 1-2.65 6.08H9.5z" /></svg>
              </span>
              {commentCount !== null ? <span className="text-xs">{commentCount.toLocaleString(dateLocale)}</span> : null}
            </Link>
            <button aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked} className={'group flex items-center gap-2 rounded-full p-2 outline-none transition hover:text-accent-pink focus-visible:text-accent-pink disabled:opacity-50 ' + (liked ? 'text-accent-pink' : '')} disabled={likeBusy || likeStateLoading} onClick={() => void toggleLike()} type="button">
              <span className="grid h-9 w-9 place-items-center rounded-full transition group-hover:bg-accent-pink/10 group-active:bg-accent-pink/20 group-focus-visible:ring-2 group-focus-visible:ring-accent-pink/80">
                <svg className={'h-5 w-5 ' + (liked ? 'fill-accent-pink' : 'fill-none')} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>
              </span>
              {likeCount !== null ? <span className="text-xs">{likeCount.toLocaleString(dateLocale)}</span> : null}
            </button>
            <button aria-label={favoriteCount !== null ? (bookmarked ? 'Remove bookmark, ' : 'Bookmark, ') + favoriteCount + ' favorites' : (bookmarked ? 'Remove bookmark' : 'Bookmark')} aria-pressed={bookmarked} className="group flex items-center gap-2 rounded-full p-2 outline-none transition hover:text-accent-blue focus-visible:text-accent-blue disabled:opacity-50" disabled={bookmarkBusy || likeStateLoading} onClick={() => void toggleBookmark()} type="button">
              <span className="grid h-9 w-9 place-items-center rounded-full transition group-hover:bg-accent-blue/10 group-active:bg-accent-blue/20 group-focus-visible:ring-2 group-focus-visible:ring-accent-blue/80">
                <svg className={'h-5 w-5 ' + (bookmarked ? 'fill-main-accent' : 'fill-none')} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z" /></svg>
              </span>
              {favoriteCount !== null ? <span className="text-xs">{favoriteCount.toLocaleString(dateLocale)}</span> : null}
            </button>
            <button aria-label={shareCount !== null ? 'Share, ' + shareCount + ' shares' : 'Share'} className="group flex items-center gap-2 rounded-full p-2 outline-none transition hover:text-accent-blue focus-visible:text-accent-blue disabled:opacity-50" disabled={shareBusy} onClick={() => void shareContent()} type="button">
              <span className="grid h-9 w-9 place-items-center rounded-full transition group-hover:bg-accent-blue/10 group-active:bg-accent-blue/20 group-focus-visible:ring-2 group-focus-visible:ring-accent-blue/80">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16V3m0 0L7 8m5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>
              </span>
              {shareCount !== null ? <span className="text-xs">{shareCount.toLocaleString(dateLocale)}</span> : null}
            </button>
            {message ? <span className="sr-only" role="status">{message}</span> : null}
          </div>
        </div>
      </article>
    )
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
          {message ? <span className="content-detail-action-status" role="status">{message}</span> : null}
        </footer>
      </div>
    </article>
  )
}
