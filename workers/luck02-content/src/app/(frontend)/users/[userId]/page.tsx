'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

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
  contentType: 'article' | 'post' | 'video'
  title: string
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

type ProfileFilter = PublicContent['contentType']

const filterLabels: Record<ProfileFilter, string> = {
  post: '笔记',
  article: '文章',
  video: '视频',
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
  const [filter, setFilter] = useState<ProfileFilter>('post')
  const [contents, setContents] = useState<PublicContent[]>([])
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
        const [profileResponse, followersResponse, followingResponse, followResponse, contentResponse, viewerResponse] = await Promise.all([
          fetch('/api/v1/users/' + encodeURIComponent(userId), {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetch('/api/v1/users/' + encodeURIComponent(userId) + '/followers?limit=1', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetch('/api/v1/users/' + encodeURIComponent(userId) + '/following?limit=1', {
            credentials: 'include',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetch('/api/v1/social/follows/' + encodeURIComponent(userId), {
            credentials: 'include',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetch('/api/v1/contents?creatorId=' + encodeURIComponent(userId) + '&limit=6&type=post', {
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

        const data = await profileResponse.json().catch((): null => null) as PublicProfile | { error?: { message?: string } } | null
        if (profileResponse.status === 404) throw new Error('USER_NOT_FOUND')
        if (!profileResponse.ok || !data || !('id' in data)) {
          throw new Error(data && 'error' in data ? data.error?.message || '资料加载失败' : '资料加载失败')
        }

        if (cancelled) return
        setProfile(data)

        const followerData = await followersResponse.json().catch((): null => null) as CountResponse | null
        const followingData = await followingResponse.json().catch((): null => null) as CountResponse | null
        const followData = await followResponse.json().catch((): null => null) as {
          data?: {
            following?: boolean
            relationship?: {
              mutualFollow?: boolean
              blocked?: boolean
              blockedBy?: boolean
              muted?: boolean
            }
          }
        } | null
        const contentData = await contentResponse.json().catch((): null => null) as ContentListResponse | null
        const viewerData = await viewerResponse.json().catch((): null => null) as { id?: string } | null

        if (!cancelled) {
          setFollowers(typeof followerData?.data?.totalCount === 'number' ? followerData.data.totalCount : 0)
          setFollowing(typeof followingData?.data?.totalCount === 'number' ? followingData.data.totalCount : 0)
          setViewerUserId(typeof viewerData?.id === 'string' ? viewerData.id : null)
          setIsFollowing(followData?.data?.following === true)
          setMutualFollow(followData?.data?.relationship?.mutualFollow === true)
          setBlocked(followData?.data?.relationship?.blocked === true)
          setBlockedBy(followData?.data?.relationship?.blockedBy === true)
          setMuted(followData?.data?.relationship?.muted === true)
          const items = Array.isArray(contentData?.data?.items) ? contentData.data.items : []
          setContents(items)
          setContentCursor(typeof contentData?.data?.nextCursor === 'string' ? contentData.data.nextCursor : null)
          setContentHasMore(contentData?.data?.hasMore === true)
          setContentError(contentResponse.ok ? '' : '暂时无法加载作者作品。')
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

  async function reloadContents(nextFilter: ProfileFilter) {
    if (!profile) return
    contentRequestRef.current?.abort()
    const controller = new AbortController()
    contentRequestRef.current = controller
    const requestId = ++contentRequestIdRef.current

    setFilter(nextFilter)
    setContentLoading(true)
    setContentError('')
    setContents([])
    setContentCursor(null)
    setContentHasMore(false)

    try {
      const query = [
        'creatorId=' + encodeURIComponent(profile.id),
        'limit=6',
        'type=' + encodeURIComponent(nextFilter),
      ].join('&')
      const response = await fetch('/api/v1/contents?' + query, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = await response.json().catch((): null => null) as ContentListResponse | null
      if (!response.ok || !Array.isArray(data?.data?.items)) {
        throw new Error('CONTENT_LIST_FAILED')
      }
      if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return
      setContents(data.data.items)
      setContentCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
      setContentHasMore(data.data.hasMore === true)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (requestId !== contentRequestIdRef.current) return
      setContentError('暂时无法加载作品，请稍后重试。')
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
      const params = new URLSearchParams({
        creatorId: profile.id,
        limit: '6',
        cursor: contentCursor,
      })
      params.set('type', filter)

      const response = await fetch('/api/v1/contents?' + params.toString(), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = await response.json().catch((): null => null) as ContentListResponse | null
      if (!response.ok || !Array.isArray(data?.data?.items)) {
        throw new Error('CONTENT_LIST_FAILED')
      }
      if (requestId !== contentRequestIdRef.current || controller.signal.aborted) return
      setContents((current) => [...current, ...data.data.items])
      setContentCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
      setContentHasMore(data.data.hasMore === true)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (requestId !== contentRequestIdRef.current) return
      setContentError('暂时无法加载更多作品，请稍后重试。')
    } finally {
      if (requestId === contentRequestIdRef.current) setContentLoading(false)
    }
  }

  async function toggleFollow() {
    if (!profile || followBusy) return
    setFollowBusy(true)
    setError('')

    try {
      const response = await fetch('/api/v1/social/follows/' + encodeURIComponent(profile.id), {
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

      const data = await response.json().catch((): null => null) as { data?: { following?: boolean } } | null
      if (!response.ok || typeof data?.data?.following !== 'boolean') throw new Error('FOLLOW_FAILED')

      setIsFollowing(data.data.following)
      setFollowers((value) => value === null ? value : Math.max(0, value + (data.data.following ? 1 : -1)))
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
      const response = await fetch('/api/v1/reports', {
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
      const data = await response.json().catch((): null => null) as { data?: { status?: string } } | null
      if (!response.ok || !data?.data) throw new Error('REPORT_FAILED')
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
      const response = await fetch(
        '/api/v1/interactions/' + relationPath + (active ? '/' + encodeURIComponent(profile.id) : ''),
        {
          method: active ? 'DELETE' : 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'social-' + action + ':' + (active ? 'remove:' : 'set:') + crypto.randomUUID(),
            ...(active ? {} : { 'content-type': 'application/json' }),
          },
          ...(active ? {} : { body: JSON.stringify({ targetUserId: profile.id }) }),
        },
      )

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
  const visibleContents = contents.filter((item) => item.contentType === filter)

  function getContentHref(item: PublicContent) {
    return '/' + encodeURIComponent(profile!.username) + '/' + item.contentType + '/' + encodeURIComponent(item.id)
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

        <section className="creator-profile-hero" aria-labelledby="creator-profile-title">
          <div className="creator-profile-cover" aria-hidden="true" />
          <div className="creator-profile-hero-main">
            <div className="creator-profile-avatar" aria-label={name + ' 头像'}>
              {profile?.avatar ? (
                <img
                  alt=""
                  height={96}
                  loading="eager"
                  src={profile.avatar}
                  width={96}
                />
              ) : initial}
            </div>

            <div className="creator-profile-identity">
              <h1 id="creator-profile-title">{name}</h1>
              <p className="creator-profile-handle">@{profile?.username}</p>
              {<p className={'creator-profile-bio' + (profile?.bio?.trim() ? '' : ' is-placeholder')}>{profile?.bio?.trim() ? profile.bio : '尚无个人简介'}</p>}
            </div>

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
          </div>

          <dl className="creator-profile-stats" aria-label="作者数据">
            <div>
              <dt>关注</dt>
              <dd>{following === null ? '—' : following.toLocaleString('zh-CN')}</dd>
            </div>
            <div>
              <dt>粉丝</dt>
              <dd>{followers === null ? '—' : followers.toLocaleString('zh-CN')}</dd>
            </div>
            <div>
              <dt>作品</dt>
              <dd>{contents.length.toLocaleString('zh-CN')}</dd>
            </div>
          </dl>

          {viewerUserId !== profile.id && safetyMessage ? (
            <p className="creator-profile-global-message" role="status">{safetyMessage}</p>
          ) : null}
        </section>

        <nav className="creator-profile-tabs" aria-label="作者内容频道" role="tablist">
          {(Object.keys(filterLabels) as ProfileFilter[]).map((value) => (
            <button
              className={'creator-profile-tab' + (filter === value ? ' is-active' : '')}
              key={value}
              aria-selected={filter === value}
              role="tab"
              type="button"
              onClick={() => void reloadContents(value)}
            >
              {filterLabels[value]}
            </button>
          ))}
        </nav>

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
          {contentLoading && contents.length === 0 ? (
            <div className="creator-profile-empty"><p role="status">暂无作品</p></div>
          ) : null}
          {!contentLoading && visibleContents.length === 0 && !contentError ? (
            <div className="creator-profile-empty">
              <p>暂无{filterLabels[filter]}公开作品</p>
            </div>
          ) : null}

          {visibleContents.length > 0 ? (
            <div className="creator-profile-grid">
              {visibleContents.map((item) => (
                <Link className="creator-profile-card" href={getContentHref(item)} key={item.id}>
                  <div className="creator-profile-card-media">
                    {item.coverRef ? (
                      <img alt="" height={360} loading="lazy" src={item.coverRef} width={480} />
                    ) : (
                      <span>{item.contentType === 'video' ? '▶' : item.contentType === 'article' ? 'A' : '•'}</span>
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
              ))}
            </div>
          ) : null}
        </section>
      </main>

      {error ? <p className="creator-profile-global-message" role="status">{error}</p> : null}
    </div>
  )
}

function displayName(profile: PublicProfile | null): string {
  return profile?.displayName?.trim() || profile?.username || 'LuckRead 用户'
}
