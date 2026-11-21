'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import { buildPublicContentHref } from '../../../lib/public-content-url.js'
import ContentComments from '../content/[contentId]/ContentComments'
import { usePublicLocale } from '../i18n/PublicLanguageToggle'


type ContentItem = {
  id: string
  slug?: string
  creatorId?: string | null
  contentType: 'article' | 'post' | 'video'
  title: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

type ContentPage = {
  items?: ContentItem[]
  nextCursor?: string | null
  hasMore?: boolean
}

type Profile = {
  id: string
  username: string
  displayName: string | null
  avatar: string | null
  bio: string | null
}

type InteractionState = {
  liked: boolean
  likeCount: number | null
  bookmarked: boolean
  following: boolean
  restricted: boolean
}

type ApiResponse<T> = {
  data?: T
  error?: { message?: string; code?: string } | null
}

const initialInteraction: InteractionState = {
  liked: false,
  likeCount: null,
  bookmarked: false,
  following: false,
  restricted: false,
}

const avatarFallback = (value: string): string => {
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : 'L'
}

export default function ShortVideoFeed() {
  const locale = usePublicLocale()
  const [page, setPage] = useState<ContentPage>({ items: [] })
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(true)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentsContentId, setCommentsContentId] = useState<string | null>(null)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [interactionById, setInteractionById] = useState<Record<string, InteractionState>>({})
  const [profileById, setProfileById] = useState<Record<string, Profile>>({})
  const [busyById, setBusyById] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [reportTarget, setReportTarget] = useState<ContentItem | null>(null)
  const [reportReasonCode, setReportReasonCode] = useState('SPAM')
  const [activeProgress, setActiveProgress] = useState(0)
  const [doubleTapHeartId, setDoubleTapHeartId] = useState<string | null>(null)
  const [mediaErrorById, setMediaErrorById] = useState<Record<string, boolean>>({})
  const [bufferingById, setBufferingById] = useState<Record<string, boolean>>({})
  const [playingById, setPlayingById] = useState<Record<string, boolean>>({})
  const heartTimerRef = useRef<number | null>(null)
  const singleTapTimerRef = useRef<number | null>(null)
  const itemRefs = useRef<Record<string, HTMLElement | null>>({})
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const feedRef = useRef<HTMLElement | null>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const activeIndexRef = useRef(0)
  const resumeAfterVisibilityRef = useRef(false)
  const resumeAfterCommentsRef = useRef(false)
  const playbackIntentRef = useRef(true)
  const requestRef = useRef<AbortController | null>(null)
  const profileCacheRef = useRef<Record<string, Profile>>({})
  const interactionCacheRef = useRef<Record<string, InteractionState>>({})

  const visibleItems = useMemo(
    () => (page.items ?? []).filter((item) => item.contentType === 'video' && item.mediaRefs?.[0]),
    [page.items],
  )

  const setActive = useCallback((index: number) => {
    activeIndexRef.current = index
    playbackIntentRef.current = true
    setActiveIndex(index)
    setActiveProgress(0)
  }, [])

  const setItemRef = useCallback((id: string) => (element: HTMLElement | null) => {
    itemRefs.current[id] = element
  }, [])

  const setVideoRef = useCallback((id: string) => (element: HTMLVideoElement | null) => {
    videoRefs.current[id] = element
  }, [])

  const loadPage = useCallback(async (cursor: string | null = null) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller

    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({
        type: 'video',
        limit: '12',
      })
      if (cursor) params.set('cursor', cursor)

      const { response, data } = await fetchJson<ApiResponse<ContentPage>>('/api/v1/contents?' + params.toString(), {
        credentials: 'omit',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok || !data?.data) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Could not load videos.' : '短视频加载失败。'))
      }

      const next = data.data
      setPage((current) => cursor
        ? {
            items: [...(current.items ?? []), ...(next.items ?? [])],
            nextCursor: next.nextCursor ?? null,
            hasMore: next.hasMore === true,
          }
        : next,
      )
      if (!cursor) setActive(0)
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : (locale === 'en' ? 'Could not load videos.' : '短视频加载失败。'))
    } finally {
      if (requestRef.current === controller) requestRef.current = null
      if (!controller.signal.aborted) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [locale, setActive])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadPage() }, 0)
    return () => {
      window.clearTimeout(timer)
      requestRef.current?.abort()
    }
  }, [loadPage])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    void (async () => {
      try {
        const { data } = await fetchJson<{ id?: string }>('/api/v1/users/me', {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!cancelled && typeof data?.id === 'string') setViewerUserId(data.id)
      } catch {
        // Anonymous viewing is supported.
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!visibleItems.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        let bestIndex = activeIndexRef.current
        let bestRatio = 0
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.75 && entry.intersectionRatio >= bestRatio) {
            const index = Number((entry.target as HTMLElement).dataset.index)
            if (Number.isFinite(index)) {
              bestIndex = index
              bestRatio = entry.intersectionRatio
            }
          }
        }
        if (bestIndex !== activeIndexRef.current) {
          setActive(bestIndex)
        }
        if (
          page.hasMore &&
          page.nextCursor &&
          !loadingMore &&
          bestIndex >= Math.max(visibleItems.length - 3, 0)
        ) {
          void loadPage(page.nextCursor)
        }
      },
      { threshold: [0.75] },
    )

    visibleItems.forEach((item, index) => {
      const element = itemRefs.current[item.id]
      if (element) observer.observe(element)
    })

    return () => observer.disconnect()
  }, [loadPage, loadingMore, page.hasMore, page.nextCursor, setActive, visibleItems])

  useEffect(() => {
    const handleVisibilityChange = () => {
      const activeVideo = visibleItems[activeIndexRef.current]?.id
      if (document.visibilityState === 'hidden') {
        const video = activeVideo ? videoRefs.current[activeVideo] : null
        resumeAfterVisibilityRef.current = Boolean(video && !video.paused && !video.ended)
        Object.values(videoRefs.current).forEach((video) => video?.pause())
        return
      }

      if (commentsOpen || reportTarget || !resumeAfterVisibilityRef.current) {
        resumeAfterVisibilityRef.current = false
        return
      }
      const video = activeVideo ? videoRefs.current[activeVideo] : null
      resumeAfterVisibilityRef.current = false
      if (video) void video.play().catch(() => {})
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [commentsOpen, reportTarget, visibleItems])

  useEffect(() => {
    if (!visibleItems.length) return

    Object.entries(videoRefs.current).forEach(([id, video]) => {
      if (!video) return
      const isActive = visibleItems[activeIndexRef.current]?.id === id
      if (mediaErrorById[id] || document.visibilityState === 'hidden') {
        video.pause()
        return
      }
      video.muted = muted
      if (isActive && !commentsOpen && !reportTarget && playbackIntentRef.current) {
        void video.play().catch(() => {
          // Autoplay may be blocked until the first user gesture.
        })
      } else {
        video.pause()
      }
    })
  }, [activeIndex, commentsOpen, mediaErrorById, muted, reportTarget, visibleItems])

  useEffect(() => {
    const active = visibleItems[activeIndex]
    if (!active) return
    if (interactionCacheRef.current[active.id] && (!active.creatorId || profileCacheRef.current[active.creatorId])) {
      return
    }

    const controller = new AbortController()
    void (async () => {
      const requests: Array<Promise<{ response: Response; data: unknown }>> = [
        fetchJson<ApiResponse<{ liked?: boolean; likeCount?: number }>>('/api/v1/interactions/likes?targetType=content&targetId=' + encodeURIComponent(active.id), {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        }),
        fetchJson<ApiResponse<{ favorited?: boolean }>>('/api/v1/interactions/bookmarks?targetType=content&targetId=' + encodeURIComponent(active.id), {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        }),
      ]

      if (active.creatorId) {
        requests.push(fetchJson<ApiResponse<{ following?: boolean; relationship?: { blocked?: boolean; blockedBy?: boolean } }>>('/api/v1/social/follows/' + encodeURIComponent(active.creatorId), {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        }))
        if (!profileCacheRef.current[active.creatorId]) {
          requests.push(fetchJson<Profile>('/api/v1/users/' + encodeURIComponent(active.creatorId), {
            credentials: 'omit',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }))
        }
      }

      try {
        const results = await Promise.allSettled(requests)
        const fulfilledResult = (index: number): { response: Response; data: unknown } | null => {
          const result = results[index]
          return result?.status === 'fulfilled' ? result.value : null
        }

        const likeResult = fulfilledResult(0)
        const bookmarkResult = fulfilledResult(1)
        const likeData = likeResult?.data as ApiResponse<{ liked?: boolean; likeCount?: number }> | null
        const bookmarkData = bookmarkResult?.data as ApiResponse<{ favorited?: boolean }> | null

        const followIndex = active.creatorId ? 2 : -1
        const followResult = followIndex >= 0 ? fulfilledResult(followIndex) : null
        const followData = followResult?.data as ApiResponse<{ following?: boolean; relationship?: { blocked?: boolean; blockedBy?: boolean } }> | null

        let profile: Profile | null = active.creatorId ? profileCacheRef.current[active.creatorId] ?? null : null
        if (active.creatorId && !profile) {
          const profileIndex = active.creatorId && !profileCacheRef.current[active.creatorId] ? results.length - 1 : -1
          const profileResult = profileIndex >= 0 ? fulfilledResult(profileIndex) : null
          const profileResponse = profileResult?.response
          const profileData = profileResult?.data as Profile | null
          if (profileResponse?.ok && profileData?.id) {
            profile = profileData
            profileCacheRef.current[active.creatorId] = profile
          }
        }

        const blocked = Boolean(followData?.data?.relationship?.blocked || followData?.data?.relationship?.blockedBy)
        const nextInteraction: InteractionState = {
          liked: likeData?.data?.liked === true,
          likeCount: typeof likeData?.data?.likeCount === 'number' ? Math.max(0, likeData.data.likeCount) : null,
          bookmarked: bookmarkData?.data?.favorited === true,
          following: !blocked && followData?.data?.following === true,
          restricted: blocked,
        }

        interactionCacheRef.current[active.id] = nextInteraction
        setInteractionById((current) => ({ ...current, [active.id]: nextInteraction }))
        if (profile && active.creatorId) {
          setProfileById((current) => ({ ...current, [active.creatorId as string]: profile as Profile }))
        }
      } catch {
        // Interaction state is progressive enhancement; playback remains usable.
      }
    })()

    return () => controller.abort()
  }, [activeIndex, visibleItems])

  const scrollToIndex = useCallback((index: number) => {
    if (index < 0 || index >= visibleItems.length) return
    visibleItems[index] && itemRefs.current[visibleItems[index].id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [visibleItems])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (commentsOpen) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('button, a, input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        scrollToIndex(Math.min(activeIndexRef.current + 1, visibleItems.length - 1))
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        scrollToIndex(Math.max(activeIndexRef.current - 1, 0))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commentsOpen, scrollToIndex, visibleItems.length])

  useEffect(() => {
    if (activeIndexRef.current >= visibleItems.length && visibleItems.length > 0) {
      setActive(visibleItems.length - 1)
    }
  }, [setActive, visibleItems.length])

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current
    if (!sentinel || !page.hasMore || !page.nextCursor || loadingMore) return

    const nextCursor = page.nextCursor
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      void loadPage(nextCursor)
    }, { root: feedRef.current })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [loadPage, loadingMore, page.hasMore, page.nextCursor])

  const updateBusy = (id: string, action: string | null) => {
    setBusyById((current) => {
      const next = { ...current }
      if (action) next[id] = action
      else delete next[id]
      return next
    })
  }

  const requireAuth = () => {
    const returnTo = window.location.pathname + window.location.search + window.location.hash
    window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
  }

  const toggleLike = async (item: ContentItem) => {
    const current = interactionById[item.id] ?? initialInteraction
    if (busyById[item.id] || current.restricted) return
    updateBusy(item.id, 'like')
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<unknown>>('/api/v1/interactions/likes', {
        method: current.liked ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'short-video-like:' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: item.id }),
      })
      if (response.status === 401) return requireAuth()
      if (!response.ok && response.status !== 204) {
        throw new Error(getApiErrorMessage(data, '点赞操作失败。'))
      }

      const next = { ...current, liked: !current.liked, likeCount: current.likeCount === null ? null : Math.max(0, current.likeCount + (current.liked ? -1 : 1)) }
      interactionCacheRef.current[item.id] = next
      setInteractionById((all) => ({ ...all, [item.id]: next }))
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '点赞操作失败。')
    } finally {
      updateBusy(item.id, null)
    }
  }

  const toggleBookmark = async (item: ContentItem) => {
    const current = interactionById[item.id] ?? initialInteraction
    if (busyById[item.id]) return
    updateBusy(item.id, 'bookmark')
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<unknown>>('/api/v1/interactions/bookmarks', {
        method: current.bookmarked ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'short-video-bookmark:' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: item.id }),
      })
      if (response.status === 401) return requireAuth()
      if (!response.ok && response.status !== 204) {
        throw new Error(getApiErrorMessage(data, '收藏操作失败。'))
      }

      const next = { ...current, bookmarked: !current.bookmarked }
      interactionCacheRef.current[item.id] = next
      setInteractionById((all) => ({ ...all, [item.id]: next }))
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '收藏操作失败。')
    } finally {
      updateBusy(item.id, null)
    }
  }

  const toggleFollow = async (item: ContentItem) => {
    if (!item.creatorId || busyById[item.id]) return
    if (viewerUserId === item.creatorId) return
    const current = interactionById[item.id] ?? initialInteraction
    if (current.restricted) return

    updateBusy(item.id, 'follow')
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<unknown>>('/api/v1/social/follows/' + encodeURIComponent(item.creatorId), {
        method: current.following ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'short-video-follow:' + crypto.randomUUID(),
        },
      })
      if (response.status === 401) return requireAuth()
      if (!response.ok && response.status !== 204) {
        throw new Error(getApiErrorMessage(data, '关注操作失败。'))
      }

      const following = !current.following
      const next = { ...current, following }
      interactionCacheRef.current[item.id] = next
      setInteractionById((all) => ({ ...all, [item.id]: next }))
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '关注操作失败。')
    } finally {
      updateBusy(item.id, null)
    }
  }

  const share = async (item: ContentItem) => {
    if (busyById[item.id]) return
    updateBusy(item.id, 'share')
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<{ shareId?: string }>>('/api/v1/content/' + encodeURIComponent(item.id) + '/shares', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'short-video-share:' + crypto.randomUUID(),
        },
        body: JSON.stringify({ contentId: item.id }),
      })
      if (response.status === 401) return requireAuth()
      const shareId = data?.data?.shareId
      if (!response.ok || !shareId) throw new Error('分享链接生成失败。')
      const shareUrl = window.location.origin + '/s/' + encodeURIComponent(shareId)

      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: item.title, url: shareUrl })
          return
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === 'AbortError') return
        }
      }

      await navigator.clipboard.writeText(shareUrl)
      setMessage(locale === 'en' ? 'Link copied.' : '链接已复制。')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '分享失败。')
    } finally {
      updateBusy(item.id, null)
    }
  }

  const openReportDialog = (item: ContentItem) => {
    if (!viewerUserId) return requireAuth()
    if (busyById[item.id]) return
    setMessage('')
    setReportReasonCode('SPAM')
    setReportTarget(item)
  }

  const report = async () => {
    const item = reportTarget
    if (!item || !viewerUserId || busyById[item.id] || !reportReasonCode.trim()) return
    updateBusy(item.id, 'report')
    setMessage('')
    try {
      const { response, data } = await fetchJson<ApiResponse<{ status?: string }>>('/api/v1/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'short-video-report:' + item.id + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: item.id, reasonCode: reportReasonCode }),
      })
      if (response.status === 401) return requireAuth()
      if (!response.ok || !data?.data) throw new Error(getApiErrorMessage(data, '举报失败。'))
      setMessage(data.data.status === 'DEDUPLICATED' ? '举报已记录。' : '举报已提交。')
      setReportTarget(null)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '举报失败。')
    } finally {
      updateBusy(item.id, null)
    }
  }

  const togglePlay = (item: ContentItem) => {
    const video = videoRefs.current[item.id]
    if (!video) return
    if (video.paused) {
      playbackIntentRef.current = true
      void video.play().catch(() => {})
    } else {
      playbackIntentRef.current = false
      video.pause()
    }
  }

  const retryPlayback = (item: ContentItem) => {
    const video = videoRefs.current[item.id]
    if (!video) return
    setMediaErrorById((current) => {
      const next = { ...current }
      delete next[item.id]
      return next
    })
    video.load()
    if (commentsOpen || document.visibilityState === 'hidden') return
    void video.play().catch(() => {})
  }

  const handleVideoTap = (item: ContentItem, event: MouseEvent<HTMLVideoElement>) => {
    if (singleTapTimerRef.current !== null) window.clearTimeout(singleTapTimerRef.current)

    if (event.detail >= 2) {
      singleTapTimerRef.current = null
      if (!interactionById[item.id]?.restricted && !interactionById[item.id]?.liked) void toggleLike(item)
      showDoubleTapHeart(item.id)
      return
    }

    singleTapTimerRef.current = window.setTimeout(() => {
      singleTapTimerRef.current = null
      togglePlay(item)
    }, 220)
  }

  const showDoubleTapHeart = (itemId: string) => {
    if (heartTimerRef.current !== null) window.clearTimeout(heartTimerRef.current)
    setDoubleTapHeartId(itemId)
    heartTimerRef.current = window.setTimeout(() => setDoubleTapHeartId(null), 720)
  }

  useEffect(() => {
    return () => {
      if (heartTimerRef.current !== null) window.clearTimeout(heartTimerRef.current)
      if (singleTapTimerRef.current !== null) window.clearTimeout(singleTapTimerRef.current)
    }
  }, [])

  const toggleComments = (item: ContentItem) => {
    const video = videoRefs.current[item.id]
    resumeAfterCommentsRef.current = Boolean(video && !video.paused && !video.ended)
    setCommentsContentId(item.id)
    setCommentsOpen(true)
    video?.pause()
  }

  const closeComments = () => {
    playbackIntentRef.current = resumeAfterCommentsRef.current
    resumeAfterCommentsRef.current = false
    setCommentsOpen(false)
  }

  useEffect(() => {
    if (!commentsOpen) return
    const handleCommentsKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeComments()
      }
    }
    window.addEventListener('keydown', handleCommentsKeyDown)
    return () => window.removeEventListener('keydown', handleCommentsKeyDown)
  }, [commentsOpen])

  const activeItem = visibleItems[activeIndex]
  if (loading) {
    return <main className="fixed inset-0 overflow-hidden bg-black text-white"><div className="grid min-h-full content-center place-items-center gap-3 bg-[#0b0f17] p-8 text-center">正在加载短视频…</div></main>
  }

  if (error && visibleItems.length === 0) {
    return (
      <main className="fixed inset-0 overflow-hidden bg-black text-white">
        <div className="grid min-h-full content-center place-items-center gap-3 bg-[#0b0f17] p-8 text-center [&>span]:max-w-[34rem] [&>span]:text-white/70 [&_h1]:text-xl [&_h1]:font-bold [&_p]:max-w-[34rem] [&_p]:text-white/70">
          <p>{error}</p>
          <button className="min-h-10 cursor-pointer rounded-full border-0 bg-white px-4 py-2 font-extrabold text-[#111827] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void loadPage()} type="button">重试</button>
        </div>
      </main>
    )
  }

  if (!activeItem) {
    return (
      <main className="fixed inset-0 overflow-hidden bg-black text-white">
        <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between gap-4 bg-gradient-to-b from-black/60 to-transparent px-6 text-white [&>*]:pointer-events-auto max-[640px]:h-14 max-[640px]:px-3">
          <Link href="/" className="text-xl font-extrabold tracking-tight text-white no-underline">LuckRead</Link>
          <Link href="/publish?type=video" className="inline-flex min-h-[38px] items-center justify-center rounded-full bg-white px-[15px] py-2 text-sm font-extrabold text-[#111827] no-underline max-[640px]:px-[11px]">发视频</Link>
        </header>
        <div className="grid min-h-full content-center place-items-center gap-3 bg-[#0b0f17] p-8 text-center [&>span]:max-w-[34rem] [&>span]:text-white/70 [&_h1]:text-xl [&_h1]:font-bold [&_p]:max-w-[34rem] [&_p]:text-white/70">
          <strong>还没有可播放的短视频</strong>
          <span>先发布一个竖屏或横屏视频，作品会进入这里。</span>
          <Link className="inline-flex min-h-[38px] items-center justify-center rounded-full bg-white px-[15px] py-2 text-sm font-extrabold text-[#111827] no-underline" href="/publish?type=video">创建视频</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-black text-white">
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between gap-4 bg-gradient-to-b from-black/60 to-transparent px-6 text-white [&>*]:pointer-events-auto max-[640px]:h-14 max-[640px]:px-3">
        <Link href="/" className="text-xl font-extrabold tracking-tight text-white no-underline">LuckRead</Link>
        <div className="absolute left-1/2 top-[19px] flex -translate-x-1/2 gap-[22px] max-[640px]:top-[17px]" aria-label="短视频频道">
          <span className="relative text-[15px] font-bold text-white no-underline after:absolute after:bottom-[-9px] after:left-1/2 after:h-[3px] after:w-6 after:-translate-x-1/2 after:rounded-full after:bg-white after:content-['']">短视频</span>
          <Link href="/content?type=video" className="text-[15px] font-bold text-white/70 no-underline">视频列表</Link>
        </div>
        <div className="flex items-center gap-2.5">
          <button aria-label={muted ? '打开声音' : '关闭声音'} className="h-[38px] w-[38px] cursor-pointer rounded-full border-0 bg-white/10 text-white backdrop-blur-xl" onClick={() => setMuted((value) => !value)} type="button">
            <i className={muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high'} aria-hidden="true" />
          </button>
          <Link href="/publish?type=video" className="inline-flex min-h-[38px] items-center justify-center rounded-full bg-white px-[15px] py-2 text-sm font-extrabold text-[#111827] no-underline max-[640px]:px-[11px]">发视频</Link>
        </div>
      </header>

      <section ref={feedRef} className="h-full touch-pan-y snap-y snap-mandatory overscroll-y-contain overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" aria-label="短视频流">
        {visibleItems.map((item, index) => {
          const videoUrl = item.mediaRefs?.[0]
          const interaction = interactionById[item.id] ?? initialInteraction
          const busy = busyById[item.id]
          const creatorName = item.creatorId ? (profileById[item.creatorId]?.username || item.creatorId) : 'LuckRead'
          const displayName = item.creatorId
            ? (profileById[item.creatorId]?.displayName || creatorName)
            : 'LuckRead'
          const avatar = item.creatorId ? profileById[item.creatorId]?.avatar : null
          const creatorUsername = item.creatorId ? profileById[item.creatorId]?.username : null
          const creatorHref = item.creatorId
            ? (creatorUsername ? '/' + encodeURIComponent(creatorUsername) : '/users/' + encodeURIComponent(item.creatorId))
            : '/'

          return (
            <article
              className="relative h-dvh min-h-screen snap-start snap-always"
              data-index={index}
              key={item.id}
              ref={setItemRef(item.id)}
            >
              <div
                className="relative mx-auto h-full w-full max-w-[720px] touch-pan-y overflow-hidden bg-[#050505] shadow-[0_0_80px_rgba(0,0,0,.38)]"
              >
                <video
                  aria-label={item.title}
                  className="block h-full w-full cursor-pointer select-none object-cover bg-[#090909] [-webkit-user-select:none] [-webkit-touch-callout:none]"
                  controls={false}
                  loop
                  muted={muted}
                  playsInline
                  poster={item.coverRef || undefined}
                  preload={
                    index === activeIndex ? 'auto' :
                    index > activeIndex && index <= activeIndex + 2 ? 'auto' :
                    index === activeIndex - 1 ? 'metadata' :
                    'none'
                  }
                  ref={setVideoRef(item.id)}
                  src={videoUrl}
                  onClick={(event) => handleVideoTap(item, event)}
                  onTimeUpdate={(event) => {
                    if (item.id !== visibleItems[activeIndexRef.current]?.id) return
                    const current = event.currentTarget
                    setActiveProgress(current.duration > 0 ? Math.min(100, Math.max(0, (current.currentTime / current.duration) * 100)) : 0)
                  }}
                  onPlay={() => {
                    setPlayingById((current) => ({ ...current, [item.id]: true }))
                  }}
                  onPause={() => {
                    setPlayingById((current) => ({ ...current, [item.id]: false }))
                  }}
                  onWaiting={() => {
                    setBufferingById((current) => ({ ...current, [item.id]: true }))
                  }}
                  onCanPlay={() => {
                    setBufferingById((current) => {
                      if (!current[item.id]) return current
                      const next = { ...current }
                      delete next[item.id]
                      return next
                    })
                  }}
                  onPlaying={() => {
                    setBufferingById((current) => {
                      if (!current[item.id]) return current
                      const next = { ...current }
                      delete next[item.id]
                      return next
                    })
                  }}
                  onLoadedMetadata={(event) => {
                    if (item.id !== visibleItems[activeIndexRef.current]?.id) return
                    const current = event.currentTarget
                    setActiveProgress(current.duration > 0 ? Math.min(100, Math.max(0, (current.currentTime / current.duration) * 100)) : 0)
                  }}
                  onError={(event) => {
                    event.currentTarget.pause()
                    setMediaErrorById((current) => ({ ...current, [item.id]: true }))
                  }}
                />
                {activeIndex === index && !playingById[item.id] && !bufferingById[item.id] && !mediaErrorById[item.id] ? (
                  <div className="absolute left-1/2 top-1/2 z-[6] grid h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/30 bg-black/40 text-white backdrop-blur-md" aria-hidden="true">
                    <i className="fa-solid fa-play" />
                  </div>
                ) : null}
                {bufferingById[item.id] && !mediaErrorById[item.id] ? (
                  <div className="absolute left-1/2 top-1/2 z-[7] inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-full bg-black/65 px-3.5 py-2.5 text-sm text-white" aria-live="polite">
                    <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" aria-hidden="true" />
                    <span>{locale === 'en' ? 'Loading video…' : '视频加载中…'}</span>
                  </div>
                ) : null}
                {mediaErrorById[item.id] ? (
                  <div className="absolute left-1/2 top-1/2 z-[7] grid w-[min(360px,calc(100%-40px))] -translate-x-1/2 -translate-y-1/2 justify-items-center gap-2 rounded-2xl border border-white/20 bg-black/80 p-5 text-center [&_span]:text-[13px] [&_span]:text-white/70" role="alert">
                    <strong>{locale === 'en' ? 'Video unavailable' : '视频暂时无法播放'}</strong>
                    <span>{locale === 'en' ? 'The media could not be loaded.' : '媒体加载失败，可以重新尝试。'}</span>
                    <button className="min-h-9 cursor-pointer rounded-full border-0 bg-white px-[15px] py-2 text-[13px] font-extrabold text-[#111827]" onClick={() => retryPlayback(item)} type="button">
                      {locale === 'en' ? 'Retry' : '重试播放'}
                    </button>
                  </div>
                ) : null}
                {doubleTapHeartId === item.id ? (
                  <div className="pointer-events-none absolute left-1/2 top-[48%] z-[5] grid h-[132px] w-[132px] -translate-x-1/2 -translate-y-1/2 place-items-center text-white animate-ping motion-reduce:animate-none [&_i]:text-[86px] [&_i]:text-white [&_i]:drop-shadow-[0_10px_28px_rgba(0,0,0,.32)]" aria-hidden="true">
                    <i className="fa-solid fa-heart" />
                  </div>
                ) : null}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-[28%] bg-gradient-to-b from-black/55 to-transparent" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-t from-black/80 to-transparent" />

                <div className="absolute left-5 right-5 top-[86px] flex items-center justify-between font-extrabold [text-shadow:0_1px_10px_rgba(0,0,0,.35)] max-[640px]:left-3 max-[640px]:right-3 max-[640px]:top-[70px]">
                  <span>短视频</span>
                  <span className="text-[13px] text-white/60">{index + 1}/{visibleItems.length}</span>
                </div>

                <div className="absolute bottom-[58px] left-[18px] right-[104px] z-[3] max-[640px]:bottom-[calc(75px+env(safe-area-inset-bottom))] max-[640px]:left-3 max-[640px]:right-[91px] [&_h1]:m-0 [&_h1]:text-[clamp(19px,4vw,26px)] [&_h1]:leading-[1.3] [&_h1]:tracking-tight [&_h1]:[text-shadow:0_2px_16px_rgba(0,0,0,.48)] [&_p]:my-2 [&_p]:text-sm [&_p]:text-white/80">
                  <div className="mb-[13px] flex items-center gap-2.5">
                    <Link
                      className="grid h-12 w-12 flex-none place-items-center overflow-hidden rounded-full border-2 border-white bg-[#273142] font-extrabold text-white no-underline [&_img]:h-full [&_img]:w-full [&_img]:object-cover"
                      href={creatorHref}
                      aria-label={'打开 ' + displayName + ' 的主页'}
                    >
                      {avatar ? <img alt="" src={avatar} /> : avatarFallback(displayName)}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={creatorHref} className="font-extrabold text-white no-underline">
                        @{creatorName}
                      </Link>
                      {item.creatorId && viewerUserId !== item.creatorId && !interaction.restricted ? (
                        <button
                          className={interaction.following ? 'min-h-7 cursor-pointer rounded-full border border-white/30 bg-black/20 px-[11px] py-1 text-xs font-extrabold text-white/70 disabled:cursor-not-allowed disabled:opacity-50' : 'min-h-7 cursor-pointer rounded-full border border-white/60 bg-black/20 px-[11px] py-1 text-xs font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50'}
                          disabled={busy === 'follow'}
                          onClick={(event) => { event.stopPropagation(); void toggleFollow(item) }}
                          type="button"
                        >
                          {interaction.following ? '已关注' : '关注'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <h1>{item.title}</h1>
                  <p>{locale === 'en' ? 'Swipe to keep watching.' : '上下滑动继续刷视频。'}</p>
                  <Link
                    className="text-[13px] text-white/80 underline-offset-4"
                    data-umami-event="content-open"
                    data-umami-event-content-type="video"
                    href={buildPublicContentHref({ id: item.id, slug: item.slug, contentType: 'video', authorUsername: creatorUsername }, { short: true })}
                  >
                    打开详情
                  </Link>
                </div>

                <aside className="absolute bottom-[66px] right-[14px] z-[4] flex w-[72px] flex-col items-center gap-[13px] max-[640px]:bottom-[calc(76px+env(safe-area-inset-bottom))] max-[640px]:right-[7px] max-[640px]:gap-[9px]" aria-label="视频操作">
                  <button className={interaction.liked ? 'grid w-[68px] cursor-pointer justify-items-center gap-1 border-0 bg-transparent text-white [text-shadow:0_2px_12px_rgba(0,0,0,.45)] [&_i]:grid [&_i]:h-[49px] [&_i]:w-[49px] [&_i]:place-items-center [&_i]:rounded-full [&_i]:bg-black/30 [&_i]:text-[23px] [&_i]:backdrop-blur-[7px] [&_span]:text-[11px] [&_span]:font-extrabold max-[640px]:w-[62px] max-[640px]:[&_i]:h-11 max-[640px]:[&_i]:w-11 max-[640px]:[&_i]:text-xl [&_i]:text-[#ff315a]' : 'grid w-[68px] cursor-pointer justify-items-center gap-1 border-0 bg-transparent text-white [text-shadow:0_2px_12px_rgba(0,0,0,.45)] [&_i]:grid [&_i]:h-[49px] [&_i]:w-[49px] [&_i]:place-items-center [&_i]:rounded-full [&_i]:bg-black/30 [&_i]:text-[23px] [&_i]:backdrop-blur-[7px] [&_span]:text-[11px] [&_span]:font-extrabold max-[640px]:w-[62px] max-[640px]:[&_i]:h-11 max-[640px]:[&_i]:w-11 max-[640px]:[&_i]:text-xl'} disabled={busy === 'like' || interaction.restricted} onClick={() => void toggleLike(item)} type="button">
                    <i className={interaction.liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'} aria-hidden="true" />
                    <span>{interaction.likeCount === null ? '赞' : interaction.likeCount.toLocaleString()}</span>
                  </button>
                  <button className="grid w-[68px] cursor-pointer justify-items-center gap-1 border-0 bg-transparent text-white [text-shadow:0_2px_12px_rgba(0,0,0,.45)] [&_i]:grid [&_i]:h-[49px] [&_i]:w-[49px] [&_i]:place-items-center [&_i]:rounded-full [&_i]:bg-black/30 [&_i]:text-[23px] [&_i]:backdrop-blur-[7px] [&_span]:text-[11px] [&_span]:font-extrabold max-[640px]:w-[62px] max-[640px]:[&_i]:h-11 max-[640px]:[&_i]:w-11 max-[640px]:[&_i]:text-xl" onClick={() => toggleComments(item)} type="button">
                    <i className="fa-regular fa-comment" aria-hidden="true" />
                    <span>评论</span>
                  </button>
                  <button className={interaction.bookmarked ? 'grid w-[68px] cursor-pointer justify-items-center gap-1 border-0 bg-transparent text-white [text-shadow:0_2px_12px_rgba(0,0,0,.45)] [&_i]:grid [&_i]:h-[49px] [&_i]:w-[49px] [&_i]:place-items-center [&_i]:rounded-full [&_i]:bg-black/30 [&_i]:text-[23px] [&_i]:backdrop-blur-[7px] [&_span]:text-[11px] [&_span]:font-extrabold max-[640px]:w-[62px] max-[640px]:[&_i]:h-11 max-[640px]:[&_i]:w-11 max-[640px]:[&_i]:text-xl [&_i]:text-[#ff315a]' : 'grid w-[68px] cursor-pointer justify-items-center gap-1 border-0 bg-transparent text-white [text-shadow:0_2px_12px_rgba(0,0,0,.45)] [&_i]:grid [&_i]:h-[49px] [&_i]:w-[49px] [&_i]:place-items-center [&_i]:rounded-full [&_i]:bg-black/30 [&_i]:text-[23px] [&_i]:backdrop-blur-[7px] [&_span]:text-[11px] [&_span]:font-extrabold max-[640px]:w-[62px] max-[640px]:[&_i]:h-11 max-[640px]:[&_i]:w-11 max-[640px]:[&_i]:text-xl'} disabled={busy === 'bookmark'} onClick={() => void toggleBookmark(item)} type="button">
                    <i className={interaction.bookmarked ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'} aria-hidden="true" />
                    <span>收藏</span>
                  </button>
                  <button className="grid w-[68px] cursor-pointer justify-items-center gap-1 border-0 bg-transparent text-white [text-shadow:0_2px_12px_rgba(0,0,0,.45)] [&_i]:grid [&_i]:h-[49px] [&_i]:w-[49px] [&_i]:place-items-center [&_i]:rounded-full [&_i]:bg-black/30 [&_i]:text-[23px] [&_i]:backdrop-blur-[7px] [&_span]:text-[11px] [&_span]:font-extrabold max-[640px]:w-[62px] max-[640px]:[&_i]:h-11 max-[640px]:[&_i]:w-11 max-[640px]:[&_i]:text-xl" disabled={busy === 'share'} onClick={() => void share(item)} type="button">
                    <i className="fa-solid fa-share" aria-hidden="true" />
                    <span>分享</span>
                  </button>
                  <button className="grid w-[68px] cursor-pointer justify-items-center gap-1 border-0 bg-transparent text-white [text-shadow:0_2px_12px_rgba(0,0,0,.45)] [&_i]:grid [&_i]:h-[49px] [&_i]:w-[49px] [&_i]:place-items-center [&_i]:rounded-full [&_i]:bg-black/30 [&_i]:text-[23px] [&_i]:backdrop-blur-[7px] [&_span]:text-[11px] [&_span]:font-extrabold max-[640px]:w-[62px] max-[640px]:[&_i]:h-11 max-[640px]:[&_i]:w-11 max-[640px]:[&_i]:text-xl" disabled={busy === 'report'} onClick={() => openReportDialog(item)} type="button">
                    <i className="fa-solid fa-ellipsis" aria-hidden="true" />
                    <span>更多</span>
                  </button>
                </aside>

                <div className="absolute inset-x-0 bottom-0 z-[5] h-[3px] overflow-hidden bg-white/25" aria-hidden="true">
                  <span className="block h-full origin-left bg-white transition-[width] duration-150" style={{ width: activeIndex === index ? activeProgress + '%' : '0%' }} />
                </div>

                <div className="absolute bottom-4 right-[18px] z-[4] max-[640px]:bottom-[calc(12px+env(safe-area-inset-bottom))] max-[640px]:right-3">
                  <button className="h-[39px] w-[39px] cursor-pointer rounded-full border-0 bg-black/40 text-white backdrop-blur-[7px]" onClick={() => setMuted((value) => !value)} type="button">
                    <i className={muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high'} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          )
        })}
        {page.hasMore && page.nextCursor ? (
          <div ref={loadMoreSentinelRef} className="relative grid min-h-12 place-items-center pointer-events-none text-center text-[10px] text-white/45" aria-live="polite">
            {loadingMore ? '正在载入更多视频…' : '继续滑动加载更多'}
            <button
              className="pointer-events-none absolute opacity-0"
              aria-label="加载更多短视频"
              disabled={loadingMore}
              onClick={() => void loadPage(page.nextCursor ?? null)}
              type="button"
            />
          </div>
        ) : null}
      </section>

      {message && !reportTarget ? (
        <div className="fixed bottom-[88px] left-1/2 z-40 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-3 rounded-full bg-[#171717] px-3 py-2.5 text-sm text-white shadow-lg [&_button]:border-0 [&_button]:bg-transparent [&_button]:text-lg [&_button]:text-white" role="status">
          {message}
          <button onClick={() => setMessage('')} type="button">×</button>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-[35] mx-auto grid min-h-[62px] w-full max-w-[720px] grid-cols-5 items-end bg-gradient-to-t from-black/80 to-transparent px-2 pt-1.5 pb-[max(7px,env(safe-area-inset-bottom))] max-[640px]:min-h-[68px] max-[640px]:pb-[max(10px,env(safe-area-inset-bottom))]" aria-label="主导航">
        <Link href="/" className="grid justify-items-center gap-0.5 bg-transparent text-[10px] font-bold text-white/70 no-underline [&_i]:text-[17px]"><i className="fa-solid fa-house" aria-hidden="true" /><span>首页</span></Link>
        <Link href="/content?type=video" className="grid justify-items-center gap-0.5 bg-transparent text-[10px] font-bold text-white/70 no-underline [&_i]:text-[17px]" data-umami-event="content-discovery-open"><i className="fa-solid fa-compass" aria-hidden="true" /><span>探索</span></Link>
        <Link aria-label="发布视频" href="/publish?type=video" className="mb-[9px] grid h-[33px] w-[43px] place-items-center justify-self-center rounded-[10px] bg-gradient-to-br from-white to-[#b5c8ff] text-[#111827]"><i className="fa-solid fa-plus" aria-hidden="true" /></Link>
        <Link href="/creator-center" className="grid justify-items-center gap-0.5 bg-transparent text-[10px] font-bold text-white/70 no-underline [&_i]:text-[17px]" data-umami-event="creator-center-open"><i className="fa-solid fa-user-pen" aria-hidden="true" /><span>创作</span></Link>
        <Link href="/me/profile" className="grid justify-items-center gap-0.5 bg-transparent text-[10px] font-bold text-white/70 no-underline [&_i]:text-[17px]"><i className="fa-solid fa-user" aria-hidden="true" /><span>我</span></Link>
      </nav>

      {reportTarget ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 px-4 py-8"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busyById[reportTarget.id]) setReportTarget(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busyById[reportTarget.id]) setReportTarget(null)
          }}
        >
          <section
            aria-labelledby="short-video-report-title"
            aria-modal="true"
            autoFocus
            className="w-full max-w-md rounded-2xl border border-light-border bg-main-background p-5 text-light-primary shadow-xl dark:border-dark-border dark:text-dark-primary"
            role="dialog"
            tabIndex={-1}
          >
            <h2 className="text-lg font-bold" id="short-video-report-title">
              {locale === 'en' ? 'Report video' : locale === 'tw' ? '檢舉影片' : '举报视频'}
            </h2>
            <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">
              {locale === 'en' ? 'Choose the reason that best describes this video.' : locale === 'tw' ? '請選擇最符合此影片情況的檢舉原因。' : '请选择最符合此视频情况的举报原因。'}
            </p>
            <fieldset className="mt-4 flex flex-col gap-2">
              <legend className="sr-only">
                {locale === 'en' ? 'Report reason' : locale === 'tw' ? '檢舉原因' : '举报原因'}
              </legend>
              {[
                { value: 'SPAM', label: locale === 'en' ? 'Spam or unwanted promotion' : locale === 'tw' ? '垃圾訊息或廣告' : '垃圾信息或广告' },
                { value: 'ABUSE', label: locale === 'en' ? 'Abuse or harassment' : locale === 'tw' ? '騷擾或辱罵' : '骚扰或辱骂' },
                { value: 'IMPERSONATION', label: locale === 'en' ? 'Impersonation' : locale === 'tw' ? '冒充他人' : '冒充他人' },
                { value: 'COPYRIGHT', label: locale === 'en' ? 'Copyright infringement' : locale === 'tw' ? '侵犯版權' : '侵犯版权' },
                { value: 'OTHER', label: locale === 'en' ? 'Other' : locale === 'tw' ? '其他原因' : '其他原因' },
              ].map((reason) => (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-light-primary/10 dark:hover:bg-dark-primary/10" key={reason.value}>
                  <input
                    checked={reportReasonCode === reason.value}
                    className="h-4 w-4 accent-main-accent"
                    name="short-video-report-reason"
                    onChange={() => setReportReasonCode(reason.value)}
                    type="radio"
                    value={reason.value}
                  />
                  <span className="text-sm">{reason.label}</span>
                </label>
              ))}
            </fieldset>
            {message ? (
              <p className="mt-3 text-sm text-light-secondary dark:text-dark-secondary" role="status">{message}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold dark:border-dark-border"
                disabled={Boolean(busyById[reportTarget.id])}
                onClick={() => setReportTarget(null)}
                type="button"
              >
                {locale === 'en' ? 'Cancel' : locale === 'tw' ? '取消' : '取消'}
              </button>
              <button
                className="rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={Boolean(busyById[reportTarget.id]) || !reportReasonCode}
                onClick={() => void report()}
                type="button"
              >
                {busyById[reportTarget.id] === 'report'
                  ? (locale === 'en' ? 'Reporting…' : locale === 'tw' ? '舉報中…' : '举报中…')
                  : (locale === 'en' ? 'Submit report' : locale === 'tw' ? '提交檢舉' : '提交举报')}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {commentsOpen && commentsContentId ? (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/50" role="presentation" onMouseDown={closeComments}>
          <aside className="flex h-full w-full max-w-[560px] flex-col bg-white text-[#111827] shadow-[-20px_0_60px_rgba(0,0,0,.28)] max-[640px]:mt-auto max-[640px]:h-[78dvh] max-[640px]:max-h-[720px] max-[640px]:rounded-t-[18px] max-[640px]:shadow-[0_-20px_60px_rgba(0,0,0,.28)]" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="评论">
            <header className="flex min-h-[62px] flex-none items-center justify-between border-b border-[#e5e7eb] px-[18px] max-[640px]:min-h-[58px] [&_button]:h-[38px] [&_button]:w-[38px] [&_button]:rounded-full [&_button]:bg-[#f3f4f6] [&_button]:text-2xl [&_button]:text-[#111827]">
              <strong>评论</strong>
              <button onClick={closeComments} type="button" aria-label="关闭评论">×</button>
            </header>
            <div className="min-h-0 overflow-y-auto p-2 [&_.content-comments]:m-0 [&_.content-comments]:shadow-none">
              <ContentComments
                contentId={commentsContentId}
                interactionRestricted={Boolean((interactionById[commentsContentId] ?? initialInteraction).restricted)}
                locale={locale}
                viewerUserId={viewerUserId}
              />
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  )
}
