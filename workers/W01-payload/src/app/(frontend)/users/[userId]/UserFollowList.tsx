'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'

type Direction = 'followers' | 'following'

type PublicProfile = {
  id: string
  username: string
  displayName: string | null
  avatar: string | null
}

type FollowListItem = {
  relationshipId: string
  userId: string
  followedAt: string
}

type FollowListPage = {
  items: FollowListItem[]
  totalCount: number
  nextCursor: string | null
  hasMore: boolean
}

type ProfileResponse = PublicProfile | { error?: { message?: string } }

type ListResponse = {
  data?: FollowListPage
  error?: { message?: string }
}

const PAGE_SIZE = 20

const formatDate = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function UserFollowList({
  userId,
  direction,
}: {
  userId: string
  direction: Direction
}) {
  const isFollowers = direction === 'followers'
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [items, setItems] = useState<FollowListItem[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const activeRequestRef = useRef<AbortController | null>(null)
  const requestGenerationRef = useRef(0)

  const beginRequest = useCallback(() => {
    activeRequestRef.current?.abort()
    const controller = new AbortController()
    activeRequestRef.current = controller
    requestGenerationRef.current += 1
    return { controller, generation: requestGenerationRef.current }
  }, [])

  const isCurrentRequest = useCallback(
    (controller: AbortController, generation: number): boolean =>
      activeRequestRef.current === controller &&
      requestGenerationRef.current === generation &&
      !controller.signal.aborted,
    [],
  )

  const load = useCallback(async (cursor: string | null = null) => {
    const { controller, generation } = beginRequest()
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (cursor) params.set('cursor', cursor)

      const { response, data } = await fetchJson<ListResponse>(
        '/api/v1/users/' + encodeURIComponent(userId) + '/' + direction + '?' + params.toString(),
        {
          credentials: 'omit',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        },
      )

      if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
        throw new Error(getApiErrorMessage(data, '关系列表加载失败'))
      }

      if (!isCurrentRequest(controller, generation)) return
      setItems((current) => cursor ? [...current, ...data.data!.items] : data.data!.items)
      setTotalCount(typeof data.data.totalCount === 'number' ? data.data.totalCount : null)
      setNextCursor(data.data.nextCursor)
      setHasMore(data.data.hasMore)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (!isCurrentRequest(controller, generation)) return
      setError(cause instanceof Error ? cause.message : '关系列表加载失败')
    } finally {
      if (isCurrentRequest(controller, generation)) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [beginRequest, direction, isCurrentRequest, userId])

  useEffect(() => {
    const { controller, generation } = beginRequest()

    void (async () => {
      try {
        const [profileResult, listResult] = await Promise.all([
          fetchJson<ProfileResponse>('/api/v1/users/' + encodeURIComponent(userId), {
            credentials: 'omit',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
          fetchJson<ListResponse>('/api/v1/users/' + encodeURIComponent(userId) + '/' + direction + '?limit=' + String(PAGE_SIZE), {
            credentials: 'omit',
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          }),
        ])

        const { response: profileResponse, data: profileData } = profileResult
        const { response: listResponse, data: listData } = listResult

        if (!profileResponse.ok || !profileData || !('id' in profileData)) {
          throw new Error(profileResponse.status === 404 ? '用户不存在。' : '用户资料加载失败')
        }
        if (!listResponse.ok || !listData?.data || !Array.isArray(listData.data.items)) {
          throw new Error(listData?.error?.message || '关系列表加载失败')
        }
        if (!isCurrentRequest(controller, generation)) return

        setProfile(profileData)
        setItems(listData.data.items)
        setTotalCount(typeof listData.data.totalCount === 'number' ? listData.data.totalCount : null)
        setNextCursor(listData.data.nextCursor)
        setHasMore(listData.data.hasMore)
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (!isCurrentRequest(controller, generation)) return
        setError(cause instanceof Error ? cause.message : '页面加载失败')
      } finally {
        if (isCurrentRequest(controller, generation)) setLoading(false)
      }
    })()

    return () => {
      if (activeRequestRef.current === controller) controller.abort()
    }
  }, [beginRequest, isCurrentRequest, direction, userId])

  const displayName = profile?.displayName?.trim() || profile?.username || 'LuckRead 用户'
  const initial = displayName.slice(0, 1).toUpperCase()

  return (
    <main className="content-detail" aria-busy={loading || loadingMore}>
      <div className="content-detail-top">
        <div className="content-detail-breadcrumbs">
          <Link href={'/users/' + encodeURIComponent(userId)}>← 返回作者主页</Link>
          <Link href="/content">发现内容</Link>
          <Link href="/">首页</Link>
        </div>
      </div>

      <article className="content-detail-card">
        <header className="content-detail-header">
          <div
            aria-label={displayName + ' 头像'}
            role="img"
            style={{
              width: 64,
              height: 64,
              display: 'grid',
              placeItems: 'center',
              marginBottom: 14,
              overflow: 'hidden',
              borderRadius: '50%',
              background: '#eef4ff',
              color: '#2458e6',
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            {profile?.avatar ? (
              <img alt="" height={64} loading="eager" src={profile.avatar} style={{ width: 64, height: 64, objectFit: 'cover' }} width={64} />
            ) : initial}
          </div>
          <p className="eyebrow">LUCKREAD SOCIAL</p>
          <h1>{isFollowers ? '粉丝列表' : '关注列表'}</h1>
          <p style={{ margin: '6px 0 0', color: '#617086' }}>
            {displayName}{isFollowers ? ' 的粉丝' : ' 关注的用户'}
            {totalCount === null ? '' : ' · ' + totalCount.toLocaleString('zh-CN') + ' 人'}
          </p>
        </header>

        <nav aria-label="作者关系导航" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18 }}>
          <Link href={'/users/' + encodeURIComponent(userId) + '/followers'} aria-current={isFollowers ? 'page' : undefined}>
            粉丝
          </Link>
          <Link href={'/users/' + encodeURIComponent(userId) + '/following'} aria-current={!isFollowers ? 'page' : undefined}>
            关注
          </Link>
        </nav>
      </article>

      {error ? (
        <section className="content-detail-card" style={{ marginTop: 20 }}>
          <p className="content-detail-action-status" role="alert">{error}</p>
          <button className="content-detail-retry" onClick={() => void load()} type="button">重新加载</button>
        </section>
      ) : null}

      {!error && loading ? (
        <section className="content-detail-card">
          <p className="content-detail-state" role="status">正在加载…</p>
        </section>
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <section className="content-detail-card" style={{ marginTop: 20 }}>
          <p className="content-detail-muted">{isFollowers ? '这个作者还没有粉丝。' : '这个作者还没有关注其他用户。'}</p>
        </section>
      ) : null}

      {!error && items.length > 0 ? (
        <section className="content-detail-card" aria-label={isFollowers ? '粉丝列表' : '关注列表'} style={{ marginTop: 20 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            {items.map((item) => (
              <article
                key={item.relationshipId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  padding: 14,
                  border: '1px solid #e4eaf1',
                  borderRadius: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Link href={'/users/' + encodeURIComponent(item.userId)} style={{ fontWeight: 700, color: '#101828', textDecoration: 'none' }}>
                    用户 {item.userId}
                  </Link>
                  <div style={{ marginTop: 4, color: '#8a98ab', fontSize: 12 }}>
                    关系建立于 {formatDate(item.followedAt)}
                  </div>
                </div>
                <Link href={'/users/' + encodeURIComponent(item.userId)} style={{ whiteSpace: 'nowrap' }}>
                  查看主页
                </Link>
              </article>
            ))}
          </div>

          {hasMore && nextCursor ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
              <button
                className="content-detail-follow"
                disabled={loadingMore}
                onClick={() => void load(nextCursor)}
                type="button"
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
