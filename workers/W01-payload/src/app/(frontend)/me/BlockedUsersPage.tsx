'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import { usePublicLocale } from '../i18n/PublicLanguageToggle'
import TwitterCloneFollowRow from '../users/TwitterCloneFollowRow'
import TwitterCloneSecondaryPageLayout from '../../(twitter-clone)/TwitterCloneSecondaryPageLayout'

type BlockedUserItem = {
  relationshipId: string
  targetUserId: string
  createdAt: string
}

type BlockedUserPage = {
  items: BlockedUserItem[]
  nextCursor: string | null
  hasMore: boolean
}

type BlockedUserResponse = {
  data?: BlockedUserPage
  error?: { message?: string }
}

const PAGE_SIZE = 20

export default function BlockedUsersPage() {
  const locale = usePublicLocale()
  const labels = locale === 'en' ? {
    title: 'Blocked accounts',
    eyebrow: 'PRIVACY AND SAFETY',
    description: 'Accounts you have blocked. You can unblock an account here at any time.',
    blockedSince: 'Blocked since',
    loading: 'Loading blocked accounts…',
    loadingMore: 'Loading…',
    more: 'Load more',
    empty: 'You have not blocked any accounts.',
    emptyHelp: 'When you block an account from its profile, it will appear here.',
    error: 'Blocked accounts could not be loaded. Please try again.',
    unblock: 'Unblock',
    unblocking: 'Unblocking…',
    unblockError: 'Could not unblock this account. Please try again.',
    loginMessage: 'Sign in to manage blocked accounts.',
    login: 'Sign in',
    discover: 'Explore LuckRead',
    safety: 'Privacy and safety',
  } : locale === 'tw' ? {
    title: '已封鎖的帳號',
    eyebrow: '隱私與安全',
    description: '你封鎖的帳號會顯示在這裡，也可以隨時解除封鎖。',
    blockedSince: '封鎖時間',
    loading: '正在載入封鎖帳號…',
    loadingMore: '載入中…',
    more: '載入更多',
    empty: '你目前沒有封鎖任何帳號。',
    emptyHelp: '從帳號個人主頁封鎖後，該帳號會出現在這裡。',
    error: '無法載入封鎖帳號，請重試。',
    unblock: '解除封鎖',
    unblocking: '正在解除…',
    unblockError: '解除封鎖失敗，請重試。',
    loginMessage: '登入後即可管理封鎖帳號。',
    login: '登入',
    discover: '探索 LuckRead',
    safety: '隱私與安全',
  } : {
    title: '已屏蔽的账号',
    eyebrow: '隐私与安全',
    description: '这里列出你已屏蔽的账号，你也可以随时解除屏蔽。',
    blockedSince: '屏蔽时间',
    loading: '正在加载已屏蔽账号…',
    loadingMore: '加载中…',
    more: '加载更多',
    empty: '你目前没有屏蔽任何账号。',
    emptyHelp: '在其他账号的个人主页屏蔽用户后，对方会显示在这里。',
    error: '屏蔽账号列表加载失败，请重试。',
    unblock: '解除屏蔽',
    unblocking: '正在解除…',
    unblockError: '解除屏蔽失败，请重试。',
    loginMessage: '登录后即可管理已屏蔽账号。',
    login: '登录',
    discover: '去发现内容',
    safety: '隐私与安全',
  }

  const [page, setPage] = useState<BlockedUserPage>({ items: [], nextCursor: null, hasMore: false })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unblockingIds, setUnblockingIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')
  const [authRequired, setAuthRequired] = useState(false)
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async (cursor: string | null) => {
    const requestId = ++requestIdRef.current
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError('')
    setAuthRequired(false)

    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (cursor) params.set('cursor', cursor)
      const { response, data } = await fetchJson<BlockedUserResponse>(
        '/api/v1/interactions/blocks?' + params.toString(),
        {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        },
      )

      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (response.status === 401) {
        setAuthRequired(true)
        setError(labels.loginMessage)
        setPage({ items: [], nextCursor: null, hasMore: false })
        return
      }
      if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
        throw new Error(getApiErrorMessage(data, labels.error))
      }

      const incoming = data.data
      setPage((current) => {
        if (!cursor) return incoming
        const known = new Set(current.items.map((item) => item.relationshipId))
        return {
          items: [...current.items, ...incoming.items.filter((item) => !known.has(item.relationshipId))],
          nextCursor: incoming.nextCursor ?? null,
          hasMore: incoming.hasMore === true,
        }
      })
    } catch (cause) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : labels.error)
    } finally {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      setLoading(false)
      setLoadingMore(false)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    }
  }, [labels.error, labels.loginMessage])

  useEffect(() => {
    void load(null)
    return () => {
      requestIdRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [load])

  const unblock = async (targetUserId: string) => {
    if (unblockingIds.has(targetUserId)) return
    setUnblockingIds((current) => new Set(current).add(targetUserId))
    setError('')
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>(
        '/api/v1/interactions/blocks/' + encodeURIComponent(targetUserId),
        {
          method: 'DELETE',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'social-block-remove:' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok && response.status !== 204) {
        throw new Error(getApiErrorMessage(data, labels.unblockError))
      }
      setPage((current) => ({
        ...current,
        items: current.items.filter((item) => item.targetUserId !== targetUserId),
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.unblockError)
    } finally {
      setUnblockingIds((current) => {
        const next = new Set(current)
        next.delete(targetUserId)
        return next
      })
    }
  }

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={labels.title} active="none">
      <section aria-busy={loading || loadingMore} className="flex flex-col">
        <header className="border-b border-light-border px-4 py-4 dark:border-dark-border">
          <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{labels.eyebrow}</p>
          <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.description}</p>
        </header>

        {loading ? <p className="border-b border-light-border px-4 py-4 text-sm text-light-secondary dark:border-dark-border" role="status">{labels.loading}</p> : null}

        {!loading && error ? (
          <div className="flex flex-col items-center gap-3 border-b border-light-border px-6 py-10 text-center text-sm dark:border-dark-border" role="alert">
            <p>{error}</p>
            {authRequired ? (
              <Link className="rounded-full bg-main-accent px-5 py-2 font-bold text-white" href={'/login?returnTo=' + encodeURIComponent('/me/blocked')}>{labels.login}</Link>
            ) : (
              <button className="main-tab rounded-full border border-light-border px-4 py-2 font-bold dark:border-dark-border" onClick={() => void load(null)} type="button">
                {locale === 'en' ? 'Try again' : locale === 'tw' ? '重新載入' : '重新加载'}
              </button>
            )}
          </div>
        ) : null}

        {!loading && !error && page.items.length === 0 ? (
          <section className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <strong className="text-lg">{labels.empty}</strong>
            <p className="max-w-sm text-sm text-light-secondary dark:text-dark-secondary">{labels.emptyHelp}</p>
            <Link className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white" href="/content">{labels.discover}</Link>
          </section>
        ) : null}

        {page.items.length > 0 ? (
          <section aria-label={labels.title} className="flex flex-col">
            {page.items.map((item) => (
              <TwitterCloneFollowRow
                key={item.relationshipId}
                userId={item.targetUserId}
                followedAt={item.createdAt}
                dateLabel={labels.blockedSince}
                presentation="x-timeline"
                locale={locale}
                action={(
                  <button
                    className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
                    disabled={unblockingIds.has(item.targetUserId)}
                    onClick={() => void unblock(item.targetUserId)}
                    type="button"
                  >
                    {unblockingIds.has(item.targetUserId) ? labels.unblocking : labels.unblock}
                  </button>
                )}
              />
            ))}

            {page.hasMore && page.nextCursor ? (
              <div className="flex justify-center px-4 py-5">
                <button
                  className="main-tab rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
                  disabled={loadingMore}
                  onClick={() => void load(page.nextCursor)}
                  type="button"
                >
                  {loadingMore ? labels.loadingMore : labels.more}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </TwitterCloneSecondaryPageLayout>
  )
}
