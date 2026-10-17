'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import TwitterCloneFollowRow from '../users/TwitterCloneFollowRow'
import { usePublicLocale } from '../i18n/PublicLanguageToggle'
import TwitterCloneSecondaryPageLayout from '../../(twitter-clone)/TwitterCloneSecondaryPageLayout'

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

export default function MeFollowList({ direction }: { direction: Direction }) {
  const isFollowers = direction === 'followers'
  const locale = usePublicLocale()
  const labels = locale === 'en' ? {
    followers: 'My followers', following: 'Following', account: 'My account', followersOf: 'followers', follows: 'follows', relationships: 'relationships',
    loading: 'Loading…', emptyFollowers: 'You do not have followers yet.', emptyFollowing: 'You are not following anyone yet.',
    emptyFollowersHelp: 'People who follow you will appear here.', emptyFollowingHelp: 'Visit a profile and follow creators to build your list.',
    discover: 'Discover content', unfollow: 'Unfollow', processing: 'Working…', more: 'Load more', loadingMore: 'Loading…', refresh: 'Refresh list',
    social: 'LUCKREAD · SOCIAL',
  } : locale === 'tw' ? {
    followers: '我的粉絲', following: '追蹤中', account: '我的帳號', followersOf: '的粉絲', follows: '追蹤的用戶', relationships: '個關係',
    loading: '載入中…', emptyFollowers: '目前還沒有粉絲。', emptyFollowing: '目前還沒有追蹤用戶。',
    emptyFollowersHelp: '有人追蹤你後，就會顯示在這裡。', emptyFollowingHelp: '前往作者主頁並追蹤感興趣的創作者。',
    discover: '探索內容', unfollow: '取消追蹤', processing: '處理中…', more: '載入更多', loadingMore: '載入中…', refresh: '重新整理列表',
    social: 'LUCKREAD · 社交',
  } : {
    followers: '我的粉丝', following: '我的关注', account: '我的账号', followersOf: '的粉丝', follows: '关注的用户', relationships: '个关系',
    loading: '正在加载…', emptyFollowers: '还没有粉丝。', emptyFollowing: '还没有关注用户。',
    emptyFollowersHelp: '当其他用户关注你后，会在这里看到。', emptyFollowingHelp: '去作者主页关注感兴趣的创作者后，会在这里看到。',
    discover: '去发现内容', unfollow: '取消关注', processing: '处理中…', more: '加载更多', loadingMore: '加载中…', refresh: '刷新列表',
    social: 'LUCKREAD · 社交',
  }
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [items, setItems] = useState<FollowListItem[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unfollowingId, setUnfollowingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const requestControllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)

  const loadProfile = useCallback(async (signal?: AbortSignal): Promise<string> => {
    const { response, data } = await fetchJson<ProfileResponse>('/api/v1/users/me', {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    })
    if (response.status === 401) {
      const returnTo = window.location.pathname + window.location.search + window.location.hash
      window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
      throw new Error('UNAUTHENTICATED')
    }
    if (!response.ok || typeof data?.id !== 'string' || !data.id.trim()) {
      throw new Error(getApiErrorMessage(data, '个人资料加载失败'))
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

    const { response, data } = await fetchJson<FollowListResponse>(
      '/api/v1/users/' + encodeURIComponent(ownerId) + '/' + direction + '?' + params.toString(),
      {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal,
      },
    )
    if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
      throw new Error(getApiErrorMessage(data, '关系列表加载失败'))
    }

    setItems((current) => append ? [...current, ...data.data!.items] : data.data!.items)
    setTotalCount(data.data.totalCount)
    setNextCursor(data.data.nextCursor)
    setHasMore(data.data.hasMore)
  }, [direction])

  const beginRequest = useCallback(() => {
    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    const requestId = ++requestIdRef.current
    return { controller, requestId }
  }, [])

  const load = useCallback(async () => {
    const { controller, requestId } = beginRequest()
    setLoading(true)
    setError('')
    try {
      const ownerId = userId ?? await loadProfile(controller.signal)
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      await loadList(ownerId, null, false, controller.signal)
    } catch (cause) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      if (cause instanceof Error && cause.message === 'UNAUTHENTICATED') return
      setError(cause instanceof Error ? cause.message : '关系列表加载失败')
    } finally {
      if (requestId === requestIdRef.current && !controller.signal.aborted) {
        setLoading(false)
        if (requestControllerRef.current === controller) requestControllerRef.current = null
      }
    }
  }, [beginRequest, loadList, loadProfile, userId])

  useEffect(() => {
    const { controller, requestId } = beginRequest()

    void (async () => {
      try {
        const ownerId = await loadProfile(controller.signal)
        if (controller.signal.aborted || requestId !== requestIdRef.current) return
        await loadList(ownerId, null, false, controller.signal)
      } catch (cause) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return
        if (cause instanceof Error && cause.message === 'UNAUTHENTICATED') return
        setError(cause instanceof Error ? cause.message : '关系列表加载失败')
      } finally {
        if (requestId === requestIdRef.current && !controller.signal.aborted) {
          setLoading(false)
          if (requestControllerRef.current === controller) requestControllerRef.current = null
        }
      }
    })()

    return () => {
      requestIdRef.current += 1
      if (requestControllerRef.current === controller) requestControllerRef.current = null
      controller.abort()
    }
  }, [beginRequest, direction, loadList, loadProfile])

  async function unfollow(targetUserId: string) {
    if (isFollowers || unfollowingId) return
    setUnfollowingId(targetUserId)
    setError('')
    try {
      const { response, data } = await fetchJson<FollowListResponse>(
        '/api/v1/social/follows/' + encodeURIComponent(targetUserId),
        {
          method: 'DELETE',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'social-unfollow:' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok && response.status !== 204) {
        throw new Error(getApiErrorMessage(data, '取消关注失败'))
      }
      setItems((current) => current.filter((item) => item.userId !== targetUserId))
      setTotalCount((count) => count === null ? count : Math.max(0, count - 1))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '取消关注失败')
    } finally {
      setUnfollowingId(null)
    }
  }

  async function loadMore() {
    if (!userId || loadingMore || !hasMore || !nextCursor) return
    const { controller, requestId } = beginRequest()
    setLoadingMore(true)
    setError('')
    try {
      await loadList(userId, nextCursor, true, controller.signal)
    } catch (cause) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return
      setError(cause instanceof Error ? cause.message : '更多关系加载失败')
    } finally {
      if (requestId === requestIdRef.current && !controller.signal.aborted) {
        setLoadingMore(false)
        if (requestControllerRef.current === controller) requestControllerRef.current = null
      }
    }
  }

  const title = isFollowers ? labels.followers : labels.following
  const owner = displayName || labels.account
  const description = owner + (isFollowers ? labels.followersOf : ' ' + labels.follows) +
    (totalCount === null ? '' : ' · ' + totalCount.toLocaleString(locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN') + ' ' + labels.relationships)

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={title} active={isFollowers ? 'connections' : 'following'}>
      <section aria-busy={loading || loadingMore} className="flex flex-col">
        <header className="border-b border-light-border px-4 py-4 dark:border-dark-border">
          <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{labels.social}</p>
          <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{description}</p>
        </header>

        {error ? <p className="border-b border-light-border px-4 py-3 text-sm text-red-600 dark:border-dark-border" role="alert">{error}</p> : null}
        {loading ? <p className="border-b border-light-border px-4 py-4 text-sm text-light-secondary dark:border-dark-border" role="status">{labels.loading}</p> : null}

        {!loading && items.length === 0 && !error ? (
          <section className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <strong className="text-lg">{isFollowers ? labels.emptyFollowers : labels.emptyFollowing}</strong>
            <p className="max-w-sm text-sm text-light-secondary dark:text-dark-secondary">{isFollowers ? labels.emptyFollowersHelp : labels.emptyFollowingHelp}</p>
            <Link className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white" href="/content">{labels.discover}</Link>
          </section>
        ) : null}

        {items.length > 0 ? (
          <section className="flex flex-col" aria-label={title}>
            {items.map((item) => (
              <TwitterCloneFollowRow
                key={item.relationshipId}
                userId={item.userId}
                followedAt={item.followedAt}
                presentation="x-timeline"
                action={!isFollowers ? (
                  <button
                    className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
                    disabled={unfollowingId === item.userId}
                    onClick={() => void unfollow(item.userId)}
                    type="button"
                  >
                    {unfollowingId === item.userId ? labels.processing : labels.unfollow}
                  </button>
                ) : undefined}
              />
            ))}

            {hasMore && nextCursor ? (
              <div className="flex justify-center px-4 py-5">
                <button
                  className="main-tab rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  type="button"
                >
                  {loadingMore ? labels.loadingMore : labels.more}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {!loading && !error ? (
          <div className="flex justify-center border-t border-light-border px-4 py-4 dark:border-dark-border">
            <button className="main-tab rounded-full px-4 py-2 text-sm font-bold text-light-secondary hover:bg-light-primary/10 dark:text-dark-secondary dark:hover:bg-dark-primary/10" onClick={() => void load()} type="button">{labels.refresh}</button>
          </div>
        ) : null}
      </section>
    </TwitterCloneSecondaryPageLayout>
  )
}
