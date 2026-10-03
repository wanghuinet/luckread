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

const contentTypeLabels: Record<PublicContent['contentType'], string> = {
  article: '文章',
  post: '动态',
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
  const [safetyMessage, setSafetyMessage] = useState('')
  const [contents, setContents] = useState<PublicContent[]>([])
  const [contentCursor, setContentCursor] = useState<string | null>(null)
  const [contentHasMore, setContentHasMore] = useState(false)
  const [contentLoading, setContentLoading] = useState(true)
  const [contentError, setContentError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'article' | 'post' | 'video'>('all')
  const [shareMessage, setShareMessage] = useState('')
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
          fetch('/api/v1/contents?creatorId=' + encodeURIComponent(userId) + '&limit=6', {
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
              following?: boolean
              followedBy?: boolean
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
          setFollowers(typeof followerData?.data?.totalCount === 'number' ? followerData.data.totalCount : null)
          setFollowing(typeof followingData?.data?.totalCount === 'number' ? followingData.data.totalCount : null)
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

  async function loadMoreContents() {
    if (contentLoading || !contentHasMore || !contentCursor || !profile) return
    contentRequestRef.current?.abort()
    const controller = new AbortController()
    contentRequestRef.current = controller
    const requestId = ++contentRequestIdRef.current
    setContentLoading(true)
    setContentError('')
    try {
      const response = await fetch(
        '/api/v1/contents?creatorId=' + encodeURIComponent(profile.id) + '&limit=6&cursor=' + encodeURIComponent(contentCursor),
        {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        },
      )
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
      if (!response.ok || typeof data?.data?.following !== 'boolean') {
        throw new Error('FOLLOW_FAILED')
      }

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
        body: JSON.stringify({
          targetType: 'profile',
          targetId: profile.id,
          reasonCode,
        }),
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
    setShareMessage('')
    const shareUrl = window.location.href
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: profile.displayName?.trim() || profile.username,
          text: profile.bio?.trim() || 'LuckRead 个人主页',
          url: shareUrl,
        })
        return
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl)
        setShareMessage('主页链接已复制。')
        return
      }
      setShareMessage('当前浏览器不支持直接复制链接。')
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setShareMessage('分享暂时不可用，请复制地址栏链接。')
    }
  }

  if (loading) {
    return <main className="content-detail" aria-busy="true"><p className="content-detail-state" role="status">正在加载作者资料…</p></main>
  }

  if (error && !profile) {
    return (
      <main className="content-detail">
        <div className="content-detail-state">
          <p role="alert">{error}</p>
          <Link href="/content">返回发现</Link>
        </div>
      </main>
    )
  }

  const displayName = profile?.displayName?.trim() || profile?.username || 'LuckRead 用户'
  const initial = displayName.slice(0, 1).toUpperCase()
  const visibleContents = activeTab === 'all'
    ? contents
    : contents.filter((item) => item.contentType === activeTab)

  const tabEmptyCopy: Record<typeof activeTab, string> = {
    all: '这个主页还没有公开作品，等第一篇内容发布后，这里会成为你的作品橱窗。',
    article: '还没有公开文章。',
    post: '还没有公开动态。',
    video: '还没有公开视频。',
  }

  return (
    <main className="lr-profile-page">
      <div className="lr-profile-topbar">
        <Link href="/content" className="lr-profile-back">← 发现</Link>
        <div className="lr-profile-topbar-actions">
          <Link href="/" className="lr-profile-topbar-link">首页</Link>
          {viewerUserId === profile?.id ? <Link href="/me/profile" className="lr-profile-topbar-link">个人设置</Link> : null}
        </div>
      </div>

      <section className="lr-profile-hero" aria-labelledby="public-profile-title">
        <div className="lr-profile-cover" aria-hidden="true">
          <div className="lr-profile-cover-orb lr-profile-cover-orb-one" />
          <div className="lr-profile-cover-orb lr-profile-cover-orb-two" />
          <div className="lr-profile-cover-grid" />
          <span className="lr-profile-cover-label">LUCKREAD · PERSONAL SPACE</span>
        </div>

        <div className="lr-profile-hero-body">
          <div className="lr-profile-identity-row">
            <div className="lr-profile-avatar-wrap">
              <div
                className="lr-profile-avatar"
                aria-label={displayName + ' 头像'}
                role="img"
              >
                {profile?.avatar ? (
                  <img alt="" height={104} loading="eager" src={profile.avatar} width={104} />
                ) : (
                  initial
                )}
              </div>
            </div>

            <div className="lr-profile-identity-copy">
              <div className="lr-profile-kicker-row">
                <span className="lr-profile-kicker">个人主页</span>
                <span className="lr-profile-status">公开</span>
              </div>
              <h1 id="public-profile-title">{displayName}</h1>
              <p className="lr-profile-handle">@{profile?.username}</p>
              <p className={profile?.bio ? "lr-profile-bio" : "lr-profile-bio lr-profile-bio-muted"}>
                {profile?.bio || '还没有填写个人简介，先让主页替你说第一句话。'}
              </p>
            </div>

            <div className="lr-profile-actions">
              {viewerUserId === profile?.id ? (
                <Link href="/me/profile" className="lr-profile-action lr-profile-action-primary">编辑资料</Link>
              ) : blocked || blockedBy ? (
                <span className="lr-profile-relation-note">当前关系受屏蔽规则限制</span>
              ) : (
                <button
                  className="lr-profile-action lr-profile-action-primary"
                  disabled={followBusy}
                  onClick={() => void toggleFollow()}
                  type="button"
                >
                  {followBusy ? '处理中…' : isFollowing ? '已关注' : '关注'}
                </button>
              )}

              <button
                className="lr-profile-action lr-profile-action-premium"
                disabled
                title="付费订阅将在 2.0 开放"
                type="button"
              >
                <span>会员订阅</span>
                <small>2.0</small>
              </button>

              <button className="lr-profile-action lr-profile-action-secondary" onClick={() => void shareProfile()} type="button">
                分享主页
              </button>
            </div>
          </div>

          <div className="lr-profile-statbar" aria-label="主页数据">
            <Link href={'/users/' + encodeURIComponent(profile!.id) + '/followers'} className="lr-profile-stat">
              <strong>{followers === null ? '—' : followers.toLocaleString('zh-CN')}</strong>
              <span>粉丝</span>
            </Link>
            <Link href={'/users/' + encodeURIComponent(profile!.id) + '/following'} className="lr-profile-stat">
              <strong>{following === null ? '—' : following.toLocaleString('zh-CN')}</strong>
              <span>关注</span>
            </Link>
            <div className="lr-profile-stat">
              <strong>{contentHasMore ? String(contents.length) + '+' : contents.length}</strong>
              <span>公开作品</span>
            </div>
            <div className="lr-profile-stat lr-profile-stat-future">
              <strong>—</strong>
              <span>会员 · 2.0</span>
            </div>
          </div>

          {shareMessage ? <p className="lr-profile-share-message" role="status">{shareMessage}</p> : null}
        </div>
      </section>

      <div className="lr-profile-layout">
        <section className="lr-profile-main-card" aria-labelledby="profile-content-title">
          <header className="lr-profile-section-head">
            <div>
              <p className="lr-profile-eyebrow">CREATOR COLLECTION</p>
              <h2 id="profile-content-title">内容空间</h2>
            </div>
            <span className="lr-profile-section-meta">1.0 已开放 · 2.0 已预留</span>
          </header>

          <div className="lr-profile-tabs" role="tablist" aria-label="主页内容分类">
            <button
              aria-selected={activeTab === 'all'}
              className={activeTab === 'all' ? 'lr-profile-tab active' : 'lr-profile-tab'}
              onClick={() => setActiveTab('all')}
              role="tab"
              type="button"
            >
              全部
            </button>
            <button
              aria-selected={activeTab === 'article'}
              className={activeTab === 'article' ? 'lr-profile-tab active' : 'lr-profile-tab'}
              onClick={() => setActiveTab('article')}
              role="tab"
              type="button"
            >
              文章
            </button>
            <button
              aria-selected={activeTab === 'post'}
              className={activeTab === 'post' ? 'lr-profile-tab active' : 'lr-profile-tab'}
              onClick={() => setActiveTab('post')}
              role="tab"
              type="button"
            >
              动态
            </button>
            <button
              aria-selected={activeTab === 'video'}
              className={activeTab === 'video' ? 'lr-profile-tab active' : 'lr-profile-tab'}
              onClick={() => setActiveTab('video')}
              role="tab"
              type="button"
            >
              视频
            </button>
            <button className="lr-profile-tab lr-profile-tab-future" disabled type="button">
              漫剧 <span>2.0</span>
            </button>
            <button className="lr-profile-tab lr-profile-tab-future" disabled type="button">
              会员 <span>2.0</span>
            </button>
          </div>

          {contentError ? <div className="lr-profile-inline-error" role="status">{contentError}</div> : null}

          {contentLoading && visibleContents.length === 0 ? (
            <div className="lr-profile-content-loading" role="status">
              <span className="lr-profile-skeleton lr-profile-skeleton-cover" />
              <span className="lr-profile-skeleton lr-profile-skeleton-line" />
              <span className="lr-profile-skeleton lr-profile-skeleton-line short" />
            </div>
          ) : null}

          {!contentLoading && visibleContents.length === 0 && !contentError ? (
            <div className="lr-profile-empty">
              <div className="lr-profile-empty-icon" aria-hidden="true">✦</div>
              <h3>{activeTab === 'all' ? '正在构建你的内容空间' : tabEmptyCopy[activeTab]}</h3>
              <p>{tabEmptyCopy[activeTab]}</p>
              {viewerUserId === profile?.id ? (
                <Link className="lr-profile-empty-action" href="/publish">发布第一篇内容</Link>
              ) : (
                <span className="lr-profile-empty-note">新内容发布后会自动出现在这里。</span>
              )}
            </div>
          ) : null}

          {visibleContents.length > 0 ? (
            <div className="lr-profile-work-grid">
              {visibleContents.map((item) => (
                <Link
                  className="lr-profile-work-card"
                  href={'/' + encodeURIComponent(profile!.username) + '/' + item.contentType + '/' + encodeURIComponent(item.id)}
                  key={item.id}
                >
                  <div className={item.coverRef ? 'lr-profile-work-cover has-image' : 'lr-profile-work-cover'}>
                    {item.coverRef ? <img alt="" loading="lazy" src={item.coverRef} /> : <span>{contentTypeLabels[item.contentType]}</span>}
                  </div>
                  <div className="lr-profile-work-body">
                    <span className="lr-profile-work-type">{contentTypeLabels[item.contentType]}</span>
                    <strong>{item.title}</strong>
                    {item.updatedAt ? (
                      <time dateTime={item.updatedAt}>
                        {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                      </time>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          ) : null}

          {contentHasMore && contentCursor ? (
            <div className="lr-profile-load-more">
              <button
                className="lr-profile-load-button"
                disabled={contentLoading}
                onClick={() => void loadMoreContents()}
                type="button"
              >
                {contentLoading ? '加载中…' : '加载更多作品'}
              </button>
            </div>
          ) : null}
        </section>

        <aside className="lr-profile-side">
          <section className="lr-profile-premium-card" id="membership">
            <div className="lr-profile-premium-card-top">
              <span className="lr-profile-eyebrow">MEMBERSHIP · 2.0</span>
              <span className="lr-profile-pill">预留</span>
            </div>
            <h2>支持你喜欢的创作者</h2>
            <p>未来可在这里承载月度会员、专属文章、会员动态、独家视频与会员权益。</p>
            <div className="lr-profile-premium-preview">
              <div>
                <small>MEMBER ACCESS</small>
                <strong>Exclusive Space</strong>
              </div>
              <span>LOCKED</span>
            </div>
            <button className="lr-profile-side-cta" disabled type="button">订阅功能将在 2.0 开放</button>
          </section>

          <section className="lr-profile-drama-card" id="drama">
            <div className="lr-profile-drama-art" aria-hidden="true">
              <span>DRAMA</span>
              <strong>COMING<br />SOON</strong>
            </div>
            <div className="lr-profile-drama-copy">
              <p className="lr-profile-eyebrow">MICRO DRAMA · 2.0</p>
              <h2>漫剧专区</h2>
              <p>预留剧集封面、集数、进度、VIP 解锁和连续追剧入口，1.0 不提前实现业务。</p>
            </div>
          </section>

          <section className="lr-profile-service-card">
            <div className="lr-profile-service-row">
              <div>
                <strong>动态</strong>
                <span>社交表达 · 已预留</span>
              </div>
              <span>1.0</span>
            </div>
            <div className="lr-profile-service-row">
              <div>
                <strong>视频</strong>
                <span>视频内容 · 已预留</span>
              </div>
              <span>1.0</span>
            </div>
            <div className="lr-profile-service-row muted">
              <div>
                <strong>付费内容</strong>
                <span>会员 / 漫剧 / 专属空间</span>
              </div>
              <span>2.0</span>
            </div>
          </section>
        </aside>
      </div>

      {viewerUserId !== profile?.id ? (
        <section className="lr-profile-safety-card" aria-label="安全与关系设置">
          <div>
            <p className="lr-profile-eyebrow">SAFETY</p>
            <strong>关系与安全</strong>
            <span>屏蔽、静音和举报不会进入内容业务链。</span>
          </div>
          <div className="lr-profile-safety-actions">
            <button className="lr-profile-safety-button" disabled={blockBusy} onClick={() => void applySafetyAction('block')} type="button">
              {blockBusy ? (blocked ? '取消中…' : '屏蔽中…') : blocked ? '取消屏蔽' : '屏蔽作者'}
            </button>
            <button className="lr-profile-safety-button" disabled={muteBusy} onClick={() => void applySafetyAction('mute')} type="button">
              {muteBusy ? (muted ? '取消中…' : '静音中…') : muted ? '取消静音' : '静音作者'}
            </button>
            <button className="lr-profile-safety-button" disabled={reportBusy} onClick={() => void reportProfile()} type="button">
              {reportBusy ? '举报中…' : '举报用户'}
            </button>
            {safetyMessage ? <span className="lr-profile-safety-message" role="status">{safetyMessage}</span> : null}
          </div>
        </section>
      ) : null}
    </main>
  )
}
