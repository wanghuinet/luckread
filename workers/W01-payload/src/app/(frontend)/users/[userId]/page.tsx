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
        if (!cancelled) {
          setFollowers(typeof followerData?.data?.totalCount === 'number' ? followerData.data.totalCount : null)
          setFollowing(typeof followingData?.data?.totalCount === 'number' ? followingData.data.totalCount : null)
          setIsFollowing(followData?.data?.following === true)
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
    </main>
  )
}
