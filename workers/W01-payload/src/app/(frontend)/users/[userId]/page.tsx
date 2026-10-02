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
  const [isFollowing, setIsFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
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
        const [profileResponse, followersResponse, followingResponse, followResponse] = await Promise.all([
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
        const followData = await followResponse.json().catch((): null => null) as { data?: { following?: boolean } } | null
        const contentData = await contentResponse.json().catch((): null => null) as ContentListResponse | null
        if (!cancelled) {
          setFollowers(typeof followerData?.data?.totalCount === 'number' ? followerData.data.totalCount : null)
          setFollowing(typeof followingData?.data?.totalCount === 'number' ? followingData.data.totalCount : null)
          setIsFollowing(followData?.data?.following === true)
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
        headers: { accept: 'application/json' },
      })

      if (response.status === 401) {
        router.replace('/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search))
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
            aria-hidden="true"
            style={{
              width: 72,
              height: 72,
              display: 'grid',
              placeItems: 'center',
              marginBottom: 16,
              borderRadius: '50%',
              background: '#eef4ff',
              color: '#2458e6',
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            {initial}
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
          <span>{followers === null ? '—' : followers.toLocaleString('zh-CN')} 粉丝</span>
          <span>{following === null ? '—' : following.toLocaleString('zh-CN')} 关注</span>
          <button
            className="content-detail-follow"
            disabled={followBusy}
            onClick={() => void toggleFollow()}
            type="button"
          >
            {followBusy ? '处理中…' : isFollowing ? '已关注' : '关注作者'}
          </button>
          {error ? <span className="content-detail-action-status" role="status">{error}</span> : null}
        </div>
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
                  <img
                    alt=""
                    height={72}
                    loading="lazy"
                    src={item.coverRef}
                    style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 8 }}
                    width={96}
                  />
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
