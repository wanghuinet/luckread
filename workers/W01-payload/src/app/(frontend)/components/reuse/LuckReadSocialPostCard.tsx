"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { getCachedPublicProfile, type PublicProfile } from '../../../../lib/social-post-profile-cache.js'
import { resolveSocialPostMedia } from '../../../../lib/social-post-media.js'
import SocialPoll from './SocialPoll'
import type { PublicLocale } from '../../i18n/public-locale'

/**
 * UI structure adapted from ccrsxx/twitter-clone's Tweet, TweetStats and user
 * components (MIT). All callers use this X timeline presentation; reads and
 * mutations remain on the existing LuckRead W01/W05 APIs.
 */
type ContentDetail = {
  id?: string
  creatorId?: string | null
  state?: string
  version?: number
  etag?: string
  createdAt?: string
  updatedAt?: string
}

type SocialSummary = {
  data?: {
    counts?: { likes?: number; favorites?: number; comments?: number; shares?: number; reposts?: number }
    viewer?: { liked?: boolean; favorited?: boolean; reposted?: boolean } | null
    pinned?: boolean
  }
  error?: { message?: string }
}

type ApiResponse<T> = {
  data?: T
  error?: { message?: string }
}


type TimelineIconName = 'reply' | 'repost' | 'like' | 'bookmark' | 'share' | 'more' | 'pin'

function TimelineIcon({ name, filled = false }: { name: TimelineIconName; filled?: boolean }) {
  if (name === 'more') {
    return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
  }
  const paths: Record<Exclude<TimelineIconName, 'more'>, string> = {
    reply: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 2v-6.5A8.5 8.5 0 1 1 21 11.5Z',
    repost: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4m14-1v2a4 4 0 0 1-4 4H3',
    like: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z',
    bookmark: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z',
    share: 'M18 8a3 3 0 1 0-2.83-4L8.7 7.74a3.5 3.5 0 1 0 0 8.52l6.47 3.74A3 3 0 1 0 16.5 18l-6.47-3.74a3.5 3.5 0 0 0 0-4.52L16.5 6A3 3 0 0 0 18 8Z',
    pin: 'M16 3l5 5-3 1-4 4-1 5-2-2-2-2-2-2-2-2 5-1 4-4 0-2Z',
  }
  return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill={filled && (name === 'like' || name === 'bookmark') ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
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
  /** Existing call sites may declare this mode; rendering is X timeline only. */
  presentation?: 'x-timeline'
  locale?: PublicLocale
  onBookmarkChanged?: (bookmarked: boolean) => void
  onPinChanged?: (contentId: string, pinned: boolean) => void
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
  onBookmarkChanged,
  onPinChanged,
}: Props) {
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [resolvedCreatorId, setResolvedCreatorId] = useState<string | null>(creatorId ?? null)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [contentState, setContentState] = useState<string | null>(null)
  const [contentVersion, setContentVersion] = useState<number | null>(null)
  const [contentEtag, setContentEtag] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const [followRestricted, setFollowRestricted] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [ownerActionBusy, setOwnerActionBusy] = useState(false)
  const [isDeleted, setIsDeleted] = useState(false)
  const [postTimestamp, setPostTimestamp] = useState(createdAt || updatedAt || '')
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState<number | null>(null)
  const [commentCount, setCommentCount] = useState<number | null>(null)
  const [likeStateLoading, setLikeStateLoading] = useState(true)
  const [likeBusy, setLikeBusy] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [reposted, setReposted] = useState(false)
  const [repostCount, setRepostCount] = useState<number | null>(null)
  const [repostBusy, setRepostBusy] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [pinBusy, setPinBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [message, setMessage] = useState('')

  const contentHref = '/content/' + encodeURIComponent(slug || contentId)
  const mediaItems = resolveSocialPostMedia(mediaRefs, coverRef)
  const singleMedia = mediaItems.length === 1 ? mediaItems[0] : undefined
  const profileName = profile?.displayName?.trim() || profile?.username || ''
  const username = profile?.username ? '@' + profile.username : ''
  const profileHref = profile?.username ? '/' + encodeURIComponent(profile.username) : null
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  const isOwnPost = Boolean(viewerUserId && resolvedCreatorId && viewerUserId === resolvedCreatorId)
  const canManagePost = Boolean(
    isOwnPost &&
    contentState === 'PUBLISHED' &&
    typeof contentVersion === 'number' &&
    contentVersion > 0 &&
    contentEtag,
  )
  const formattedDate = postTimestamp && Number.isFinite(Date.parse(postTimestamp))
    ? new Date(postTimestamp).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })
    : ''

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const load = async () => {
      setResolvedCreatorId(creatorId ?? null)
      setViewerUserId(null)
      setContentState(null)
      setContentVersion(null)
      setContentEtag(null)
      setFollowing(false)
      setFollowRestricted(false)
      setPostTimestamp(createdAt || updatedAt || '')
      setProfile(null)
      setBookmarked(false)
      setReposted(false)
      setRepostCount(null)
      setPinned(false)
      setCommentCount(null)
      setLikeStateLoading(true)

      const detailRequest = fetchJson<ContentDetail>(
        '/api/v1/contents/' + encodeURIComponent(contentId),
        {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        },
      )
      const viewerRequest = fetchJson<{ id?: string }>('/api/v1/users/me', {
        credentials: 'include',
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

      const [detailResult, socialResult, viewerResult] = await Promise.allSettled([
        detailRequest,
        socialRequest,
        viewerRequest,
      ])
      if (cancelled) return

      let authorId = creatorId ?? null
      if (detailResult.status === 'fulfilled' && detailResult.value.response.ok) {
        const detail = detailResult.value.data
        authorId = authorId || (typeof detail?.creatorId === 'string' ? detail.creatorId : null)
        setContentState(typeof detail?.state === 'string' ? detail.state : null)
        setContentVersion(typeof detail?.version === 'number' ? detail.version : null)
        setContentEtag(typeof detail?.etag === 'string' ? detail.etag : null)
        setPostTimestamp(createdAt || updatedAt || detail?.createdAt || detail?.updatedAt || '')
        setResolvedCreatorId(authorId)
      }

      let viewerId: string | null = null
      if (
        viewerResult.status === 'fulfilled' &&
        viewerResult.value.response.ok &&
        typeof viewerResult.value.data?.id === 'string'
      ) {
        viewerId = viewerResult.value.data.id
        setViewerUserId(viewerId)
      }

      if (authorId && viewerId && authorId !== viewerId) {
        try {
          const followResult = await fetchJson<ApiResponse<{
            following?: boolean
            relationship?: { blocked?: boolean; blockedBy?: boolean }
          }>>('/api/v1/social/follows/' + encodeURIComponent(authorId), {
            credentials: 'include',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          })
          if (!cancelled && followResult.response.ok) {
            const relationship = followResult.data?.data?.relationship
            setFollowRestricted(relationship?.blocked === true || relationship?.blockedBy === true)
            setFollowing(
              relationship?.blocked !== true &&
              relationship?.blockedBy !== true &&
              followResult.data?.data?.following === true,
            )
          }
        } catch {
          // A failed relationship lookup must not prevent viewing or reporting a public post.
        }
      }

      if (socialResult.status === 'fulfilled') {
        const result = socialResult.value
        const summary = result.data?.data
        setLiked(result.response.ok && summary?.viewer?.liked === true)
        setBookmarked(result.response.ok && summary?.viewer?.favorited === true)
        setLikeCount(result.response.ok && typeof summary?.counts?.likes === 'number'
          ? Math.max(0, summary.counts.likes)
          : null)
        setReposted(result.response.ok && summary?.viewer?.reposted === true)
        setRepostCount(result.response.ok && typeof summary?.counts?.reposts === 'number'
          ? Math.max(0, summary.counts.reposts)
          : null)
        setPinned(result.response.ok && summary?.pinned === true)
        setCommentCount(result.response.ok && typeof summary?.counts?.comments === 'number'
          ? Math.max(0, summary.counts.comments)
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

  const toggleRepost = async () => {
    if (repostBusy || likeStateLoading) return
    const previousReposted = reposted
    setRepostBusy(true)
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<unknown>>(
        '/api/v1/content/' + encodeURIComponent(contentId) + '/reposts',
        {
          method: previousReposted ? 'DELETE' : 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'twitter-clone-reuse-repost:' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        requireLogin()
        return
      }
      if (!response.ok && response.status !== 204) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Repost failed.' : '转推失败，请稍后重试。'))
      }
      setReposted(!previousReposted)
      setRepostCount((current) => current === null
        ? null
        : Math.max(0, current + (previousReposted ? -1 : 1)))
      setMessage(locale === 'en'
        ? (previousReposted ? 'Repost removed.' : 'Reposted.')
        : locale === 'tw'
          ? (previousReposted ? '已取消轉推。' : '已轉推。')
          : (previousReposted ? '已取消转推。' : '已转推。'))
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Repost failed.' : '转推失败，请稍后重试。')
    } finally {
      setRepostBusy(false)
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
      onBookmarkChanged?.(!previousBookmarked)
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Bookmark failed.' : '收藏失败，请稍后重试。')
    } finally {
      setBookmarkBusy(false)
    }
  }


  const toggleFollow = async () => {
    if (!resolvedCreatorId || followBusy || followRestricted || isOwnPost) return
    const wasFollowing = following
    setFollowBusy(true)
    setMoreOpen(false)
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<{ following?: boolean }>>(
        '/api/v1/social/follows/' + encodeURIComponent(resolvedCreatorId),
        {
          method: wasFollowing ? 'DELETE' : 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'twitter-clone-reuse-follow:' + contentId + ':' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        requireLogin()
        return
      }
      if (!response.ok) {
        throw new Error(getApiErrorMessage(
          data,
          locale === 'en' ? 'Follow action failed.' : locale === 'tw' ? '追蹤操作失敗。' : '关注操作失败，请稍后重试。',
        ))
      }
      const nextFollowing = typeof data?.data?.following === 'boolean'
        ? data.data.following
        : !wasFollowing
      setFollowing(nextFollowing)
      setMessage(nextFollowing
        ? (locale === 'en' ? 'Following creator.' : locale === 'tw' ? '已追蹤作者。' : '已关注作者。')
        : (locale === 'en' ? 'Unfollowed creator.' : locale === 'tw' ? '已取消追蹤。' : '已取消关注。'))
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Follow action failed.' : '关注操作失败，请稍后重试。')
    } finally {
      setFollowBusy(false)
    }
  }

  const transitionOwnedContent = async (
    to: 'UNPUBLISHED' | 'DRAFT',
    version: number,
  ): Promise<number> => {
    const { response, data } = await fetchJson<{ version?: unknown; error?: { message?: string } }>(
      '/api/creator/contents/' + encodeURIComponent(contentId) + '/state',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'If-Match': 'W/"' + version + '"',
          'Idempotency-Key': 'twitter-clone-reuse-post-edit:' + contentId + ':' + to + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({ to }),
      },
    )
    if (response.status === 401) {
      requireLogin()
      throw new Error('AUTH_REQUIRED')
    }
    if (!response.ok) {
      throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Post state update failed.' : '动态状态更新失败。'))
    }
    return typeof data?.version === 'number' ? data.version : version + 1
  }

  const editPost = async () => {
    if (!canManagePost || contentVersion === null || ownerActionBusy) return
    const confirmed = window.confirm(locale === 'en'
      ? 'This post will be taken offline and moved to drafts before editing. Continue?'
      : locale === 'tw'
        ? '編輯前會先將此動態下線並轉為草稿，是否繼續？'
        : '编辑前会先将这条动态下线并转为草稿，是否继续？')
    if (!confirmed) return

    setOwnerActionBusy(true)
    setMoreOpen(false)
    setMessage('')
    let hasBeenUnpublished = false
    try {
      const unpublishedVersion = await transitionOwnedContent('UNPUBLISHED', contentVersion)
      hasBeenUnpublished = true
      const draftVersion = await transitionOwnedContent('DRAFT', unpublishedVersion)
      window.location.assign('/publish?draft=' + encodeURIComponent(contentId) + '&version=' + draftVersion)
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return
      const baseMessage = cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Could not open this post for editing.' : '暂时无法进入动态编辑。'
      setMessage(hasBeenUnpublished
        ? baseMessage + (locale === 'en'
          ? ' The post is already offline. Open Creator Studio → Content to finish moving it to drafts.'
          : ' 动态已下线；请进入创作者中心的内容管理，将其转为草稿后继续编辑。')
        : baseMessage)
    } finally {
      setOwnerActionBusy(false)
    }
  }

  const deletePost = async () => {
    if (!canManagePost || !contentEtag || ownerActionBusy) return
    const confirmed = window.confirm(locale === 'en'
      ? 'Delete this post? It will move to the deleted state.'
      : locale === 'tw' ? '確定刪除此動態嗎？內容將進入已刪除狀態。' : '确定删除这条动态吗？内容将进入已删除状态。')
    if (!confirmed) return

    setOwnerActionBusy(true)
    setMoreOpen(false)
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<unknown>>(
        '/api/v1/contents/' + encodeURIComponent(contentId),
        {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'If-Match': contentEtag,
            'Idempotency-Key': 'twitter-clone-reuse-post-delete:' + contentId + ':' + crypto.randomUUID(),
          },
          cache: 'no-store',
        },
      )
      if (response.status === 401) {
        requireLogin()
        return
      }
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Delete failed.' : '删除失败，请稍后重试。'))
      }
      setIsDeleted(true)
      window.dispatchEvent(new Event('luckread:content-mutated'))
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Delete failed.' : '删除失败，请稍后重试。')
    } finally {
      setOwnerActionBusy(false)
    }
  }

  const reportContent = async () => {
    if (reportBusy) return
    setMoreOpen(false)
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

  const toggleProfilePin = async () => {
    if (!canManagePost || pinBusy) return
    const previousPinned = pinned
    setPinBusy(true)
    setMoreOpen(false)
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<unknown>>(
        '/api/v1/content/' + encodeURIComponent(contentId) + '/pin',
        {
          method: previousPinned ? 'DELETE' : 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'twitter-clone-reuse-pin:' + contentId + ':' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        requireLogin()
        return
      }
      if (!response.ok && response.status !== 204) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Pin change failed.' : '置顶操作失败，请稍后重试。'))
      }
      const nextPinned = !previousPinned
      setPinned(nextPinned)
      onPinChanged?.(contentId, nextPinned)
      window.dispatchEvent(new CustomEvent('luckread:profile-pin-changed', {
        detail: { contentId, pinned: nextPinned },
      }))
      setMessage(locale === 'en'
        ? (nextPinned ? 'Pinned to profile.' : 'Removed from profile pin.')
        : locale === 'tw'
          ? (nextPinned ? '已置頂到個人頁。' : '已取消個人頁置頂。')
          : (nextPinned ? '已置顶到个人主页。' : '已取消个人主页置顶。'))
    } catch (cause) {
      setMessage(cause instanceof Error
        ? cause.message
        : locale === 'en' ? 'Pin change failed.' : '置顶操作失败，请稍后重试。')
    } finally {
      setPinBusy(false)
    }
  }

  useEffect(() => {
    const handleProfilePinChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ contentId?: string; pinned?: boolean }>).detail
      if (!detail?.contentId) return
      setPinned(detail.contentId === contentId && detail.pinned === true)
    }
    window.addEventListener('luckread:profile-pin-changed', handleProfilePinChanged)
    return () => window.removeEventListener('luckread:profile-pin-changed', handleProfilePinChanged)
  }, [contentId])

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

  if (isDeleted) return null


    const authorHref = profileHref
    const label = (en: string, zh: string, tw = zh) => locale === 'en' ? en : locale === 'tw' ? tw : zh
    const actionClass = 'group/action inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full p-2 text-light-secondary transition-colors hover:bg-sky-500/10 hover:text-sky-500 disabled:cursor-wait disabled:opacity-50 dark:text-dark-secondary'
    const actionText = 'min-w-[14px] text-xs tabular-nums'
    return (
      <article className="border-b border-light-border px-4 py-3 transition-colors hover:bg-black/[0.025] dark:border-dark-border dark:hover:bg-white/[0.03]" data-testid="luckread-social-post-card">
        <div className="grid grid-cols-[auto,minmax(0,1fr)] gap-x-3">
          {authorHref ? (
            <Link href={authorHref} aria-label={profileName} className="mt-0.5 grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-main-sidebar-background text-sm font-bold text-light-primary dark:text-dark-primary">
              {profile?.avatar ? <img alt="" className="h-full w-full object-cover" height={40} loading="lazy" src={profile.avatar} width={40} /> : profileName ? profileName.slice(0, 1).toUpperCase() : ''}
            </Link>
          ) : (
            <div aria-label={profileName} className="mt-0.5 grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-main-sidebar-background text-sm font-bold text-light-primary dark:text-dark-primary">
              {profile?.avatar ? <img alt="" className="h-full w-full object-cover" height={40} loading="lazy" src={profile.avatar} width={40} /> : profileName ? profileName.slice(0, 1).toUpperCase() : ''}
            </div>
          )}
          <div className="min-w-0">
            {pinned ? <div className="mb-1 flex items-center gap-2 pl-1 text-xs font-bold text-light-secondary dark:text-dark-secondary"><TimelineIcon name="pin" /><span>{label('Pinned', '已置顶', '已置頂')}</span></div> : null}
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-[15px] leading-5">
                {authorHref ? <Link className="max-w-full truncate font-bold text-light-primary hover:underline dark:text-dark-primary" href={authorHref}>{profileName}</Link> : profileName ? <strong className="max-w-full truncate font-bold text-light-primary dark:text-dark-primary">{profileName}</strong> : null}
                {username ? <span className="max-w-full truncate text-light-secondary dark:text-dark-secondary">{username}</span> : null}
                {formattedDate ? <><span aria-hidden="true" className="text-light-secondary dark:text-dark-secondary">·</span><time className="whitespace-nowrap text-light-secondary dark:text-dark-secondary" dateTime={postTimestamp}>{formattedDate}</time></> : null}
              </div>
              <div className="relative -mr-2 -mt-2 shrink-0">
                <button aria-controls={'post-more-actions-' + contentId} aria-expanded={moreOpen} aria-haspopup="true" aria-label={label('Post actions', '动态操作', '動態操作')} className="rounded-full p-2 text-light-secondary transition-colors hover:bg-main-accent/10 hover:text-main-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-main-accent dark:text-dark-secondary" disabled={ownerActionBusy} onClick={() => setMoreOpen((open) => !open)} type="button">
                  <TimelineIcon name="more" />
                </button>
                {moreOpen ? (
                  <div id={'post-more-actions-' + contentId} className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-light-border bg-main-background p-1 text-light-primary shadow-xl dark:border-dark-border dark:text-dark-primary" role="menu" aria-label={label('More post actions', '更多动态操作', '更多動態操作')}>
                    {resolvedCreatorId && !isOwnPost && !followRestricted ? <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5" disabled={followBusy} onClick={() => void toggleFollow()} role="menuitem" type="button">{followBusy ? label('Working…', '处理中…', '處理中…') : following ? label('Unfollow', '取消关注', '取消追蹤') : label('Follow creator', '关注作者', '追蹤作者')}</button> : null}
                    {canManagePost ? <>
                      <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5" aria-pressed={pinned} disabled={pinBusy} onClick={() => void toggleProfilePin()} role="menuitem" type="button">{pinBusy ? label('Working…', '处理中…', '處理中…') : pinned ? label('Unpin from profile', '取消个人主页置顶', '取消個人頁置頂') : label('Pin to profile', '置顶到个人主页', '置頂到個人頁')}</button>
                      <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5" disabled={ownerActionBusy} onClick={() => void editPost()} role="menuitem" type="button">{ownerActionBusy ? label('Working…', '处理中…', '處理中…') : label('Edit post', '编辑动态', '編輯動態')}</button>
                      <button className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-500/10" disabled={ownerActionBusy} onClick={() => void deletePost()} role="menuitem" type="button">{ownerActionBusy ? label('Deleting…', '删除中…', '刪除中…') : label('Delete post', '删除动态', '刪除動態')}</button>
                    </> : null}
                    <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5" disabled={reportBusy} onClick={() => void reportContent()} role="menuitem" type="button">{reportBusy ? label('Reporting…', '举报中…', '檢舉中…') : label('Report post', '举报动态', '檢舉動態')}</button>
                    <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setMoreOpen(false)} role="menuitem" type="button">{label('Close menu', '关闭菜单', '關閉選單')}</button>
                  </div>
                ) : null}
              </div>
            </div>
            <Link className="block whitespace-pre-wrap break-words text-[15px] leading-5 text-light-primary dark:text-dark-primary" href={contentHref} data-umami-event="content-open" data-umami-event-content-type="post">
              {title}
            </Link>
            {singleMedia ? (
              <div className="mt-3 overflow-hidden rounded-2xl border border-light-border dark:border-dark-border">
                {singleMedia.kind === 'video' ? <video aria-label={title} className="block max-h-[510px] w-full bg-black object-contain" controls muted playsInline preload="metadata" poster={singleMedia.poster} src={singleMedia.src} /> : <img alt={title} className="block max-h-[510px] w-full object-cover" loading="lazy" src={singleMedia.src} />}
              </div>
            ) : mediaItems.length > 1 ? (
              <div className="mt-3 grid grid-cols-2 gap-0.5 overflow-hidden rounded-2xl border border-light-border dark:border-dark-border" role="group" aria-label={label('Post media', '动态媒体', '動態媒體')}>
                {mediaItems.map((media) => media.kind === 'video' ? (
                  <video key={media.src} aria-label={title} className="aspect-square max-h-[300px] w-full bg-black object-cover" controls muted playsInline preload="metadata" poster={media.poster} src={media.src} />
                ) : <img key={media.src} alt="" className="aspect-square max-h-[300px] w-full object-cover" loading="lazy" src={media.src} />)}
              </div>
            ) : null}
            <footer className="mt-2 flex items-center justify-between gap-1 text-light-secondary dark:text-dark-secondary">
              <Link aria-label={label('Reply or discuss', '回复或讨论', '回覆或討論')} className={actionClass} href={contentHref}>
                <TimelineIcon name="reply" /><span className={actionText}>{commentCount === null ? '' : commentCount.toLocaleString(dateLocale)}</span>
              </Link>
              <button aria-label={reposted ? label('Undo repost', '取消转推', '取消轉推') : label('Repost', '转推', '轉推')} aria-pressed={reposted} className={actionClass} disabled={repostBusy || likeStateLoading} onClick={() => void toggleRepost()} title={reposted ? label('Undo repost', '取消转推', '取消轉推') : label('Repost', '转推', '轉推')} type="button">
                <TimelineIcon name="repost" /><span className={actionText}>{repostBusy ? '…' : repostCount === null ? '' : repostCount.toLocaleString(dateLocale)}</span>
              </button>
              <button aria-label={liked ? label('Unlike', '取消点赞', '取消按赞') : label('Like', '点赞', '按赞')} aria-pressed={liked} className={actionClass + (liked ? ' text-pink-500 dark:text-pink-400' : '')} disabled={likeBusy || likeStateLoading} onClick={() => void toggleLike()} title={liked ? label('Unlike', '取消点赞', '取消按赞') : label('Like', '点赞', '按赞')} type="button">
                <TimelineIcon name="like" filled={liked} /><span className={actionText}>{likeStateLoading ? '…' : likeCount === null ? '' : likeCount.toLocaleString(dateLocale)}</span>
              </button>
              <button aria-label={bookmarked ? label('Remove bookmark', '取消收藏', '取消收藏') : label('Bookmark', '收藏', '收藏')} aria-pressed={bookmarked} className={actionClass + (bookmarked ? ' text-sky-500 dark:text-sky-400' : '')} disabled={bookmarkBusy || likeStateLoading} onClick={() => void toggleBookmark()} title={bookmarked ? label('Remove bookmark', '取消收藏', '取消收藏') : label('Bookmark', '收藏', '收藏')} type="button">
                <TimelineIcon name="bookmark" filled={bookmarked} /><span className={actionText}>{bookmarkBusy ? '…' : ''}</span>
              </button>
              <button aria-label={label('Share post', '分享动态', '分享動態')} className={actionClass} disabled={shareBusy} onClick={() => void shareContent()} title={label('Share', '分享', '分享')} type="button">
                <TimelineIcon name="share" /><span className={actionText}>{shareBusy ? '…' : ''}</span>
              </button>
            </footer>
            {message ? <p className="mt-2 rounded-lg bg-main-sidebar-background px-3 py-2 text-xs text-light-secondary dark:text-dark-secondary" role="status">{message}</p> : null}
          </div>
        </div>
      </article>
    )

}
