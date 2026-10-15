"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import type { PublicLocale } from '../../i18n/public-locale'
import styles from './LuckReadSocialPostCard.module.css'

/**
 * UI structure adapted from ccrsxx/twitter-clone's Tweet, TweetStats and user
 * components (MIT). All data and mutations here use LuckRead's W01/W05 APIs.
 */
type PublicProfile = {
  id: string
  username?: string
  displayName?: string | null
  avatar?: string | null
}

type ContentDetail = {
  id?: string
  creatorId?: string | null
  createdAt?: string
  updatedAt?: string
}

type SocialSummary = {
  data?: {
    counts?: { likes?: number }
    viewer?: { liked?: boolean } | null
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
  const [message, setMessage] = useState('')

  const contentHref = '/content/' + encodeURIComponent(slug || contentId)
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
        setLikeCount(result.response.ok && typeof summary?.counts?.likes === 'number'
          ? Math.max(0, summary.counts.likes)
          : null)
      }

      if (authorId) {
        try {
          const { response, data } = await fetchJson<PublicProfile>(
            '/api/v1/users/' + encodeURIComponent(authorId),
            {
              headers: { accept: 'application/json' },
              cache: 'no-store',
              signal: controller.signal,
            },
          )
          if (!cancelled && response.ok && data && typeof data.id === 'string') setProfile(data)
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

  return (
    <article className={styles.card} data-testid="luckread-social-post-card">
      <header className={styles.header}>
        {resolvedCreatorId ? (
          <Link className={styles.avatarLink} href={'/users/' + encodeURIComponent(resolvedCreatorId)} aria-label={profileName}>
            {profile?.avatar ? (
              <img className={styles.avatar} src={profile.avatar} alt="" loading="lazy" />
            ) : (
              <span className={styles.avatarFallback}>{profileName.slice(0, 1).toUpperCase()}</span>
            )}
          </Link>
        ) : (
          <span className={styles.avatarFallback} aria-hidden="true">L</span>
        )}
        <div className={styles.author}>
          <strong>{profileName}</strong>
          <span>
            {username ? username + (formattedDate ? ' · ' : '') : ''}
            {formattedDate}
          </span>
        </div>
        {resolvedCreatorId ? (
          <Link className={styles.profileLink} href={'/users/' + encodeURIComponent(resolvedCreatorId)}>
            {locale === 'en' ? 'Profile' : locale === 'tw' ? '個人頁' : '主页'}
          </Link>
        ) : null}
      </header>

      <Link className={styles.bodyLink} href={contentHref} data-umami-event="content-open" data-umami-event-content-type="post">
        <p className={styles.postText}>{title}</p>
        {coverRef ? <img className={styles.cover} src={coverRef} alt="" loading="lazy" /> : null}
        <span className={styles.readMore}>{locale === 'en' ? 'Open discussion' : locale === 'tw' ? '查看討論' : '查看讨论'} ↗</span>
      </Link>

      <footer className={styles.actions}>
        <Link className={styles.action} href={contentHref} aria-label={locale === 'en' ? 'Open replies' : '打开评论'}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />
          </svg>
          <span>{locale === 'en' ? 'Discuss' : locale === 'tw' ? '討論' : '讨论'}</span>
        </Link>
        <button
          className={liked ? styles.actionLiked : styles.action}
          type="button"
          disabled={likeBusy || likeStateLoading}
          aria-pressed={liked}
          onClick={() => void toggleLike()}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z" />
          </svg>
          <span>{likeStateLoading ? '…' : likeCount === null ? (liked ? (locale === 'en' ? 'Liked' : '已赞') : (locale === 'en' ? 'Like' : '点赞')) : likeCount.toLocaleString(dateLocale)}</span>
        </button>
      </footer>
      {message ? <p className={styles.message} role="status">{message}</p> : null}
    </article>
  )
}
