'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import TwitterCloneFollowRow from '../TwitterCloneFollowRow'
import { usePublicLocale } from '../../i18n/PublicLanguageToggle'
import TwitterCloneSecondaryPageLayout from '../../../(twitter-clone)/TwitterCloneSecondaryPageLayout'

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

export default function UserFollowList({
  userId,
  direction,
}: {
  userId: string
  direction: Direction
}) {
  const isFollowers = direction === 'followers'
  const locale = usePublicLocale()
  const labels = locale === 'en'
    ? {
        followers: 'Followers',
        following: 'Following',
        backProfile: 'Back to profile',
        followersSuffix: "'s followers",
        followingSuffix: ' follows',
        people: 'people',
        navigation: 'Profile relationships',
        loading: 'Loading relationships…',
        retry: 'Try again',
        emptyFollowers: 'This creator has no followers yet.',
        emptyFollowing: 'This creator is not following anyone yet.',
        loadMore: 'Load more',
        loadingMore: 'Loading…',
      }
    : locale === 'tw'
      ? {
          followers: '粉絲',
          following: '追蹤中',
          backProfile: '返回個人主頁',
          followersSuffix: '的粉絲',
          followingSuffix: '追蹤的用戶',
          people: '人',
          navigation: '個人關係導覽',
          loading: '正在載入關係列表…',
          retry: '重新載入',
          emptyFollowers: '這位創作者目前還沒有粉絲。',
          emptyFollowing: '這位創作者目前還沒有追蹤其他用戶。',
          loadMore: '載入更多',
          loadingMore: '載入中…',
        }
      : {
          followers: '粉丝',
          following: '关注',
          backProfile: '返回作者主页',
          followersSuffix: '的粉丝',
          followingSuffix: '关注的用户',
          people: '人',
          navigation: '作者关系导航',
          loading: '正在加载关系列表…',
          retry: '重新加载',
          emptyFollowers: '这位创作者还没有粉丝。',
          emptyFollowing: '这位创作者还没有关注其他用户。',
          loadMore: '加载更多',
          loadingMore: '加载中…',
        }
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

  const pageTitle = isFollowers ? labels.followers : labels.following
  const relationshipSummary = displayName + (isFollowers ? labels.followersSuffix : labels.followingSuffix)
  const localizedCount = totalCount === null
    ? ''
    : ' · ' + totalCount.toLocaleString(locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN') + ' ' + labels.people

  return (
    <TwitterCloneSecondaryPageLayout
      locale={locale}
      title={pageTitle}
      active={isFollowers ? 'connections' : 'following'}
    >
      <div className="flex flex-col" aria-busy={loading || loadingMore}>
        <div className="border-b border-light-border px-4 py-3 dark:border-dark-border">
          <Link
            className="main-tab inline-flex items-center rounded-full px-3 py-2 text-sm font-bold hover:bg-light-primary/10 dark:hover:bg-dark-primary/10"
            href={'/users/' + encodeURIComponent(userId)}
          >
            <span aria-hidden="true">←</span>
            <span className="ml-2">{labels.backProfile}</span>
          </Link>
        </div>

        <section className="border-b border-light-border px-4 py-4 dark:border-dark-border">
          <div className="flex items-center gap-3">
            {profile?.avatar ? (
              <img alt={displayName} className="h-12 w-12 shrink-0 rounded-full object-cover" height={48} loading="eager" src={profile.avatar} width={48} />
            ) : (
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-main-sidebar-background text-lg font-bold" aria-hidden="true">
                {initial}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold">{displayName}</h2>
              <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">
                {relationshipSummary}{localizedCount}
              </p>
            </div>
          </div>
        </section>

        <nav aria-label={labels.navigation} className="grid grid-cols-2 border-b border-light-border dark:border-dark-border">
          <Link
            className={isFollowers
              ? 'main-tab relative flex min-h-14 items-center justify-center font-bold hover:bg-white/5'
              : 'main-tab flex min-h-14 items-center justify-center text-light-secondary hover:bg-white/5 dark:text-dark-secondary'}
            href={'/users/' + encodeURIComponent(userId) + '/followers'}
            aria-current={isFollowers ? 'page' : undefined}
          >
            {labels.followers}
            {isFollowers ? <span className="absolute bottom-0 h-1 w-14 rounded-full bg-main-accent" /> : null}
          </Link>
          <Link
            className={!isFollowers
              ? 'main-tab relative flex min-h-14 items-center justify-center font-bold hover:bg-white/5'
              : 'main-tab flex min-h-14 items-center justify-center text-light-secondary hover:bg-white/5 dark:text-dark-secondary'}
            href={'/users/' + encodeURIComponent(userId) + '/following'}
            aria-current={!isFollowers ? 'page' : undefined}
          >
            {labels.following}
            {!isFollowers ? <span className="absolute bottom-0 h-1 w-14 rounded-full bg-main-accent" /> : null}
          </Link>
        </nav>

        {error ? (
          <section className="border-b border-light-border px-4 py-4 dark:border-dark-border">
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
            <button
              className="main-tab mt-3 rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10"
              onClick={() => void load()}
              type="button"
            >
              {labels.retry}
            </button>
          </section>
        ) : null}

        {!error && loading ? (
          <section className="border-b border-light-border px-4 py-6 dark:border-dark-border">
            <p className="text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.loading}</p>
          </section>
        ) : null}

        {!error && !loading && items.length === 0 ? (
          <section className="border-b border-light-border px-4 py-6 dark:border-dark-border">
            <p className="text-sm text-light-secondary dark:text-dark-secondary">
              {isFollowers ? labels.emptyFollowers : labels.emptyFollowing}
            </p>
          </section>
        ) : null}

        {!error && items.length > 0 ? (
          <section aria-label={pageTitle} className="flex flex-col">
            {items.map((item) => (
              <TwitterCloneFollowRow
                key={item.relationshipId}
                userId={item.userId}
                followedAt={item.followedAt}
                presentation="x-timeline"
                locale={locale}
              />
            ))}

            {hasMore && nextCursor ? (
              <div className="flex justify-center border-b border-light-border px-4 py-5 dark:border-dark-border">
                <button
                  className="main-tab rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
                  disabled={loadingMore}
                  onClick={() => void load(nextCursor)}
                  type="button"
                >
                  {loadingMore ? labels.loadingMore : labels.loadMore}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </TwitterCloneSecondaryPageLayout>
  )
}
