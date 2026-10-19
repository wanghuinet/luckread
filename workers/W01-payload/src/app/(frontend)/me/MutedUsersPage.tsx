'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import { usePublicLocale } from '../i18n/PublicLanguageToggle'
import TwitterCloneFollowRow from '../users/TwitterCloneFollowRow'
import TwitterCloneSecondaryPageLayout from '../../(twitter-clone)/TwitterCloneSecondaryPageLayout'

type MutedUserItem = {
  relationshipId: string
  targetUserId: string
  createdAt: string
}

type MutedUserPage = {
  items: MutedUserItem[]
  nextCursor: string | null
  hasMore: boolean
}

type MutedUserResponse = {
  data?: MutedUserPage
  error?: { message?: string }
}

const PAGE_SIZE = 20

export default function MutedUsersPage() {
  const locale = usePublicLocale()
  const labels = locale === 'en' ? {
    title: 'Muted accounts',
    eyebrow: 'PRIVACY AND SAFETY',
    description: 'Accounts you have muted. You can unmute an account here at any time.',
    mutedSince: 'Blocked since',
    loading: 'Loading muted accounts…',
    loadingMore: 'Loading…',
    more: 'Load more',
    empty: 'You have not muted any accounts.',
    emptyHelp: 'When you mute an account from its profile, it will appear here.',
    error: 'Muted accounts could not be loaded. Please try again.',
    unmute: 'Unmute',
    unmuting: 'Unmuting…',
    unmuteError: 'Could not unmute this account. Please try again.',
    loginMessage: 'Sign in to manage muted accounts.',
    login: 'Sign in',
    discover: 'Explore LuckRead',
    safety: 'Privacy and safety',
  } : locale === 'tw' ? {
    title: '已靜音的帳號',
    eyebrow: '隱私與安全',
    description: '你靜音的帳號會顯示在這裡，也可以隨時取消靜音。',
    mutedSince: '靜音時間',
    loading: '正在載入靜音帳號…',
    loadingMore: '載入中…',
    more: '載入更多',
    empty: '你目前沒有靜音任何帳號。',
    emptyHelp: '從帳號個人主頁靜音後，該帳號會出現在這裡。',
    error: '無法載入靜音帳號，請重試。',
    unmute: '取消靜音',
    unmuting: '正在取消静音…',
    unmuteError: '取消靜音失敗，請重試。',
    loginMessage: '登入後即可管理靜音帳號。',
    login: '登入',
    discover: '探索 LuckRead',
    safety: '隱私與安全',
  } : {
    title: '已静音的账号',
    eyebrow: '隐私与安全',
    description: '这里列出你已静音的账号，你也可以随时取消静音。',
    mutedSince: '静音时间',
    loading: '正在加载已静音账号…',
    loadingMore: '加载中…',
    more: '加载更多',
    empty: '你目前没有静音任何账号。',
    emptyHelp: '在其他账号的个人主页静音用户后，对方会显示在这里。',
    error: '静音账号列表加载失败，请重试。',
    unmute: '取消静音',
    unmuting: '正在取消静音…',
    unmuteError: '取消静音失败，请重试。',
    loginMessage: '登录后即可管理已静音账号。',
    login: '登录',
    discover: '去发现内容',
    safety: '隐私与安全',
  }

  const [page, setPage] = useState<MutedUserPage>({ items: [], nextCursor: null, hasMore: false })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unmutingIds, setUnmutingIds] = useState<Set<string>>(() => new Set())
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
      const { response, data } = await fetchJson<MutedUserResponse>(
        '/api/v1/interactions/mutes?' + params.toString(),
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
    const timer = window.setTimeout(() => {
      void load(null)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      requestIdRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [load])

  const unmute = async (targetUserId: string) => {
    if (unmutingIds.has(targetUserId)) return
    setUnmutingIds((current) => new Set(current).add(targetUserId))
    setError('')
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>(
        '/api/v1/interactions/mutes/' + encodeURIComponent(targetUserId),
        {
          method: 'DELETE',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'social-mute-remove:' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok && response.status !== 204) {
        throw new Error(getApiErrorMessage(data, labels.unmuteError))
      }
      setPage((current) => ({
        ...current,
        items: current.items.filter((item) => item.targetUserId !== targetUserId),
      }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.unmuteError)
    } finally {
      setUnmutingIds((current) => {
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
              <Link className="rounded-full bg-main-accent px-5 py-2 font-bold text-white" href={'/login?returnTo=' + encodeURIComponent('/me/muted')}>{labels.login}</Link>
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
                dateLabel={labels.mutedSince}
                presentation="x-timeline"
                locale={locale}
                action={(
                  <button
                    className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
                    disabled={unmutingIds.has(item.targetUserId)}
                    onClick={() => void unmute(item.targetUserId)}
                    type="button"
                  >
                    {unmutingIds.has(item.targetUserId) ? labels.unmuting : labels.unmute}
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
