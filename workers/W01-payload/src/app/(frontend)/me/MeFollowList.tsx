'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

type Direction = 'followers' | 'following'

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

type ProfileResponse = {
  id?: string
  username?: string
  displayName?: string | null
  avatar?: string | null
  error?: { message?: string }
}

type FollowListResponse = {
  data?: FollowListPage
  error?: { message?: string }
}

const PAGE_SIZE = 20

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function MeFollowList({ direction }: { direction: Direction }) {
  const isFollowers = direction === 'followers'
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [items, setItems] = useState<FollowListItem[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const loadProfile = useCallback(async (signal?: AbortSignal): Promise<string> => {
    const response = await fetch('/api/v1/users/me', {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    })
    const data = await response.json().catch((): null => null) as ProfileResponse | null
    if (response.status === 401) {
      const returnTo = window.location.pathname + window.location.search + window.location.hash
      window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
      throw new Error('UNAUTHENTICATED')
    }
    if (!response.ok || typeof data?.id !== 'string' || !data.id.trim()) {
      throw new Error(data?.error?.message || '个人资料加载失败')
    }
    setDisplayName(data.displayName?.trim() || data.username?.trim() || '我的账号')
    setUserId(data.id)
    return data.id
  }, [])

  const loadList = useCallback(async (
    ownerId: string,
    cursor: string | null,
    append: boolean,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (cursor) params.set('cursor', cursor)

    const response = await fetch(
      '/api/v1/users/' + encodeURIComponent(ownerId) + '/' + direction + '?' + params.toString(),
      {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
      },
    )
    const data = await response.json().catch((): null => null) as FollowListResponse | null
    if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
      throw new Error(data?.error?.message || '关系列表加载失败')
    }

    setItems((current) => append ? [...current, ...data.data!.items] : data.data!.items)
    setTotalCount(data.data.totalCount)
    setNextCursor(data.data.nextCursor)
    setHasMore(data.data.hasMore)
  }, [direction])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const ownerId = userId ?? await loadProfile()
      await loadList(ownerId, null, false)
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'UNAUTHENTICATED') return
      setError(cause instanceof Error ? cause.message : '关系列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [loadList, loadProfile, userId])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        const ownerId = await loadProfile(controller.signal)
        await loadList(ownerId, null, false, controller.signal)
      } catch (cause) {
        if (controller.signal.aborted || (cause instanceof Error && cause.message === 'UNAUTHENTICATED')) return
        setError(cause instanceof Error ? cause.message : '关系列表加载失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [direction, loadList, loadProfile])

  async function loadMore() {
    if (!userId || loadingMore || !hasMore || !nextCursor) return
    setLoadingMore(true)
    setError('')
    try {
      await loadList(userId, nextCursor, true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更多关系加载失败')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <main style={{ maxWidth: 860, margin: '48px auto', padding: '0 20px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, letterSpacing: 1.5, color: '#667085' }}>LUCKREAD · SOCIAL</p>
          <h1 style={{ margin: '8px 0 4px' }}>{isFollowers ? '我的粉丝' : '我的关注'}</h1>
          <p style={{ margin: 0, color: '#667085' }}>
            {displayName ? displayName + '的' : '我的'}{isFollowers ? '粉丝列表' : '关注列表'}。
            {totalCount === null ? '' : ' 共 ' + totalCount.toLocaleString('zh-CN') + ' 个关系。'}
          </p>
        </div>
        <nav aria-label="我的社交关系" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/me/profile">个人资料</Link>
          <Link href="/me/followers" aria-current={isFollowers ? 'page' : undefined}>我的粉丝</Link>
          <Link href="/me/following" aria-current={!isFollowers ? 'page' : undefined}>我的关注</Link>
          <Link href="/me/subscriptions">我的订阅</Link>
        </nav>
      </header>

      {error ? <p role="alert" style={{ marginTop: 24, color: '#b42318' }}>{error}</p> : null}
      {loading ? <p role="status" style={{ marginTop: 24 }}>正在加载…</p> : null}

      {!loading && items.length === 0 && !error ? (
        <section style={{ marginTop: 24, padding: 28, border: '1px solid #e4e7ec', borderRadius: 14 }}>
          <strong>{isFollowers ? '还没有粉丝。' : '还没有关注用户。'}</strong>
          <p style={{ margin: '8px 0 0', color: '#667085' }}>
            {isFollowers ? '当其他用户关注你后，会在这里看到。' : '去作者主页关注感兴趣的创作者后，会在这里看到。'}
          </p>
          <Link href="/content" style={{ display: 'inline-block', marginTop: 14 }}>去发现内容</Link>
        </section>
      ) : null}

      {items.length > 0 ? (
        <section aria-label={isFollowers ? '粉丝列表' : '关注列表'} style={{ marginTop: 24, display: 'grid', gap: 10 }}>
          {items.map((item) => (
            <article
              key={item.relationshipId}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 16,
                padding: 16,
                border: '1px solid #e4e7ec',
                borderRadius: 14,
                background: '#fff',
              }}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    flex: '0 0 auto',
                    background: '#eef4ff',
                    color: '#2458e6',
                    fontWeight: 800,
                  }}
                >
                  {item.userId.slice(0, 1).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <Link
                    href={'/users/' + encodeURIComponent(item.userId)}
                    style={{ fontWeight: 700, color: '#101828', textDecoration: 'none' }}
                  >
                    用户 {item.userId}
                  </Link>
                  <div style={{ marginTop: 4, color: '#667085', fontSize: 13 }}>
                    关系建立于 {formatDate(item.followedAt)}
                  </div>
                </div>
              </div>
              <Link href={'/users/' + encodeURIComponent(item.userId)} style={{ whiteSpace: 'nowrap' }}>
                查看主页
              </Link>
            </article>
          ))}

          {hasMore && nextCursor ? (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
              <button disabled={loadingMore} onClick={() => void loadMore()} type="button">
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {!loading && !error ? (
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 20 }}>
          <button onClick={() => void load()} type="button">刷新列表</button>
        </div>
      ) : null}
    </main>
  )
}
