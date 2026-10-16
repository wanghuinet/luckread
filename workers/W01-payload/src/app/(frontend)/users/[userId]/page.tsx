'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import TwitterCloneProfileHeader from './TwitterCloneProfileHeader'
import TwitterCloneProfileNav from './TwitterCloneProfileNav'
import LuckReadSocialPostCard from '../../components/reuse/LuckReadSocialPostCard'

type PublicProfile = {
  id: string
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
  const [actionsOpen, setActionsOpen] = useState(false)
  const [safetyMessage, setSafetyMessage] = useState('')
  const [filter, setFilter] = useState<ProfileChannel>('posts')
  const [contents, setContents] = useState<PublicContent[]>([])
  const [pinnedContentId, setPinnedContentId] = useState<string | null>(null)
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
        const [profileResponse, followersResponse, followingResponse, followResponse, contentResponse, viewerResponse, pinResponse] = await Promise.all([
          fetchJson<PublicProfile | { error?: { message?: string } }>('/api/v1/users/' + encodeURIComponent(userId), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
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
          fetchJson<ContentListResponse>('/api/v1/contents?creatorId=' + encodeURIComponent(userId) + '&limit=6&type=post', {
            headers: { accept: 'application/json' },
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetchJson<{ id?: string }>('/api/v1/users/me', {
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

        const profileResult = profileResponse
        const followerResult = followersResponse
        const followingResult = followingResponse
        const followResult = followResponse
        const contentResult = contentResponse
        const viewerResult = viewerResponse
        const pinResult = pinResponse
        const data = profileResult.data
        if (profileResult.response.status === 404) throw new Error('USER_NOT_FOUND')
        if (!profileResult.response.ok || !data || !('id' in data)) {
          throw new Error(getApiErrorMessage(data, '资料加载失败'))
        }

        if (cancelled) return
        setProfile(data)

        const followerData = followerResult.data
        const followingData = followingResult.data
        const followData = followResult.data
        const contentData = contentResult.data
        const viewerData = viewerResult.data

        if (!cancelled) {
          setFollowers(typeof followerData?.data?.totalCount === 'number' ? followerData.data.totalCount : 0)
          setFollowing(typeof followingData?.data?.totalCount === 'number' ? followingData.data.totalCount : 0)
          setViewerUserId(typeof viewerData?.id === 'string' ? viewerData.id : null)
          setIsFollowing(followData?.data?.following === true)
          setMutualFollow(followData?.data?.relationship?.mutualFollow === true)
          setBlocked(followData?.data?.relationship?.blocked === true)
          setBlockedBy(followData?.data?.relationship?.blockedBy === true)
          setMuted(followData?.data?.relationship?.muted === true)
          let items = Array.isArray(contentData?.data?.items) ? contentData.data.items : []
          const pinRecord = pinResult.response.ok ? pinResult.data?.data : null
          const nextPinnedContentId = pinRecord && typeof pinRecord.contentId === 'string' ? pinRecord.contentId : null
          if (nextPinnedContentId && !items.some((item) => item.id === nextPinnedContentId)) {
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
                pinnedItem.creatorId === userId &&
                pinnedItem.contentType === 'post'
              ) {
                items = [...items, pinnedItem]
              }
            } catch (cause) {
              if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
            }
          }
          setPinnedContentId(nextPinnedContentId)
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
          '/api/v1/users/' + encodeURIComponent(profile.id) + '/replies?limit=6',
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
          '/api/v1/users/' + encodeURIComponent(profile.id) + '/likes?limit=6',
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
        'creatorId=' + encodeURIComponent(profile.id),
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
      setContents(sortPinnedFirst(nextFilter === 'media' ? data.data.items.filter(isMediaContent) : data.data.items, pinnedContentId))
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
          '/api/v1/users/' + encodeURIComponent(profile.id) + '/replies?' + query.toString(),
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
          '/api/v1/users/' + encodeURIComponent(profile.id) + '/likes?' + query.toString(),
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
        creatorId: profile.id,
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
      const { response, data } = await fetchJson<{ data?: { following?: boolean }; error?: { message?: string } }>('/api/v1/social/follows/' + encodeURIComponent(profile.id), {
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
    if (!profile || reportBusy) return
    const reasonCode = window.prompt('请输入举报原因（例如 SPAM、ABUSE、IMPERSONATION）', 'ABUSE')?.trim()
    if (!reasonCode) return

    setReportBusy(true)
    setSafetyMessage('')
    try {
      const { response, data } = await fetchJson<{ data?: { status?: string }; error?: { message?: string } }>('/api/v1/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'report:profile:' + profile.id + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'profile', targetId: profile.id, reasonCode }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data) throw new Error(getApiErrorMessage(data, 'REPORT_FAILED'))
      setSafetyMessage(data.data.status === 'DEDUPLICATED' ? '举报已记录：你此前已举报过该用户。' : '举报已提交。')
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
      const { response } = await fetchJson('/api/v1/interactions/' + relationPath + (active ? '/' + encodeURIComponent(profile.id) : ''), {
        method: active ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'social-' + action + ':' + (active ? 'remove:' : 'set:') + crypto.randomUUID(),
          ...(active ? {} : { 'content-type': 'application/json' }),
        },
        ...(active ? {} : { body: JSON.stringify({ targetUserId: profile.id }) }),
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
    return <main className="creator-profile-state" aria-busy="true"><p role="status">正在加载作者资料…</p></main>
  }

  if (error && !profile) {
    return (
      <main className="creator-profile-state">
        <p role="alert">{error}</p>
        <Link href="/content">返回发现</Link>
      </main>
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
    return '/content/' + encodeURIComponent(item.slug || item.id)
  }

  return (
    <div className="creator-profile-shell">
      <aside className="creator-profile-sidebar" aria-label="主导航">
        <Link className="creator-profile-brand" href="/" aria-label="LuckRead 首页">L</Link>
        <nav>
          <Link className="creator-profile-nav-link" href="/">首页</Link>
          <Link className="creator-profile-nav-link" href="/content">发现</Link>
          <Link className="creator-profile-nav-link" href="#works">作品</Link>
          <Link className="creator-profile-nav-link" href="/me/profile">我的</Link>
        </nav>
      </aside>

      <header className="creator-profile-mobile-header">
        <Link className="creator-profile-mobile-icon" href="/content" aria-label="返回发现">←</Link>
        <strong>{name}</strong>
        <span aria-hidden="true" />
      </header>

      <main className="creator-profile-page">
        <div className="creator-profile-toolbar">
          <Link href="/content">← 返回发现</Link>
        </div>

        <TwitterCloneProfileHeader
          profile={profile!}
          name={name}
          initial={initial}
          following={following}
          followers={followers}
          workCount={contents.length}
          statusMessage={viewerUserId !== profile.id ? safetyMessage : undefined}
          actions={
            <>
          <div className="creator-profile-circle-actions" aria-label="快捷操作">
            {viewerUserId !== profile.id ? (
              <button
                className="creator-profile-circle-button"
                type="button"
                aria-label="私信"
                onClick={() => setSafetyMessage('私信功能将在消息中心接通后启用。')}
              >
                <span aria-hidden="true">✉</span>
              </button>
            ) : null}
            <div className="creator-profile-overflow">
              <button
                className="creator-profile-circle-button"
                type="button"
                aria-label="更多操作"
                aria-expanded={actionsOpen}
                aria-haspopup="menu"
                onClick={() => setActionsOpen((open) => !open)}
              >
                <span aria-hidden="true">•••</span>
              </button>
              {actionsOpen ? (
                <div className="creator-profile-overflow-menu" role="menu" aria-label="更多操作">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionsOpen(false)
                      void shareProfile()
                    }}
                  >
                    分享
                  </button>
                  {viewerUserId !== profile.id ? (
                    <>
                      <button
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
                        type="button"
                        role="menuitem"
                        disabled={reportBusy}
                        onClick={() => {
                          setActionsOpen(false)
                          void reportProfile()
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

          <div className="creator-profile-actions">
            {viewerUserId !== profile.id && !blocked && !blockedBy ? (
              <button
                className="creator-profile-button creator-profile-button-primary"
                disabled={followBusy}
                onClick={() => void toggleFollow()}
                type="button"
              >
                {followBusy ? '处理中…' : isFollowing ? '已关注' : '关注'}
              </button>
            ) : null}
            <button
              className="creator-profile-button"
              type="button"
              onClick={() => setSafetyMessage('订阅入口将在会员功能接通后启用。')}
            >
              订阅
            </button>
            {mutualFollow ? <span className="creator-profile-badge">互相关注</span> : null}
          </div>
            </>
          }
        />

        <TwitterCloneProfileNav
          selected={filter}
          labels={filterLabels}
          onSelect={(value) => { void reloadContents(value) }}
        />

        <section className="creator-profile-works" id="works" aria-label="作者内容">
          <header className="creator-profile-section-heading">
            <div aria-hidden="true" />
            {contentHasMore && contentCursor ? (
              <button className="creator-profile-more-link" type="button" disabled={contentLoading} onClick={() => void loadMoreContents()}>
                {contentLoading ? '加载中…' : '加载更多'}
              </button>
            ) : null}
          </header>

          {contentError ? <p className="creator-profile-message" role="status">{contentError}</p> : null}
          {contentLoading && contents.length === 0 && replies.length === 0 ? (
            <div className="creator-profile-empty"><p role="status">正在加载{filterLabels[filter]}…</p></div>
          ) : null}
          {!contentLoading && visibleContents.length === 0 && replies.length === 0 && !contentError ? (
            <div className="creator-profile-empty">
              <p>{filter === 'replies' ? '暂无回复或讨论' : filter === 'likes' ? '暂无点赞内容' : '暂无' + filterLabels[filter] + '公开作品'}</p>
            </div>
          ) : null}

          {filter === 'replies' && replies.length > 0 ? (
            <div className="creator-profile-grid">
              {replies.map((reply) => (
                <Link className="creator-profile-card" href={'/content/' + encodeURIComponent(reply.contentId)} key={reply.id}>
                  <div className="creator-profile-card-body">
                    <span>{reply.parentId ? '回复讨论' : '讨论'}</span>
                    <p>{reply.body}</p>
                    <time dateTime={reply.createdAt}>{new Date(reply.createdAt).toLocaleDateString('zh-CN')}</time>
                  </div>
                </Link>
              ))}
            </div>
          ) : null}

          {visibleContents.length > 0 ? (
            <div className="creator-profile-grid">
              {visibleContents.map((item) => {
                if (item.contentType === 'post') {
                  return (
                    <LuckReadSocialPostCard
                      key={item.id}
                      contentId={item.id}
                      slug={item.slug}
                      title={item.title}
                      creatorId={item.creatorId ?? profile?.id}
                      coverRef={item.coverRef}
                      mediaRefs={item.mediaRefs}
                      createdAt={item.createdAt}
                      updatedAt={item.updatedAt}
                      locale="zh"
                      onPinChanged={(changedContentId, isPinned) => {
                        const nextPinnedContentId = isPinned ? changedContentId : null
                        setPinnedContentId(nextPinnedContentId)
                        setContents((current) => sortPinnedFirst(current, nextPinnedContentId))
                      }}
                    />
                  )
                }

                return (
                  <Link className="creator-profile-card" href={getContentHref(item)} key={item.id}>
                    <div className="creator-profile-card-media">
                      {item.coverRef ? (
                        <img alt="" height={360} loading="lazy" src={item.coverRef} width={480} />
                      ) : (
                        <span>{item.contentType === 'video' ? '▶' : 'A'}</span>
                      )}
                    </div>
                    <div className="creator-profile-card-body">
                      <span>{contentTypeLabels[item.contentType]}</span>
                      <h3>{item.title}</h3>
                      {item.updatedAt ? (
                        <time dateTime={item.updatedAt}>
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
      </main>

      {error ? <p className="creator-profile-global-message" role="status">{error}</p> : null}
    </div>
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
