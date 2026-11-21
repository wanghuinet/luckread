'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { fetchJson } from '../../../lib/client-api.js'

import styles from './creator-center.module.css'

type CountValue = number | null

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

type FollowListResponse = {
  data?: FollowListPage
}

type AudienceState = {
  followers: CountValue
  following: CountValue
  error: boolean
}

type Direction = 'followers' | 'following'

const initialState: AudienceState = {
  followers: null,
  following: null,
  error: false,
}

const PAGE_SIZE = 10

function redirectToLogin(loginPath: '/admin/login' | '/login') {
  const returnTo = window.location.pathname + window.location.search + window.location.hash
  window.location.assign(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
}

async function fetchCount(path: string, signal: AbortSignal, loginPath: '/admin/login' | '/login'): Promise<number> {
  const { response, data } = await fetchJson<{ data?: { totalCount?: number } }>(path, {
    headers: { accept: 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    signal,
  })
  if (response.status === 401) {
    redirectToLogin(loginPath)
    throw new Error('AUTH_REQUIRED')
  }
  if (!response.ok || typeof data?.data?.totalCount !== 'number') {
    throw new Error('AUDIENCE_LOAD_FAILED')
  }
  return Math.max(0, data.data.totalCount)
}

async function fetchList(
  userId: string,
  direction: Direction,
  cursor: string | null,
  signal: AbortSignal,
  loginPath: '/admin/login' | '/login',
): Promise<FollowListPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (cursor) params.set('cursor', cursor)

  const { response, data } = await fetchJson<FollowListResponse>(
    '/api/v1/users/' + encodeURIComponent(userId) + '/' + direction + '?' + params.toString(),
    {
      headers: { accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store',
      signal,
    },
  )
  if (response.status === 401) {
    redirectToLogin(loginPath)
    throw new Error('AUTH_REQUIRED')
  }
  if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
    throw new Error('AUDIENCE_LIST_LOAD_FAILED')
  }
  return data.data
}

export default function CreatorAudienceSummary({ userId, loginPath = '/admin/login' }: { userId: string; loginPath?: '/admin/login' | '/login' }) {
  const [state, setState] = useState<AudienceState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)
  const [direction, setDirection] = useState<Direction>('followers')
  const [items, setItems] = useState<FollowListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [listBusy, setListBusy] = useState(false)
  const [loadedListKey, setLoadedListKey] = useState<string | null>(null)
  const [listErrorKey, setListErrorKey] = useState<string | null>(null)
  const listRequestId = useRef(0)

  const listKey = userId + ':' + direction + ':' + reloadKey

  useEffect(() => {
    const controller = new AbortController()
    const requestId = ++listRequestId.current
    const otherDirection: Direction = direction === 'followers' ? 'following' : 'followers'

    void fetchList(userId, direction, null, controller.signal, loginPath)
      .then(async (page) => {
        if (requestId !== listRequestId.current || controller.signal.aborted) return

        setState((current) => ({
          ...current,
          [direction]: page.totalCount,
          error: false,
        }))
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
        setLoadedListKey(listKey)
        setListErrorKey(null)

        try {
          const otherCount = await fetchCount(
            '/api/v1/users/' + encodeURIComponent(userId) + '/' + otherDirection + '?limit=1',
            controller.signal,
            loginPath,
          )
          if (requestId !== listRequestId.current || controller.signal.aborted) return
          setState((current) => ({
            ...current,
            [otherDirection]: otherCount,
            error: false,
          }))
        } catch (error: unknown) {
          if (requestId !== listRequestId.current || controller.signal.aborted) return
          setState((current) => ({ ...current, error: true }))
          console.error('Creator audience secondary count failed', error)
        }
      })
      .catch((error: unknown) => {
        if (requestId !== listRequestId.current || controller.signal.aborted) return
        setListErrorKey(listKey)
        setState((current) => ({ ...current, error: true }))
        console.error('Creator audience list failed', error)
      })

    return () => controller.abort()
  }, [direction, loginPath, listKey, userId])

  async function loadMore() {
    if (listBusy || loadedListKey !== listKey || !hasMore || !nextCursor) return
    const controller = new AbortController()
    const requestId = ++listRequestId.current
    setListBusy(true)

    try {
      const page = await fetchList(userId, direction, nextCursor, controller.signal, loginPath)
      if (requestId !== listRequestId.current) return
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setListErrorKey(null)
    } catch (error) {
      if (requestId !== listRequestId.current || controller.signal.aborted) return
      setListErrorKey(listKey)
      console.error('Creator audience list pagination failed', error)
    } finally {
      if (requestId === listRequestId.current) setListBusy(false)
    }
  }

  const formatCount = (value: CountValue) => value === null ? '—' : value.toLocaleString('zh-CN')
  const formatFollowedAt = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
  }

  const activeCount = direction === 'followers' ? state.followers : state.following
  const currentListLoaded = loadedListKey === listKey
  const currentListError = listErrorKey === listKey
  const currentListLoading = !currentListLoaded && !currentListError

  return (
    <section className={styles.sectionBlock} id="audience">
      <div className={styles.sectionTitle}>
        <div>
          <span className={styles.eyebrow}>AUDIENCE</span>
          <h2>粉丝与关注</h2>
          <p>直接读取现有 Social/W05 关系数据，查看当前账号规模并分页浏览关系。</p>
        </div>
        <div className={styles.sectionActions}>
          <Link className={styles.secondaryButton + ' btn'} href="/me/followers">
            查看我的粉丝
          </Link>
          <Link className={styles.secondaryButton + ' btn'} href="/me/following">
            查看我的关注
          </Link>
          <button
            className={styles.secondaryButton + ' btn'}
            disabled={!state.error}
            onClick={() => setReloadKey((value) => value + 1)}
            type="button"
          >
            {state.error ? '重新加载' : '已同步'}
          </button>
        </div>
      </div>

      <div className={styles.futureGrid}>
        <article className={styles.futureCard}>
          <span className={styles.futureKicker}>
            <i className="fa-solid fa-users" aria-hidden="true" /> FOLLOWERS
          </span>
          <strong>{formatCount(state.followers)}</strong>
          <span>关注你的用户数量。</span>
        </article>
        <article className={styles.futureCard}>
          <span className={styles.futureKicker}>
            <i className="fa-solid fa-user-plus" aria-hidden="true" /> FOLLOWING
          </span>
          <strong>{formatCount(state.following)}</strong>
          <span>你主动关注的用户数量。</span>
        </article>
        <article className={styles.futureCard}>
          <span className={styles.futureKicker}>
            <i className="fa-solid fa-link" aria-hidden="true" /> SOURCE
          </span>
          <strong>W05 Social</strong>
          <span>{state.error ? '关系数据暂时无法同步。' : '不复制关系数据，由 Social 作为唯一关系事实来源。'}</span>
        </article>
      </div>

      <section className={styles.audiencePanel} aria-label="粉丝与关注列表">
        <div className={styles.audienceTabs} role="tablist" aria-label="关系类型">
          <button
            aria-selected={direction === 'followers'}
            className={direction === 'followers' ? styles.audienceTabActive : styles.audienceTab}
            onClick={() => setDirection('followers')}
            role="tab"
            type="button"
          >
            粉丝 <span>{formatCount(state.followers)}</span>
          </button>
          <button
            aria-selected={direction === 'following'}
            className={direction === 'following' ? styles.audienceTabActive : styles.audienceTab}
            onClick={() => setDirection('following')}
            role="tab"
            type="button"
          >
            关注 <span>{formatCount(state.following)}</span>
          </button>
        </div>

        <div className={styles.audienceList} aria-busy={currentListLoading || listBusy}>
          <div className={styles.audienceListHeader}>
            <strong>{direction === 'followers' ? '关注你的用户' : '你关注的用户'}</strong>
            <span>当前 {formatCount(activeCount)} 个关系</span>
          </div>

          {currentListError ? (
            <div className={styles.audienceState} role="alert">
              <span>列表暂时无法加载。</span>
              <button
                className={styles.secondaryButton + ' btn'}
                onClick={() => setReloadKey((value) => value + 1)}
                type="button"
              >
                重试
              </button>
            </div>
          ) : null}

          {!currentListError && currentListLoading ? (
            <p className={styles.audienceState} role="status">正在加载关系列表…</p>
          ) : null}

          {!currentListError && currentListLoaded && items.length === 0 ? (
            <p className={styles.audienceState} role="status">
              {direction === 'followers' ? '还没有粉丝。' : '还没有关注用户。'}
            </p>
          ) : null}

          {items.length > 0 ? (
            <div className={styles.audienceRows}>
              {items.map((item) => (
                <div className={styles.audienceRow} key={item.relationshipId}>
                  <div className={styles.audienceIdentity}>
                    <span className={styles.audienceAvatar}>
                      <i className="fa-solid fa-user" aria-hidden="true" />
                    </span>
                    <div>
                      <Link href={'/users/' + encodeURIComponent(item.userId)}>
                        {item.userId}
                      </Link>
                      <span>用户 ID · 查看主页</span>
                    </div>
                  </div>
                  <time dateTime={item.followedAt}>关系建立于 {formatFollowedAt(item.followedAt)}</time>
                </div>
              ))}
            </div>
          ) : null}

          {currentListLoaded && hasMore && nextCursor ? (
            <div className={styles.audienceActions}>
              <button
                className={styles.secondaryButton + ' btn'}
                disabled={listBusy}
                onClick={() => void loadMore()}
                type="button"
              >
                {listBusy ? '加载中…' : '加载更多'}
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  )
}
