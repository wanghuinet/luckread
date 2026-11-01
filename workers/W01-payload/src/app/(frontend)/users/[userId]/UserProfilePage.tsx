'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { buildPublicContentHref } from '../../../../lib/public-content-url.js'
import { usePublicLocale } from '../../i18n/PublicLanguageToggle'
import TwitterCloneSecondaryPageLayout from '../../../(twitter-clone)/TwitterCloneSecondaryPageLayout'
import TwitterCloneProfileHeader from './TwitterCloneProfileHeader'
import TwitterCloneProfileNav from './TwitterCloneProfileNav'
import LuckReadSocialPostCard from '../../components/reuse/LuckReadSocialPostCard'

type PublicProfile = {
  id: string
  identityId?: string | null
  username: string
  displayName: string | null
  bio: string | null
  avatar: string | null
}

type CountResponse = {
  data?: {
    totalCount?: number
  }
}

type PublicContent = {
  id: string
  slug?: string
  creatorId?: string | null
  createdAt?: string
  contentType: 'article' | 'post' | 'video'
  title: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

type ContentListResponse = {
  data?: {
    items?: PublicContent[]
    nextCursor?: string | null
    hasMore?: boolean
  }
}

type ProfilePinResponse = {
  data?: { contentId?: string | null } | null
}

const sortPinnedFirst = <T extends { id: string; updatedAt?: string; createdAt?: string }>(
  items: T[],
  pinnedContentId: string | null,
): T[] => {
  const chronological = [...items].sort((left, right) => {
    const leftDate = Date.parse(left.updatedAt || left.createdAt || '')
    const rightDate = Date.parse(right.updatedAt || right.createdAt || '')
    const dateDelta = (Number.isFinite(rightDate) ? rightDate : 0) - (Number.isFinite(leftDate) ? leftDate : 0)
    return dateDelta || right.id.localeCompare(left.id)
  })
  return pinnedContentId
    ? chronological.sort((left, right) => Number(right.id === pinnedContentId) - Number(left.id === pinnedContentId))
    : chronological
}

type ProfileReply = {
  id: string
  contentId: string
  authorUserId: string
  parentId: string | null
  body: string
  depth: number
  createdAt: string
  updatedAt: string
}

type ProfileReplyListResponse = {
  data?: {
    items?: ProfileReply[]
    nextCursor?: string | null
    hasMore?: boolean
  }
}

type ProfileLikedContentRef = {
  contentId: string
  likedAt: string
}

type ProfileLikedContentListResponse = {
  data?: {
    items?: ProfileLikedContentRef[]
    nextCursor?: string | null
    hasMore?: boolean
  }
}

type ProfileChannel = 'posts' | 'replies' | 'media' | 'likes' | 'articles'

const filterLabels: Record<ProfileChannel, string> = {
  posts: '帖子',
  replies: '回复',
  media: '媒体',
  likes: '点赞',
  articles: '文章',
}

const contentTypeLabels: Record<PublicContent['contentType'], string> = {
  article: '文章',
  post: '笔记',
  video: '视频',
}

export default function PublicProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const router = useRouter()
  const locale = usePublicLocale()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [followers, setFollowers] = useState<number | null>(null)
  const [following, setFollowing] = useState<number | null>(null)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [isFollowing, setIsFollowing] = useState(false)
  const [mutualFollow, setMutualFollow] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [blockedBy, setBlockedBy] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const [muted, setMuted] = useState(false)
  const [muteBusy, setMuteBusy] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)
  const [reportReasonCode, setReportReasonCode] = useState('ABUSE')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [safetyMessage, setSafetyMessage] = useState('')
  const [filter, setFilter] = useState<ProfileChannel>('posts')
  const [contents, setContents] = useState<PublicContent[]>([])
  const [pinnedContentId, setPinnedContentId] = useState<string | null>(null)
  const [pinnedContent, setPinnedContent] = useState<PublicContent | null>(null)
  const [replies, setReplies] = useState<ProfileReply[]>([])
  const [contentCursor, setContentCursor] = useState<string | null>(null)
  const [contentHasMore, setContentHasMore] = useState(false)
  const [contentLoading, setContentLoading] = useState(true)
  const [contentError, setContentError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const contentRequestRef = useRef<AbortController | null>(null)
  const contentRequestIdRef = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    void (async () => {
      try {
        const { userId } = await params
        const profileResult = await fetchJson<PublicProfile | { error?: { message?: string } }>('/api/v1/users/' + encodeURIComponent(userId), {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = profileResult.data
        if (profileResult.response.status === 404) throw new Error('USER_NOT_FOUND')
        if (!profileResult.response.ok || !data || !('id' in data)) {
          throw new Error(getApiErrorMessage(data, '资料加载失败'))
        }

        if (cancelled) return
        setProfile(data)
        const canonicalProfileId = typeof data.identityId === 'string' && data.identityId.trim()
          ? data.identityId.trim()
          : data.id

        const [followerResult, followingResult, followResult, contentResult, viewerResult, pinResult] = await Promise.all([
          fetchJson<CountResponse>('/api/v1/users/' + encodeURIComponent(userId) + '/followers?limit=1', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetchJson<CountResponse>('/api/v1/users/' + encodeURIComponent(userId) + '/following?limit=1', {
            credentials: 'include',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetchJson<{
            data?: {
              following?: boolean
              relationship?: {
                mutualFollow?: boolean
                blocked?: boolean
                blockedBy?: boolean
                muted?: boolean
              }
            }
            error?: { message?: string }
          }>('/api/v1/social/follows/' + encodeURIComponent(userId), {
            credentials: 'include',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetchJson<ContentListResponse>('/api/v1/contents?creatorId=' + encodeURIComponent(canonicalProfileId) + '&limit=6&type=post', {
            headers: { accept: 'application/json' },
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetchJson<{ id?: string; identityId?: string | null }>('/api/v1/users/me', {
            credentials: 'include',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetchJson<ProfilePinResponse>('/api/v1/users/' + encodeURIComponent(userId) + '/pinned-content', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
        ])

        const followerData = followerResult.data
        const followingData = followingResult.data
        const followData = followResult.data
        const contentData = contentResult.data
        const viewerData = viewerResult.data

        if (!cancelled) {
          setFollowers(typeof followerData?.data?.totalCount === 'number' ? followerData.data.totalCount : 0)
          setFollowing(typeof followingData?.data?.totalCount === 'number' ? followingData.data.totalCount : 0)
          setViewerUserId(typeof viewerData?.identityId === 'string' ? viewerData.identityId : typeof viewerData?.id === 'string' ? viewerData.id : null)
          setIsFollowing(followData?.data?.following === true)
          setMutualFollow(followData?.data?.relationship?.mutualFollow === true)
          setBlocked(followData?.data?.relationship?.blocked === true)
          setBlockedBy(followData?.data?.relationship?.blockedBy === true)
          setMuted(followData?.data?.relationship?.muted === true)
          let items = Array.isArray(contentData?.data?.items) ? contentData.data.items : []
          const pinRecord = pinResult.response.ok ? pinResult.data?.data : null
          const nextPinnedContentId = pinRecord && typeof pinRecord.contentId === 'string' ? pinRecord.contentId : null
          let nextPinnedContent = nextPinnedContentId
            ? items.find((item) => item.id === nextPinnedContentId) ?? null
            : null
          if (nextPinnedContentId && !nextPinnedContent) {
            try {
              const pinnedDetail = await fetchJson<{ data?: PublicContent }>(
                '/api/v1/contents/' + encodeURIComponent(nextPinnedContentId),
                {
                  headers: { accept: 'application/json' },
                  credentials: 'omit',
                  cache: 'no-store',
                  signal: controller.signal,
                },
              )
              const pinnedItem = pinnedDetail.data?.data
              if (
                pinnedDetail.response.ok &&
                pinnedItem?.id === nextPinnedContentId &&
                pinnedItem.contentType === 'post'
              ) {
                nextPinnedContent = pinnedItem
                items = [...items, pinnedItem]
              }
            } catch (cause) {
              if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
            }
          }
          setPinnedContentId(nextPinnedContentId)
          setPinnedContent(nextPinnedContent)
          setContents(sortPinnedFirst(items, nextPinnedContentId))
          setContentCursor(typeof contentData?.data?.nextCursor === 'string' ? contentData.data.nextCursor : null)
          setContentHasMore(contentData?.data?.hasMore === true)
          setContentError(contentResult.response.ok ? '' : '暂时无法加载作者作品。')
        }
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return
        setError(cause instanceof Error && cause.message === 'USER_NOT_FOUND' ? '用户不存在。' : '暂时无法加载该用户资料。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      contentRequestIdRef.current += 1
      contentRequestRef.current?.abort()
      contentRequestRef.current = null
    }
  }, [params])

  async function reloadContents(nextFilter: ProfileChannel) {
    if (!profile) return
    contentRequestRef.current?.abort()
    const controller = new AbortController()
    contentRequestRef.current = controller
    const requestId = ++contentRequestIdRef.current

    setFilter(nextFilter)
    setContentLoading(true)
    setContentError('')
    setContents([])
    setReplies([])
    setContentCursor(null)
    setContentHasMore(false)

    try {
      if (nextFilter === 'replies') {
        const { response, data } = await fetchJson<ProfileReplyListResponse & { error?: { message?: string } }>(
          '/api/v1/users/' + encodeURIComponent(profile.identityId || profile.id) + '/replies?limit=6',
          { headers: { accept: 'application/json' }, credentials: 'include', cache: 'no-store', signal: controller.signal },
        )
        if (!response.ok || !Array.isArray(data?.data?.items)) throw new Error('PROFILE_REPLIES_FAILED')
        if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return
        setReplies(data.data.items)
        setContentCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
        setContentHasMore(data.data.hasMore === true)
        return
      }

      if (nextFilter === 'likes') {
        const { response, data } = await fetchJson<ProfileLikedContentListResponse & { error?: { message?: string } }>(
          '/api/v1/users/' + encodeURIComponent(profile.identityId || profile.id) + '/likes?limit=6',
          { headers: { accept: 'application/json' }, credentials: 'include', cache: 'no-store', signal: controller.signal },
        )
        if (!response.ok || !Array.isArray(data?.data?.items)) throw new Error('PROFILE_LIKES_FAILED')
        const items = await loadLikedContentDetails(data.data.items, controller.signal)
        if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return
        setContents(sortPinnedFirst(items, pinnedContentId))
        setContentCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
        setContentHasMore(data.data.hasMore === true)
        return
      }

      const queryParts = [
        'creatorId=' + encodeURIComponent(profile.identityId || profile.id),
        'limit=6',
      ]
      if (nextFilter === 'posts') queryParts.push('type=post')
      if (nextFilter === 'articles') queryParts.push('type=article')
      const { response, data } = await fetchJson<ContentListResponse & { error?: { message?: string } }>('/api/v1/contents?' + queryParts.join('&'), {
        headers: { accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok || !Array.isArray(data?.data?.items)) throw new Error('CONTENT_LIST_FAILED')
      if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return
      let nextItems = nextFilter === 'media' ? data.data.items.filter(isMediaContent) : data.data.items
      if (nextFilter === 'posts' && pinnedContent && !nextItems.some((item) => item.id === pinnedContent.id)) {
        nextItems = [...nextItems, pinnedContent]
      }
      setContents(sortPinnedFirst(nextItems, pinnedContentId))
      setContentCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
      setContentHasMore(data.data.hasMore === true)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (requestId !== contentRequestIdRef.current) return
      setContentError(nextFilter === 'replies' ? '暂时无法加载回复/讨论，请稍后重试。' : nextFilter === 'likes' ? '暂时无法加载点赞内容，请稍后重试。' : '暂时无法加载作品，请稍后重试。')
    } finally {
      if (requestId === contentRequestIdRef.current) setContentLoading(false)
    }
  }

  async function loadMoreContents() {
    if (contentLoading || !contentHasMore || !contentCursor || !profile) return
    contentRequestRef.current?.abort()
    const controller = new AbortController()
    contentRequestRef.current = controller
    const requestId = ++contentRequestIdRef.current
    setContentLoading(true)

    try {
      if (filter === 'replies') {
        const query = new URLSearchParams({ limit: '6', cursor: contentCursor })
        const { response, data } = await fetchJson<ProfileReplyListResponse & { error?: { message?: string } }>(
          '/api/v1/users/' + encodeURIComponent(profile.identityId || profile.id) + '/replies?' + query.toString(),
          { headers: { accept: 'application/json' }, credentials: 'include', cache: 'no-store', signal: controller.signal },
        )
        if (!response.ok || !Array.isArray(data?.data?.items)) throw new Error('PROFILE_REPLIES_FAILED')
        if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return
        setReplies((current) => [...current, ...data.data.items])
        setContentCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
        setContentHasMore(data.data.hasMore === true)
        return
      }

      if (filter === 'likes') {
        const query = new URLSearchParams({ limit: '6', cursor: contentCursor })
        const { response, data } = await fetchJson<ProfileLikedContentListResponse & { error?: { message?: string } }>(
          '/api/v1/users/' + encodeURIComponent(profile.identityId || profile.id) + '/likes?' + query.toString(),
          { headers: { accept: 'application/json' }, credentials: 'include', cache: 'no-store', signal: controller.signal },
        )
        if (!response.ok || !Array.isArray(data?.data?.items)) throw new Error('PROFILE_LIKES_FAILED')
        const nextItems = await loadLikedContentDetails(data.data.items, controller.signal)
        if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return
        setContents((current) => sortPinnedFirst([...current, ...nextItems], pinnedContentId))
        setContentCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
        setContentHasMore(data.data.hasMore === true)
        return
      }

      const query = new URLSearchParams({
        creatorId: profile.identityId || profile.id,
        limit: '6',
        cursor: contentCursor,
      })
      if (filter === 'posts') query.set('type', 'post')
      if (filter === 'articles') query.set('type', 'article')
      const { response, data } = await fetchJson<ContentListResponse & { error?: { message?: string } }>('/api/v1/contents?' + query.toString(), {
        headers: { accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok || !Array.isArray(data?.data?.items)) throw new Error('CONTENT_LIST_FAILED')
      if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return
      const nextItems = filter === 'media' ? data.data.items.filter(isMediaContent) : data.data.items
      setContents((current) => sortPinnedFirst([...current, ...nextItems], pinnedContentId))
      setContentCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
      setContentHasMore(data.data.hasMore === true)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (requestId !== contentRequestIdRef.current) return
      setContentError('暂时无法加载更多内容，请稍后重试。')
    } finally {
      if (requestId === contentRequestIdRef.current) setContentLoading(false)
    }
  }

  async function toggleFollow() {
    if (!profile || followBusy) return
    setFollowBusy(true)
    setError('')

    try {
      const { response, data } = await fetchJson<{ data?: { following?: boolean }; error?: { message?: string } }>('/api/v1/social/follows/' + encodeURIComponent(profile.identityId || profile.id), {
        method: isFollowing ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'social-follow:' + crypto.randomUUID(),
        },
      })

      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'FOLLOW_FAILED'))
      }

      if (isFollowing) {
        setIsFollowing(false)
        setFollowers((value) => value === null ? value : Math.max(0, value - 1))
        return
      }

      if (typeof data?.data?.following !== 'boolean') throw new Error('FOLLOW_FAILED')
      setIsFollowing(data.data.following)
      if (data.data.following) {
        setFollowers((value) => value === null ? value : value + 1)
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError('关注操作失败，请稍后重试。')
    } finally {
      setFollowBusy(false)
    }
  }

  async function reportProfile() {
    if (!profile || reportBusy || !reportReasonCode.trim()) return

    setReportBusy(true)
    setSafetyMessage('')
    try {
      const { response, data } = await fetchJson<{ data?: { status?: string }; error?: { message?: string } }>('/api/v1/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'report:profile:' + (profile.identityId || profile.id) + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'profile', targetId: profile.identityId || profile.id, reasonCode: reportReasonCode }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data) throw new Error(getApiErrorMessage(data, 'REPORT_FAILED'))
      setSafetyMessage(data.data.status === 'DEDUPLICATED' ? '举报已记录：你此前已举报过该用户。' : '举报已提交。')
      setReportDialogOpen(false)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setSafetyMessage('举报提交失败，请稍后重试。')
    } finally {
      setReportBusy(false)
    }
  }

  async function applySafetyAction(action: 'block' | 'mute') {
    if (!profile) return
    const active = action === 'block' ? blocked : muted
    const busy = action === 'block' ? blockBusy : muteBusy
    if (busy) return

    if (action === 'block') setBlockBusy(true)
    else setMuteBusy(true)
    setSafetyMessage('')

    try {
      const relationPath = action === 'block' ? 'blocks' : 'mutes'
      const { response } = await fetchJson('/api/v1/interactions/' + relationPath + (active ? '/' + encodeURIComponent(profile.identityId || profile.id) : ''), {
        method: active ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'social-' + action + ':' + (active ? 'remove:' : 'set:') + crypto.randomUUID(),
          ...(active ? {} : { 'content-type': 'application/json' }),
        },
        ...(active ? {} : { body: JSON.stringify({ targetUserId: profile.identityId || profile.id }) }),
      })

      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }

      if (!response.ok) throw new Error('SAFETY_ACTION_FAILED')

      if (action === 'block') {
        setBlocked(!active)
        setSafetyMessage(active ? '已取消屏蔽。' : '已屏蔽该作者。')
      } else {
        setMuted(!active)
        setSafetyMessage(active ? '已取消静音。' : '已静音该作者。')
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setSafetyMessage(
        action === 'block'
          ? (active ? '取消屏蔽失败，请稍后重试。' : '屏蔽操作失败，请稍后重试。')
          : (active ? '取消静音失败，请稍后重试。' : '静音操作失败，请稍后重试。'),
      )
    } finally {
      if (action === 'block') setBlockBusy(false)
      else setMuteBusy(false)
    }
  }

  async function shareProfile() {
    if (!profile) return
    const shareData = {
      title: displayName(profile),
      text: 'LuckRead Creator',
      url: window.location.href,
    }
    try {
      if (navigator.share) {
        await navigator.share(shareData)
        return
      }
      await navigator.clipboard.writeText(window.location.href)
      setSafetyMessage('主页链接已复制。')
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setSafetyMessage('暂时无法分享该主页。')
    }
  }

  if (loading) {
    const loadingTitle = locale === 'en' ? 'Profile' : locale === 'tw' ? '個人主頁' : '个人主页'
    return (
      <TwitterCloneSecondaryPageLayout locale={locale} title={loadingTitle} active="profile">
        <p className="px-4 py-5 text-sm text-light-secondary dark:text-dark-secondary" role="status" aria-busy="true">
          {locale === 'en' ? 'Loading profile…' : locale === 'tw' ? '正在載入個人主頁…' : '正在加载个人主页…'}
        </p>
      </TwitterCloneSecondaryPageLayout>
    )
  }

  if (error && !profile) {
    const errorTitle = locale === 'en' ? 'Profile' : locale === 'tw' ? '個人主頁' : '个人主页'
    return (
      <TwitterCloneSecondaryPageLayout locale={locale} title={errorTitle} active="profile">
        <div className="flex flex-col items-start gap-3 px-4 py-8 text-sm" role="alert">
          <p>{error}</p>
          <Link className="rounded-full border border-light-border px-4 py-2 font-bold dark:border-dark-border" href="/content">
            {locale === 'en' ? 'Explore content' : locale === 'tw' ? '探索內容' : '返回发现'}
          </Link>
        </div>
      </TwitterCloneSecondaryPageLayout>
    )
  }

  const name = displayName(profile)
  const initial = name.slice(0, 1).toUpperCase()
  const visibleContents = filter === 'media'
    ? contents.filter(isMediaContent)
    : filter === 'posts'
      ? contents.filter((item) => item.contentType === 'post')
      : filter === 'articles'
        ? contents.filter((item) => item.contentType === 'article')
        : filter === 'likes'
          ? contents
          : []

  function getContentHref(item: PublicContent) {
    return buildPublicContentHref({
      id: item.id,
      slug: item.slug,
      contentType: item.contentType,
      authorUsername: profile?.username,
    })
  }

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={name} active="profile">
      <section className="flex min-w-0 w-full flex-col pb-20">
        <div className="border-b border-light-border px-4 py-2 dark:border-dark-border">
          <Link className="main-tab inline-flex rounded-full px-3 py-2 text-sm font-bold hover:bg-light-primary/10 dark:hover:bg-dark-primary/10" href="/content">← 返回发现</Link>
        </div>

        <TwitterCloneProfileHeader
          profile={profile!}
          name={name}
          initial={initial}
          following={following}
          followers={followers}
          locale={locale}
          workCount={contents.length}
          statusMessage={viewerUserId !== (profile.identityId || profile.id) ? safetyMessage : undefined}
          actions={
            <>
          <div className="flex items-center justify-end gap-2" aria-label="快捷操作">
            {viewerUserId !== (profile.identityId || profile.id) ? (
              <button
                className="main-tab grid h-10 w-10 place-items-center rounded-full border border-light-border hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10"
                type="button"
                aria-label="私信"
                onClick={() => setSafetyMessage('私信功能将在消息中心接通后启用。')}
              >
                <span aria-hidden="true">✉</span>
              </button>
            ) : null}
            <div className="relative">
              <button
                className="main-tab grid h-10 w-10 place-items-center rounded-full border border-light-border hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10"
                type="button"
                aria-label="更多操作"
                aria-expanded={actionsOpen}
                aria-haspopup="menu"
                onClick={() => setActionsOpen((open) => !open)}
              >
                <span aria-hidden="true">•••</span>
              </button>
              {actionsOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-36 rounded-2xl border border-light-border bg-main-background p-1 shadow-lg dark:border-dark-border" role="menu" aria-label="更多操作">
                  <button
                    className="block min-h-10 w-full rounded-lg px-3 text-left text-sm font-medium hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-dark-primary/10"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false)
                      void shareProfile()
                    }}
                  >
                    分享
                  </button>
                  {viewerUserId !== (profile.identityId || profile.id) ? (
                    <>
                      <button
                        className="block min-h-10 w-full rounded-lg px-3 text-left text-sm font-medium hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-dark-primary/10"
                        type="button"
                        role="menuitem"
                        disabled={muteBusy}
                        onClick={() => {
                          setActionsOpen(false)
                          void applySafetyAction('mute')
                        }}
                      >
                        {muteBusy ? (muted ? '取消中…' : '静音中…') : muted ? '取消静音' : '静音'}
                      </button>
                      <button
                        className="block min-h-10 w-full rounded-lg px-3 text-left text-sm font-medium hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-dark-primary/10"
                        type="button"
                        role="menuitem"
                        disabled={blockBusy}
                        onClick={() => {
                          setActionsOpen(false)
                          void applySafetyAction('block')
                        }}
                      >
                        {blockBusy ? (blocked ? '取消中…' : '屏蔽中…') : blocked ? '取消屏蔽' : '屏蔽'}
                      </button>
                      <button
                        className="block min-h-10 w-full rounded-lg px-3 text-left text-sm font-medium hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-dark-primary/10"
                        type="button"
                        role="menuitem"
                        disabled={reportBusy}
                        onClick={() => {
                          setActionsOpen(false)
                          setReportReasonCode('ABUSE')
                          setReportDialogOpen(true)
                        }}
                      >
                        {reportBusy ? '举报中…' : '举报'}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {viewerUserId === (profile.identityId || profile.id) ? (
              <Link className="rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white hover:brightness-90 disabled:opacity-50" href="/me/profile">
                {locale === 'en' ? 'Edit profile' : locale === 'tw' ? '編輯個人資料' : '编辑资料'}
              </Link>
            ) : !blocked && !blockedBy ? (
              <button
                className="rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white hover:brightness-90 disabled:opacity-50"
                disabled={followBusy}
                onClick={() => void toggleFollow()}
                type="button"
              >
                {followBusy ? '处理中…' : isFollowing ? '已关注' : '关注'}
              </button>
            ) : null}
            {viewerUserId !== (profile.identityId || profile.id) ? (
              <button
                className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10"
                type="button"
                onClick={() => setSafetyMessage('订阅入口将在会员功能接通后启用。')}
              >
                订阅
              </button>
            ) : null}
            {mutualFollow ? <span className="rounded-full bg-main-sidebar-background px-3 py-2 text-xs font-bold text-light-secondary dark:text-dark-secondary">互相关注</span> : null}
          </div>
            </>
          }
        />

        <TwitterCloneProfileNav
          selected={filter}
          labels={filterLabels}
          onSelect={(value) => { void reloadContents(value) }}
        />

        <section className="min-w-0 w-full" id="works" aria-label="作者内容">
          <header className="flex justify-end px-4 py-2">
            {contentHasMore && contentCursor ? (
              <button
                className="main-tab rounded-full px-3 py-1.5 text-sm font-bold text-light-secondary hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:text-dark-secondary dark:hover:bg-dark-primary/10"
                type="button"
                disabled={contentLoading}
                onClick={() => void loadMoreContents()}
              >
                {contentLoading ? '加载中…' : '加载更多'}
              </button>
            ) : null}
          </header>

          {contentError ? (
            <p className="border-b border-light-border px-4 py-3 text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary" role="status">
              {contentError}
            </p>
          ) : null}
          {contentLoading && contents.length === 0 && replies.length === 0 ? (
            <div className="grid min-h-24 place-items-center border-b border-light-border px-4 py-10 text-center text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary">
              <p role="status">正在加载{filterLabels[filter]}…</p>
            </div>
          ) : null}
          {!contentLoading && visibleContents.length === 0 && replies.length === 0 && !contentError ? (
            <div className="grid min-h-24 place-items-center border-b border-light-border px-4 py-10 text-center text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary">
              <p>{filter === 'replies' ? '暂无回复或讨论' : filter === 'likes' ? '暂无点赞内容' : '暂无' + filterLabels[filter] + '公开作品'}</p>
            </div>
          ) : null}

          {filter === 'replies' && replies.length > 0 ? (
            <div className="flex min-w-0 flex-col">
              {replies.map((reply) => (
                <Link
                  className="block min-w-0 border-b border-light-border px-4 py-3 transition-colors hover:bg-black/[0.025] dark:border-dark-border dark:hover:bg-white/[0.03]"
                  href={'/content/' + encodeURIComponent(reply.contentId)}
                  key={reply.id}
                >
                  <div className="min-w-0">
                    <span className="mb-1 block text-xs text-light-secondary dark:text-dark-secondary">
                      {reply.parentId ? '回复讨论' : '讨论'}
                    </span>
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-5">{reply.body}</p>
                    <time className="mt-2 block text-xs text-light-secondary dark:text-dark-secondary" dateTime={reply.createdAt}>
                      {new Date(reply.createdAt).toLocaleDateString('zh-CN')}
                    </time>
                  </div>
                </Link>
              ))}
            </div>
          ) : null}

          {visibleContents.length > 0 ? (
            <div className="flex min-w-0 flex-col">
              {visibleContents.map((item) => {
                if (item.contentType === 'post') {
                  return (
                    <LuckReadSocialPostCard
                      key={item.id}
                      contentId={item.id}
                      slug={item.slug}
                      title={item.title}
                      creatorId={item.creatorId ?? (profile?.identityId || profile?.id)}
                      presentation="x-timeline"
                      coverRef={item.coverRef}
                      mediaRefs={item.mediaRefs}
                      createdAt={item.createdAt}
                      updatedAt={item.updatedAt}
                      locale="zh"
                      onPinChanged={(changedContentId, isPinned) => {
                        const nextPinnedContentId = isPinned ? changedContentId : null
                        const nextPinnedContent = isPinned
                          ? contents.find((content) => content.id === changedContentId) ?? null
                          : null
                        setPinnedContentId(nextPinnedContentId)
                        setPinnedContent(nextPinnedContent)
                        setContents((current) => sortPinnedFirst(current, nextPinnedContentId))
                      }}
                    />
                  )
                }

                return (
                  <Link
                    className="flex min-w-0 items-start gap-3 border-b border-light-border px-4 py-3 transition-colors hover:bg-black/[0.025] dark:border-dark-border dark:hover:bg-white/[0.03]"
                    href={getContentHref(item)}
                    key={item.id}
                  >
                    {item.coverRef ? (
                      <img
                        alt=""
                        className="h-20 w-24 shrink-0 rounded-xl object-cover"
                        height={360}
                        loading="lazy"
                        src={item.coverRef}
                        width={480}
                      />
                    ) : (
                      <span className="grid h-20 w-24 shrink-0 place-items-center rounded-xl bg-main-sidebar-background text-lg font-bold text-light-secondary dark:text-dark-secondary">
                        {item.contentType === 'video' ? '▶' : 'A'}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-light-secondary dark:text-dark-secondary">
                        {contentTypeLabels[item.contentType]}
                      </span>
                      <h3 className="mt-1 break-words text-[15px] font-bold leading-5">{item.title}</h3>
                      {item.updatedAt ? (
                        <time className="mt-2 block text-xs text-light-secondary dark:text-dark-secondary" dateTime={item.updatedAt}>
                          {new Date(item.updatedAt).toLocaleDateString('zh-CN')}
                        </time>
                      ) : null}
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : null}
        </section>
      </section>

      {reportDialogOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 py-8"
          onClick={(event) => {
            if (event.target === event.currentTarget && !reportBusy) setReportDialogOpen(false)
          }}
        >
          <section
            aria-labelledby="profile-report-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-light-border bg-main-background p-5 shadow-xl dark:border-dark-border"
            role="dialog"
          >
            <h2 className="text-lg font-bold" id="profile-report-title">{locale === 'en' ? 'Report user' : locale === 'tw' ? '檢舉使用者' : '举报用户'}</h2>
            <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">{locale === 'en' ? 'Choose the reason that best describes this account.' : locale === 'tw' ? '請選擇最符合此帳號情況的檢舉原因。' : '请选择最符合此账号情况的举报原因。'}</p>
            <fieldset className="mt-4 flex flex-col gap-2">
              <legend className="sr-only">{locale === 'en' ? 'Report reason' : locale === 'tw' ? '檢舉原因' : '举报原因'}</legend>
              {[
                { value: 'ABUSE', label: locale === 'en' ? 'Abuse or harassment' : locale === 'tw' ? '騷擾或辱罵' : '骚扰或辱骂' },
                { value: 'SPAM', label: locale === 'en' ? 'Spam or unwanted promotion' : locale === 'tw' ? '垃圾訊息或廣告' : '垃圾信息或广告' },
                { value: 'IMPERSONATION', label: locale === 'en' ? 'Impersonation' : locale === 'tw' ? '冒充他人' : '冒充他人' },
                { value: 'COPYRIGHT', label: locale === 'en' ? 'Copyright infringement' : locale === 'tw' ? '侵犯版權' : '侵犯版权' },
                { value: 'OTHER', label: locale === 'en' ? 'Other' : locale === 'tw' ? '其他原因' : '其他原因' },
              ].map((reason) => (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-light-primary/10 dark:hover:bg-dark-primary/10" key={reason.value}>
                  <input
                    checked={reportReasonCode === reason.value}
                    className="h-4 w-4 accent-main-accent"
                    name="profile-report-reason"
                    onChange={() => setReportReasonCode(reason.value)}
                    type="radio"
                    value={reason.value}
                  />
                  <span className="text-sm">{reason.label}</span>
                </label>
              ))}
            </fieldset>
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold dark:border-dark-border"
                disabled={reportBusy}
                onClick={() => setReportDialogOpen(false)}
                type="button"
              >
                {locale === 'en' ? 'Cancel' : '取消'}
              </button>
              <button
                className="rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={reportBusy || !reportReasonCode}
                onClick={() => void reportProfile()}
                type="button"
              >
                {reportBusy ? (locale === 'en' ? 'Submitting…' : '提交中…') : locale === 'en' ? 'Submit report' : locale === 'tw' ? '提交檢舉' : '提交举报'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {error ? <p className="px-4 py-3 text-sm text-light-secondary dark:text-dark-secondary" role="status">{error}</p> : null}
    </TwitterCloneSecondaryPageLayout>
  )
}

async function loadLikedContentDetails(
  refs: ProfileLikedContentRef[],
  signal: AbortSignal,
): Promise<PublicContent[]> {
  const details = await Promise.all(refs.map(async (ref) => {
    try {
      const { response, data } = await fetchJson<{ data?: PublicContent }>(
        '/api/v1/contents/' + encodeURIComponent(ref.contentId),
        { headers: { accept: 'application/json' }, credentials: 'omit', cache: 'no-store', signal },
      )
      if (!response.ok || !data?.data || !data.data.id || !data.data.title) return null
      if (!['post', 'article', 'video'].includes(data.data.contentType)) return null
      return data.data
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      return null
    }
  }))
  return details.filter((item): item is PublicContent => item !== null)
}

function isMediaContent(item: PublicContent): boolean {
  return item.contentType === 'video' || Boolean(item.coverRef) || Boolean(item.mediaRefs?.length)
}

function displayName(profile: PublicProfile | null): string {
  return profile?.displayName?.trim() || profile?.username || 'LuckRead 用户'
}
