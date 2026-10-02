'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
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
  const [followBusy, setFollowBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const [muted, setMuted] = useState(false)
  const [muteBusy, setMuteBusy] = useState(false)
  const [safetyMessage, setSafetyMessage] = useState('')
  const [contents, setContents] = useState<PublicContent[]>([])
  const [contentCursor, setContentCursor] = useState<string | null>(null)
  const [contentHasMore, setContentHasMore] = useState(false)
  const [contentLoading, setContentLoading] = useState(true)
  const [contentError, setContentError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
          setBlocked(followData?.data?.relationship?.blocked === true)
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
    }
  }, [params])

  async function loadMoreContents() {
    if (contentLoading || !contentHasMore || !contentCursor || !profile) return
    setContentLoading(true)
    setContentError('')
    try {
      const response = await fetch(
        '/api/v1/contents?creatorId=' + encodeURIComponent(profile.id) + '&limit=6&cursor=' + encodeURIComponent(contentCursor),
        {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        },
      )
      const data = await response.json().catch((): null => null) as ContentListResponse | null
      if (!response.ok || !Array.isArray(data?.data?.items)) {
        throw new Error('CONTENT_LIST_FAILED')
      }
      setContents((current) => [...current, ...data.data.items])
      setContentCursor(typeof data.data.nextCursor === 'string' ? data.data.nextCursor : null)
      setContentHasMore(data.data.hasMore === true)
    } catch {
      setContentError('暂时无法加载更多作品，请稍后重试。')
    } finally {
      setContentLoading(false)
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

  return (
    <main className="content-detail">
      <div className="content-detail-top">
        <div className="content-detail-breadcrumbs">
          <Link href="/content">← 返回发现</Link>
          <Link href="/">首页</Link>
        </div>
      </div>

      <article className="content-detail-card" aria-labelledby="public-profile-title">
        <header className="content-detail-header">
          <div
            aria-label={displayName + ' 头像'}
            role="img"
            style={{
              width: 72,
              height: 72,
              display: 'grid',
              placeItems: 'center',
              marginBottom: 16,
              overflow: 'hidden',
              borderRadius: '50%',
              background: '#eef4ff',
              color: '#2458e6',
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            {profile?.avatar ? (
              <img
                alt=""
                height={72}
                loading="eager"
                src={profile.avatar}
                style={{ width: 72, height: 72, objectFit: 'cover' }}
                width={72}
              />
            ) : initial}
          </div>
          <p className="eyebrow">LUCKREAD CREATOR</p>
          <h1 id="public-profile-title">{displayName}</h1>
          <p style={{ margin: '6px 0 0', color: '#617086' }}>@{profile?.username}</p>
        </header>

        {profile?.bio ? (
          <p style={{ margin: 0, color: '#334155', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{profile.bio}</p>
        ) : (
          <p className="content-detail-muted">这个用户还没有填写个人简介。</p>
        )}

        <div className="content-detail-actions" style={{ marginTop: 24 }}>
          <Link href={'/users/' + encodeURIComponent(profile.id) + '/followers'}>
            {followers === null ? '—' : followers.toLocaleString('zh-CN')} 粉丝
          </Link>
          <Link href={'/users/' + encodeURIComponent(profile.id) + '/following'}>
            {following === null ? '—' : following.toLocaleString('zh-CN')} 关注
          </Link>
          {viewerUserId === profile.id ? (
            <span className="content-detail-muted">这是你的主页</span>
          ) : (
            <button
              className="content-detail-follow"
              disabled={followBusy}
              onClick={() => void toggleFollow()}
              type="button"
            >
              {followBusy ? '处理中…' : isFollowing ? '已关注' : '关注作者'}
            </button>
          )}
          {error ? <span className="content-detail-action-status" role="status">{error}</span> : null}
        </div>

        {viewerUserId !== profile.id ? (
          <div className="content-detail-safety-actions" aria-label="关系控制">
            <button
              className="content-detail-follow"
              disabled={blockBusy || blocked}
              onClick={() => void applySafetyAction('block')}
              type="button"
            >
              {blockBusy ? (blocked ? '取消中…' : '屏蔽中…') : blocked ? '取消屏蔽' : '屏蔽作者'}
            </button>
            <button
              className="content-detail-follow"
              disabled={muteBusy || muted}
              onClick={() => void applySafetyAction('mute')}
              type="button"
            >
              {muteBusy ? (muted ? '取消中…' : '静音中…') : muted ? '取消静音' : '静音作者'}
            </button>
            {safetyMessage ? <span className="content-detail-action-status" role="status">{safetyMessage}</span> : null}
          </div>
        ) : null}
      </article>

      <section className="content-detail-card" aria-labelledby="author-content-title" style={{ marginTop: 20 }}>
        <header className="content-detail-header">
          <p className="eyebrow">PUBLISHED WORKS</p>
          <h2 id="author-content-title" style={{ marginBottom: 0 }}>公开作品</h2>
        </header>

        {contentError ? <p className="content-detail-action-status" role="status">{contentError}</p> : null}
        {contentLoading && contents.length === 0 ? (
          <p className="content-detail-state" role="status">正在加载作品…</p>
        ) : null}
        {!contentLoading && contents.length === 0 && !contentError ? (
          <p className="content-detail-muted">这个作者还没有公开作品。</p>
        ) : null}

        {contents.length > 0 ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {contents.map((item) => (
              <Link
                href={'/content/' + encodeURIComponent(item.id)}
                key={item.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: item.coverRef ? '96px minmax(0, 1fr)' : '1fr',
                  gap: 14,
                  padding: 14,
                  border: '1px solid #e4eaf1',
                  borderRadius: 12,
                  color: 'inherit',
                  textDecoration: 'none',
                  background: '#fff',
                }}
              >
                {item.coverRef ? (
                  <span
                    aria-hidden="true"
                    style={{
                      width: 96,
                      height: 72,
                      display: 'block',
                      overflow: 'hidden',
                      borderRadius: 8,
                      background: '#eef4ff',
                    }}
                  >
                    <img
                      alt=""
                      loading="lazy"
                      src={item.coverRef}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </span>
                ) : null}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', color: '#617086', fontSize: 11, fontWeight: 700 }}>
                    {contentTypeLabels[item.contentType]}
                  </span>
                  <strong style={{ display: 'block', marginTop: 5, overflow: 'hidden', fontSize: 15, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </strong>
                  {item.updatedAt ? (
                    <time dateTime={item.updatedAt} style={{ display: 'block', marginTop: 7, color: '#8a98ab', fontSize: 11 }}>
                      更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                    </time>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        {contentHasMore && contentCursor ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <button
              className="content-detail-follow"
              disabled={contentLoading}
              onClick={() => void loadMoreContents()}
              type="button"
            >
              {contentLoading ? '加载中…' : '加载更多作品'}
            </button>
          </div>
        ) : null}
      </section>
    </main>
  )
}
