'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import ContentComments from '../content/[contentId]/ContentComments'
import { usePublicLocale } from '../i18n/PublicLanguageToggle'

import styles from './short-video.module.css'

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
  const [notInterestedIds, setNotInterestedIds] = useState<string[]>([])
  const itemRefs = useRef<Record<string, HTMLElement | null>>({})
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const activeIndexRef = useRef(0)
  const requestRef = useRef<AbortController | null>(null)
  const profileCacheRef = useRef<Record<string, Profile>>({})
  const interactionCacheRef = useRef<Record<string, InteractionState>>({})

  const visibleItems = useMemo(
    () => (page.items ?? []).filter((item) => item.contentType === 'video' && item.mediaRefs?.[0] && !notInterestedIds.includes(item.id)),
    [page.items, notInterestedIds],
  )

  const setActive = useCallback((index: number) => {
    activeIndexRef.current = index
    setActiveIndex(index)
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

      const response = await fetch('/api/v1/contents?' + params.toString(), {
        credentials: 'omit',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = await response.json().catch((): null => null) as ApiResponse<ContentPage> | null
      if (!response.ok || !data?.data) {
        throw new Error(data?.error?.message || (locale === 'en' ? 'Could not load videos.' : '短视频加载失败。'))
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
        const response = await fetch('/api/v1/users/me', {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        })
        const data = await response.json().catch((): null => null) as { id?: string } | null
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
          if (entry.isIntersecting && entry.intersectionRatio >= bestRatio) {
            const index = Number((entry.target as HTMLElement).dataset.index)
            if (Number.isFinite(index)) {
              bestIndex = index
              bestRatio = entry.intersectionRatio
            }
          }
        }
        if (bestIndex !== activeIndexRef.current) setActive(bestIndex)
      },
      { threshold: [0.55, 0.75, 0.9] },
    )

    visibleItems.forEach((item, index) => {
      const element = itemRefs.current[item.id]
      if (element) observer.observe(element)
    })

    return () => observer.disconnect()
  }, [visibleItems, setActive])

  useEffect(() => {
    if (!visibleItems.length) return

    Object.entries(videoRefs.current).forEach(([id, video]) => {
      if (!video) return
      const isActive = visibleItems[activeIndexRef.current]?.id === id
      video.muted = muted
      if (isActive) {
        void video.play().catch(() => {
          // Autoplay may be blocked until the first user gesture.
        })
      } else {
        video.pause()
      }
    })
  }, [activeIndex, muted, visibleItems])

  useEffect(() => {
    const active = visibleItems[activeIndex]
    if (!active) return
    if (interactionCacheRef.current[active.id] && (!active.creatorId || profileCacheRef.current[active.creatorId])) {
      return
    }

    const controller = new AbortController()
    void (async () => {
      const requests: Promise<Response>[] = [
        fetch('/api/v1/interactions/likes?targetType=content&targetId=' + encodeURIComponent(active.id), {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        }),
        fetch('/api/v1/interactions/bookmarks?targetType=content&targetId=' + encodeURIComponent(active.id), {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        }),
      ]

      if (active.creatorId) {
        requests.push(fetch('/api/v1/social/follows/' + encodeURIComponent(active.creatorId), {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        }))
        if (!profileCacheRef.current[active.creatorId]) {
          requests.push(fetch('/api/v1/users/' + encodeURIComponent(active.creatorId), {
            credentials: 'omit',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }))
        }
      }

      try {
        const responses = await Promise.all(requests)
        const likeData = await responses[0].json().catch((): null => null) as ApiResponse<{ liked?: boolean; likeCount?: number }> | null
        const bookmarkData = await responses[1].json().catch((): null => null) as ApiResponse<{ favorited?: boolean }> | null

        const followIndex = active.creatorId ? 2 : -1
        const followData = followIndex >= 0
          ? await responses[followIndex].json().catch((): null => null) as ApiResponse<{ following?: boolean; relationship?: { blocked?: boolean; blockedBy?: boolean } }> | null
          : null

        let profile: Profile | null = active.creatorId ? profileCacheRef.current[active.creatorId] ?? null : null
        if (active.creatorId && !profile) {
          const profileResponse = responses[responses.length - 1]
          const profileData = await profileResponse.json().catch((): null => null) as Profile | null
          if (profileResponse.ok && profileData?.id) {
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
      const response = await fetch('/api/v1/interactions/likes', {
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
        const data = await response.json().catch((): null => null) as ApiResponse<unknown> | null
        throw new Error(data?.error?.message || '点赞操作失败。')
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
      const response = await fetch('/api/v1/interactions/bookmarks', {
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
        const data = await response.json().catch((): null => null) as ApiResponse<unknown> | null
        throw new Error(data?.error?.message || '收藏操作失败。')
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
      const response = await fetch('/api/v1/social/follows/' + encodeURIComponent(item.creatorId), {
        method: current.following ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'short-video-follow:' + crypto.randomUUID(),
        },
      })
      if (response.status === 401) return requireAuth()
      if (!response.ok && response.status !== 204) {
        const data = await response.json().catch((): null => null) as ApiResponse<unknown> | null
        throw new Error(data?.error?.message || '关注操作失败。')
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
      const response = await fetch('/api/v1/content/' + encodeURIComponent(item.id) + '/shares', {
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
      const data = await response.json().catch((): null => null) as ApiResponse<{ shareId?: string }> | null
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

  const report = async (item: ContentItem) => {
    if (!viewerUserId || busyById[item.id]) return requireAuth()
    const reasonCode = window.prompt(
      locale === 'en' ? 'Report reason' : locale === 'tw' ? '請輸入檢舉原因' : '请输入举报原因',
      'SPAM',
    )?.trim()
    if (!reasonCode) return

    updateBusy(item.id, 'report')
    setMessage('')
    try {
      const response = await fetch('/api/v1/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'short-video-report:' + item.id + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: item.id, reasonCode }),
      })
      if (response.status === 401) return requireAuth()
      const data = await response.json().catch((): null => null) as ApiResponse<{ status?: string }> | null
      if (!response.ok || !data?.data) throw new Error('举报失败。')
      setMessage(data.data.status === 'DEDUPLICATED' ? '举报已记录。' : '举报已提交。')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '举报失败。')
    } finally {
      updateBusy(item.id, null)
    }
  }

  const markNotInterested = (item: ContentItem) => {
    setNotInterestedIds((current) => [...current, item.id])
    setMessage(locale === 'en' ? 'Not interested.' : '已减少这类内容。')
  }

  const togglePlay = (item: ContentItem) => {
    const video = videoRefs.current[item.id]
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
  }

  const toggleComments = (item: ContentItem) => {
    setCommentsContentId(item.id)
    setCommentsOpen(true)
    videoRefs.current[item.id]?.pause()
  }

  const activeItem = visibleItems[activeIndex]
  const activeProfile = activeItem?.creatorId ? profileById[activeItem.creatorId] : undefined
  const activeInteraction = activeItem ? interactionById[activeItem.id] ?? initialInteraction : initialInteraction
  const activeBusy = activeItem ? busyById[activeItem.id] : undefined

  if (loading) {
    return <main className={styles.shell}><div className={styles.loading}>正在加载短视频…</div></main>
  }

  if (error && visibleItems.length === 0) {
    return (
      <main className={styles.shell}>
        <div className={styles.state}>
          <p>{error}</p>
          <button className={styles.button} onClick={() => void loadPage()} type="button">重试</button>
        </div>
      </main>
    )
  }

  if (!activeItem) {
    return (
      <main className={styles.shell}>
        <header className={styles.topbar}>
          <Link href="/" className={styles.brand}>LuckRead</Link>
          <Link href="/publish?type=video" className={styles.createButton}>发视频</Link>
        </header>
        <div className={styles.state}>
          <strong>还没有可播放的短视频</strong>
          <span>先发布一个竖屏或横屏视频，作品会进入这里。</span>
          <Link className={styles.primaryLink} href="/publish?type=video">创建视频</Link>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>LuckRead</Link>
        <div className={styles.feedTabs} aria-label="短视频频道">
          <span className={styles.feedTabActive}>为你</span>
          <Link href="/content?type=video" className={styles.feedTab}>视频</Link>
        </div>
        <div className={styles.topbarActions}>
          <button aria-label={muted ? '打开声音' : '关闭声音'} className={styles.iconButton} onClick={() => setMuted((value) => !value)} type="button">
            <i className={muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high'} aria-hidden="true" />
          </button>
          <Link href="/publish?type=video" className={styles.createButton}>发视频</Link>
        </div>
      </header>

      <section className={styles.feed} aria-label="短视频流">
        {visibleItems.map((item, index) => {
          const videoUrl = item.mediaRefs?.[0]
          const interaction = interactionById[item.id] ?? initialInteraction
          const busy = busyById[item.id]
          const creatorName = item.creatorId ? (profileById[item.creatorId]?.username || item.creatorId) : 'LuckRead'
          const displayName = item.creatorId
            ? (profileById[item.creatorId]?.displayName || creatorName)
            : 'LuckRead'
          const avatar = item.creatorId ? profileById[item.creatorId]?.avatar : null

          return (
            <article
              className={styles.slide}
              data-index={index}
              key={item.id}
              ref={(element) => { itemRefs.current[item.id] = element }}
            >
              <div className={styles.videoStage} onDoubleClick={() => void toggleLike(item)}>
                <video
                  aria-label={item.title}
                  className={styles.video}
                  controls={false}
                  loop
                  muted={muted}
                  playsInline
                  poster={item.coverRef || undefined}
                  preload={Math.abs(index - activeIndex) <= 1 ? 'metadata' : 'none'}
                  ref={(element) => { videoRefs.current[item.id] = element }}
                  src={videoUrl}
                  onClick={() => togglePlay(item)}
                />
                <div className={styles.topFade} />
                <div className={styles.bottomFade} />

                <div className={styles.slideHeader}>
                  <span>为你推荐</span>
                  <span className={styles.indexMark}>{index + 1}/{visibleItems.length}</span>
                </div>

                <div className={styles.contentOverlay}>
                  <div className={styles.authorRow}>
                    <Link
                      className={styles.avatar}
                      href={item.creatorId ? '/users/' + encodeURIComponent(item.creatorId) : '/'}
                      aria-label={'打开 ' + displayName + ' 的主页'}
                    >
                      {avatar ? <img alt="" src={avatar} /> : avatarFallback(displayName)}
                    </Link>
                    <div className={styles.authorMeta}>
                      <Link href={item.creatorId ? '/users/' + encodeURIComponent(item.creatorId) : '/'} className={styles.authorName}>
                        @{creatorName}
                      </Link>
                      {item.creatorId && viewerUserId !== item.creatorId && !interaction.restricted ? (
                        <button
                          className={interaction.following ? styles.followingButton : styles.followButton}
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
                  <p>{locale === 'en' ? 'Watch more on LuckRead.' : '在 LuckRead 继续发现更多内容。'}</p>
                  <Link className={styles.detailLink} href={'/content/' + encodeURIComponent(item.slug || item.id)}>
                    打开详情
                  </Link>
                </div>

                <aside className={styles.actionRail} aria-label="视频操作">
                  <button className={interaction.liked ? styles.actionActive : styles.action} disabled={busy === 'like' || interaction.restricted} onClick={() => void toggleLike(item)} type="button">
                    <i className={interaction.liked ? 'fa-solid fa-heart' : 'fa-regular fa-heart'} aria-hidden="true" />
                    <span>{interaction.likeCount === null ? '赞' : interaction.likeCount.toLocaleString()}</span>
                  </button>
                  <button className={styles.action} onClick={() => toggleComments(item)} type="button">
                    <i className="fa-regular fa-comment" aria-hidden="true" />
                    <span>评论</span>
                  </button>
                  <button className={interaction.bookmarked ? styles.actionActive : styles.action} disabled={busy === 'bookmark'} onClick={() => void toggleBookmark(item)} type="button">
                    <i className={interaction.bookmarked ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'} aria-hidden="true" />
                    <span>收藏</span>
                  </button>
                  <button className={styles.action} disabled={busy === 'share'} onClick={() => void share(item)} type="button">
                    <i className="fa-solid fa-share" aria-hidden="true" />
                    <span>分享</span>
                  </button>
                  <button className={styles.action} onClick={() => markNotInterested(item)} type="button">
                    <i className="fa-solid fa-minus" aria-hidden="true" />
                    <span>不感兴趣</span>
                  </button>
                  <button className={styles.action} disabled={busy === 'report'} onClick={() => void report(item)} type="button">
                    <i className="fa-solid fa-ellipsis" aria-hidden="true" />
                    <span>更多</span>
                  </button>
                </aside>

                <div className={styles.soundButtonWrap}>
                  <button className={styles.soundButton} onClick={() => setMuted((value) => !value)} type="button">
                    <i className={muted ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high'} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </section>

      {page.hasMore && page.nextCursor ? (
        <div className={styles.loadMoreSentinel} aria-live="polite">
          {loadingMore ? '正在载入更多视频…' : '继续滑动加载更多'}
          <button
            className={styles.hiddenLoadButton}
            aria-label="加载更多短视频"
            disabled={loadingMore}
            onClick={() => void loadPage(page.nextCursor ?? null)}
            type="button"
          />
        </div>
      ) : null}

      {message ? (
        <div className={styles.toast} role="status">
          {message}
          <button onClick={() => setMessage('')} type="button">×</button>
        </div>
      ) : null}

      <nav className={styles.bottomNav} aria-label="主导航">
        <Link href="/" className={styles.navItem}><i className="fa-solid fa-house" aria-hidden="true" /><span>首页</span></Link>
        <Link href="/content?type=video" className={styles.navItem}><i className="fa-solid fa-compass" aria-hidden="true" /><span>探索</span></Link>
        <Link href="/publish?type=video" className={styles.navCreate}><i className="fa-solid fa-plus" aria-hidden="true" /></Link>
        <Link href="/creator-center" className={styles.navItem}><i className="fa-solid fa-user-pen" aria-hidden="true" /><span>创作</span></Link>
        <Link href="/users/" className={styles.navItem}><i className="fa-solid fa-user" aria-hidden="true" /><span>我</span></Link>
      </nav>

      {commentsOpen && commentsContentId ? (
        <div className={styles.drawerBackdrop} role="presentation" onMouseDown={() => setCommentsOpen(false)}>
          <aside className={styles.commentsDrawer} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="评论">
            <header className={styles.commentsHeader}>
              <strong>评论</strong>
              <button onClick={() => setCommentsOpen(false)} type="button" aria-label="关闭评论">×</button>
            </header>
            <div className={styles.commentsBody}>
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
