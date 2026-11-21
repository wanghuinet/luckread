'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { usePublicLocale } from '../../../(frontend)/i18n/PublicLanguageToggle'
import type { PublicLocale } from '../../../(frontend)/i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../../TwitterCloneSecondaryPageLayout'

type SessionItem = {
  sessionId: string
  deviceId?: string
  createdAt: string
  expiresAt: string
  lastSeenAt: string | null
}

type SessionResponse = {
  items: SessionItem[]
  nextCursor: string | null
  currentSessionId: string
}

const copy = (locale: PublicLocale) => locale === 'en'
  ? {
      title: 'Devices & sessions',
      eyebrow: 'ACCOUNT SECURITY',
      description: 'Review active sign-in sessions and sign out devices you no longer use.',
      loading: 'Loading sessions…',
      empty: 'There are no sign-in sessions to display.',
      current: 'Current device',
      signedIn: 'Signed-in device',
      deviceId: 'Device identifier not provided',
      inUse: 'In use',
      signOut: 'Sign out device',
      signingOut: 'Signing out…',
      loginTime: 'Signed in',
      lastSeen: 'Last active',
      expires: 'Expires',
      more: 'Load more',
      loadingMore: 'Loading…',
      back: 'Back to profile',
      loadError: 'Could not load sign-in sessions.',
      moreError: 'Could not load more sessions.',
      revokeError: 'Could not sign out this device.',
    }
  : locale === 'tw'
    ? {
        title: '登入裝置',
        eyebrow: '帳戶安全',
        description: '查看目前有效的登入工作階段，並登出不再使用的裝置。',
        loading: '正在載入登入工作階段…',
        empty: '目前沒有可顯示的登入裝置。',
        current: '目前裝置',
        signedIn: '已登入裝置',
        deviceId: '未提供裝置識別碼',
        inUse: '正在使用',
        signOut: '登出裝置',
        signingOut: '登出中…',
        loginTime: '登入時間',
        lastSeen: '最近活動',
        expires: '到期時間',
        more: '載入更多',
        loadingMore: '載入中…',
        back: '返回個人資料',
        loadError: '無法載入登入工作階段。',
        moreError: '無法載入更多工作階段。',
        revokeError: '無法登出此裝置。',
      }
    : {
        title: '登录设备',
        eyebrow: '账户安全',
        description: '查看当前账号的有效登录会话，并退出不再使用的设备。',
        loading: '正在加载登录设备…',
        empty: '当前没有可显示的登录设备。',
        current: '当前设备',
        signedIn: '已登录设备',
        deviceId: '未提供设备标识',
        inUse: '正在使用',
        signOut: '退出设备',
        signingOut: '退出中…',
        loginTime: '登录时间',
        lastSeen: '最近访问',
        expires: '过期时间',
        more: '加载更多',
        loadingMore: '加载中…',
        back: '返回个人资料',
        loadError: '会话列表加载失败。',
        moreError: '更多会话加载失败。',
        revokeError: '退出该设备失败。',
      }

function formatDate(value: string, locale: PublicLocale): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  return date.toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function SessionsPage() {
  const router = useRouter()
  const locale = usePublicLocale()
  const labels = copy(locale)
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [currentSessionId, setCurrentSessionId] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [revokingId, setRevokingId] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (cursor?: string): Promise<SessionResponse | null> => {
    const params = new URLSearchParams({ limit: '20' })
    if (cursor) params.set('cursor', cursor)

    const { response, data } = await fetchJson<SessionResponse | { error?: { message?: string } }>('/api/v1/auth/sessions?' + params.toString(), {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })

    if (response.status === 401) {
      const returnTo = window.location.pathname + window.location.search + window.location.hash
      router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
      return null
    }

    if (!response.ok || !data || !('currentSessionId' in data) || !Array.isArray(data.items)) {
      throw new Error(getApiErrorMessage(data, cursor ? labels.moreError : labels.loadError))
    }

    return data
  }, [labels.loadError, labels.moreError, router])

  useEffect(() => {
    let cancelled = false

    void load()
      .then((data) => {
        if (!data || cancelled) return
        setSessions(data.items)
        setCurrentSessionId(data.currentSessionId)
        setNextCursor(data.nextCursor)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : labels.loadError)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [labels.loadError, load])

  async function loadMore() {
    if (loadingMore || !nextCursor) return
    setLoadingMore(true)
    setError('')

    try {
      const data = await load(nextCursor)
      if (!data) return
      setSessions((current) => {
        const known = new Set(current.map((session) => session.sessionId))
        return [...current, ...data.items.filter((session) => !known.has(session.sessionId))]
      })
      setNextCursor(data.nextCursor)
      setCurrentSessionId(data.currentSessionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.moreError)
    } finally {
      setLoadingMore(false)
    }
  }

  async function revoke(sessionId: string) {
    if (sessionId === currentSessionId || revokingId) return

    setRevokingId(sessionId)
    setError('')

    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>('/api/v1/auth/sessions/' + encodeURIComponent(sessionId), {
        method: 'DELETE',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'session-revoke-' + crypto.randomUUID(),
        },
      })

      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, labels.revokeError))
      }

      setSessions((current) => current.filter((item) => item.sessionId !== sessionId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.revokeError)
    } finally {
      setRevokingId('')
    }
  }

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={labels.title} active="editProfile">
      <section className="border-b border-light-border px-4 py-4 dark:border-dark-border">
        <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{labels.eyebrow}</p>
        <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.description}</p>
        <p className="mt-3 text-sm">
          <Link className="main-tab rounded-md py-1" href="/me/profile">{labels.back}</Link>
        </p>
      </section>

      {loading ? <p className="border-b border-light-border px-4 py-4 text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary" role="status">{labels.loading}</p> : null}
      {error ? <p className="border-b border-light-border px-4 py-4 text-sm text-red-500" role="alert">{error}</p> : null}

      {!loading && sessions.length === 0 && !error ? (
        <p className="px-4 py-8 text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.empty}</p>
      ) : null}

      {!loading && sessions.length > 0 ? (
        <section aria-label={labels.title} aria-busy={loadingMore} className="flex flex-col">
          {sessions.map((session) => {
            const isCurrent = session.sessionId === currentSessionId
            return (
              <article key={session.sessionId} className="border-b border-light-border px-4 py-4 dark:border-dark-border">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="text-sm font-bold">{isCurrent ? labels.current : labels.signedIn}</strong>
                    <p className="mt-1 break-all text-xs text-light-secondary dark:text-dark-secondary">
                      {session.deviceId || labels.deviceId}
                    </p>
                  </div>
                  {isCurrent ? (
                    <span className="shrink-0 rounded-full bg-main-accent/10 px-3 py-1 text-xs font-bold text-main-accent">{labels.inUse}</span>
                  ) : (
                    <button
                      className="shrink-0 rounded-full border border-light-border px-3 py-1.5 text-xs font-bold transition hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
                      disabled={revokingId === session.sessionId}
                      onClick={() => void revoke(session.sessionId)}
                      type="button"
                    >
                      {revokingId === session.sessionId ? labels.signingOut : labels.signOut}
                    </button>
                  )}
                </div>
                <dl className="mt-4 grid grid-cols-1 gap-3 text-xs xs:grid-cols-3">
                  <div>
                    <dt className="text-light-secondary dark:text-dark-secondary">{labels.loginTime}</dt>
                    <dd className="mt-1 break-words">{formatDate(session.createdAt, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-light-secondary dark:text-dark-secondary">{labels.lastSeen}</dt>
                    <dd className="mt-1 break-words">{session.lastSeenAt ? formatDate(session.lastSeenAt, locale) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-light-secondary dark:text-dark-secondary">{labels.expires}</dt>
                    <dd className="mt-1 break-words">{formatDate(session.expiresAt, locale)}</dd>
                  </div>
                </dl>
              </article>
            )
          })}

          {nextCursor ? (
            <div className="flex justify-center border-b border-light-border px-4 py-4 dark:border-dark-border">
              <button
                className="rounded-full border border-light-border px-5 py-2 text-sm font-bold transition hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
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
    </TwitterCloneSecondaryPageLayout>
  )
}
