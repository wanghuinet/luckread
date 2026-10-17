'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import { usePublicLocale } from '../../(frontend)/i18n/PublicLanguageToggle'
import type { PublicLocale } from '../../(frontend)/i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../TwitterCloneSecondaryPageLayout'

type NotificationType = 'FOLLOW' | 'LIKE' | 'COMMENT' | 'REPLY' | 'MENTION'

type SocialNotification = {
  id: string
  type: NotificationType
  actorUserId: string
  targetType: 'user' | 'content' | 'comment'
  targetId: string
  payload?: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

type NotificationPage = {
  items: SocialNotification[]
  unreadCount: number
  nextCursor: string | null
  hasMore: boolean
}

type NotificationResponse = {
  data?: NotificationPage
  error?: { code?: string; message?: string } | null
}

const copy = (locale: PublicLocale) => ({
  title: locale === 'en' ? 'Notifications' : '通知',
  allCaughtUp: locale === 'en' ? "You're all caught up" : locale === 'tw' ? '目前沒有新通知' : '暂时没有新通知',
  empty: locale === 'en' ? 'When someone follows, likes, replies to, or mentions you, it will show up here.' : locale === 'tw' ? '有人追蹤、按讚、回覆或提及你時，通知會顯示在這裡。' : '当有人关注、点赞、回复或提及你时，通知会显示在这里。',
  readAll: locale === 'en' ? 'Mark all as read' : locale === 'tw' ? '全部標記為已讀' : '全部标记为已读',
  markRead: locale === 'en' ? 'Mark as read' : locale === 'tw' ? '標記為已讀' : '标记为已读',
  loading: locale === 'en' ? 'Loading notifications…' : locale === 'tw' ? '正在載入通知…' : '正在加载通知…',
  loadError: locale === 'en' ? 'Unable to load notifications.' : locale === 'tw' ? '無法載入通知。' : '无法加载通知。',
  retry: locale === 'en' ? 'Retry' : locale === 'tw' ? '重試' : '重试',
  loadMore: locale === 'en' ? 'Load more' : locale === 'tw' ? '載入更多' : '加载更多',
  loadingMore: locale === 'en' ? 'Loading…' : locale === 'tw' ? '載入中…' : '加载中…',
  user: locale === 'en' ? 'Someone' : locale === 'tw' ? '有人' : '有人',
  follow: locale === 'en' ? 'started following you' : locale === 'tw' ? '開始追蹤你' : '关注了你',
  like: locale === 'en' ? 'liked your content' : locale === 'tw' ? '對你的內容按讚' : '赞了你的内容',
  comment: locale === 'en' ? 'commented on your content' : locale === 'tw' ? '評論了你的內容' : '评论了你的内容',
  reply: locale === 'en' ? 'replied to a comment' : locale === 'tw' ? '回覆了評論' : '回复了评论',
  mention: locale === 'en' ? 'mentioned you' : locale === 'tw' ? '提及了你' : '提到了你',
  view: locale === 'en' ? 'View' : locale === 'tw' ? '查看' : '查看',
  unread: locale === 'en' ? 'unread' : locale === 'tw' ? '未讀' : '未读',
  unreadLabel: locale === 'en' ? 'Unread notifications' : locale === 'tw' ? '未讀通知' : '未读通知',
  pageError: locale === 'en' ? 'Something went wrong. Please try again.' : locale === 'tw' ? '發生錯誤，請重試。' : '发生错误，请重试。',
  readError: locale === 'en' ? 'Could not update notification status.' : locale === 'tw' ? '無法更新通知狀態。' : '无法更新通知状态。',
  backHome: locale === 'en' ? 'Back to home' : locale === 'tw' ? '返回首頁' : '返回首页',
})

const dateLocale = (locale: PublicLocale) => locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'

function notificationMessage(item: SocialNotification, labels: ReturnType<typeof copy>) {
  const typeText: Record<NotificationType, string> = {
    FOLLOW: labels.follow,
    LIKE: labels.like,
    COMMENT: labels.comment,
    REPLY: labels.reply,
    MENTION: labels.mention,
  }
  const handle = typeof item.payload?.handle === 'string' && item.payload.handle.trim()
    ? '@' + item.payload.handle.replace(/^@/, '')
    : labels.user
  const href = item.targetType === 'content'
    ? '/content/' + encodeURIComponent(item.targetId)
    : item.type === 'FOLLOW'
      ? '/users/' + encodeURIComponent(item.actorUserId)
      : null
  return { text: typeText[item.type] ?? labels.user, actor: handle, href }
}

function formatDate(value: string, locale: PublicLocale) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toLocaleString(dateLocale(locale), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function NotificationsPage() {
  const locale = usePublicLocale()
  const labels = useMemo(() => copy(locale), [locale])
  const [items, setItems] = useState<SocialNotification[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [authRequired, setAuthRequired] = useState(false)
  const [readAllBusy, setReadAllBusy] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())

  const loadPage = useCallback(async (cursor: string | null, append: boolean) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (cursor) params.set('cursor', cursor)
      const { response, data } = await fetchJson<NotificationResponse>('/api/v1/notifications?' + params.toString(), {
        credentials: 'include',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (response.status === 401 || data?.error?.code === 'UNAUTHENTICATED') {
        setAuthRequired(true)
        setItems([])
        setUnreadCount(0)
        setNextCursor(null)
        setHasMore(false)
        return
      }
      if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
        throw new Error(getApiErrorMessage(data, labels.loadError))
      }
      setAuthRequired(false)
      setItems((current) => {
        if (!append) return data.data!.items
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...data.data!.items.filter((item) => !seen.has(item.id))]
      })
      setUnreadCount(Math.max(0, Number(data.data.unreadCount) || 0))
      setNextCursor(data.data.nextCursor ?? null)
      setHasMore(data.data.hasMore === true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.loadError)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [labels.loadError])

  useEffect(() => {
    void loadPage(null, false)
  }, [loadPage])

  const signInHref = '/login?returnTo=' + encodeURIComponent('/notifications')

  async function markRead(item: SocialNotification) {
    if (item.readAt || busyIds.has(item.id)) return
    setBusyIds((current) => new Set(current).add(item.id))
    setError('')
    try {
      const { response, data } = await fetchJson<{ error?: { code?: string; message?: string } }>(
        '/api/v1/notifications/' + encodeURIComponent(item.id) + '/read',
        { method: 'POST', credentials: 'include', headers: { accept: 'application/json' } },
      )
      if (response.status === 401) {
        window.location.assign(signInHref)
        return
      }
      if (!response.ok) throw new Error(getApiErrorMessage(data, labels.readError))
      const readAt = new Date().toISOString()
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt } : entry))
      setUnreadCount((count) => Math.max(0, count - 1))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.readError)
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  async function markAllRead() {
    if (unreadCount <= 0 || readAllBusy) return
    setReadAllBusy(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ error?: { code?: string; message?: string } }>(
        '/api/v1/notifications/read-all',
        { method: 'POST', credentials: 'include', headers: { accept: 'application/json' } },
      )
      if (response.status === 401) {
        window.location.assign(signInHref)
        return
      }
      if (!response.ok) throw new Error(getApiErrorMessage(data, labels.readError))
      const readAt = new Date().toISOString()
      setItems((current) => current.map((item) => item.readAt ? item : { ...item, readAt }))
      setUnreadCount(0)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.readError)
    } finally {
      setReadAllBusy(false)
    }
  }

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={labels.title} active="notifications">
      <section aria-busy={loading || loadingMore} aria-label={labels.title}>
        <div className="flex items-center justify-between border-b border-light-border px-4 py-3 dark:border-dark-border">
          <div>
            <p className="text-sm text-light-secondary dark:text-dark-secondary">{labels.unreadLabel}</p>
            <p className="text-2xl font-bold tabular-nums">{unreadCount}</p>
          </div>
          <button className="rounded-full px-4 py-2 text-sm font-bold text-main-accent hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-primary/10" disabled={unreadCount === 0 || readAllBusy || authRequired} onClick={() => void markAllRead()} type="button">
            {readAllBusy ? labels.loadingMore : labels.readAll}
          </button>
        </div>

        {authRequired ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <h2 className="text-xl font-bold">{locale === 'en' ? 'Sign in to see your notifications' : locale === 'tw' ? '登入以查看通知' : '登录后查看通知'}</h2>
            <Link className="rounded-full bg-main-accent px-5 py-2 font-bold text-white" href={signInHref}>{locale === 'en' ? 'Sign in' : locale === 'tw' ? '登入' : '登录'}</Link>
          </div>
        ) : null}

        {loading && items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.loading}</p> : null}

        {!loading && !authRequired && !error && items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-main-sidebar-background text-main-accent"><svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg></div>
            <h2 className="text-xl font-bold">{labels.allCaughtUp}</h2>
            <p className="max-w-sm text-sm text-light-secondary dark:text-dark-secondary">{labels.empty}</p>
            <Link className="mt-2 rounded-full bg-main-accent px-5 py-2 font-bold text-white" href="/home">{labels.backHome}</Link>
          </div>
        ) : null}

        {items.map((item) => {
          const message = notificationMessage(item, labels)
          const isBusy = busyIds.has(item.id)
          return (
            <article className={'flex gap-3 border-b border-light-border px-4 py-4 dark:border-dark-border' + (item.readAt ? '' : ' bg-main-accent/5')} key={item.id}>
              <div className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-main-sidebar-background text-sm font-bold text-main-accent" aria-hidden="true">
                {item.type === 'FOLLOW' ? '↗' : item.type === 'LIKE' ? '♥' : item.type === 'MENTION' ? '@' : '↩'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  {!item.readAt ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-main-accent" aria-label={labels.unread} /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-6">
                      {message.href && item.type === 'FOLLOW' ? (
                        <Link className="font-bold hover:underline" href={message.href}>{message.actor}</Link>
                      ) : <span className="font-bold">{message.actor}</span>}
                      {' '}{message.text}
                    </p>
                    <time className="mt-1 block text-xs text-light-secondary dark:text-dark-secondary" dateTime={item.createdAt}>{formatDate(item.createdAt, locale)}</time>
                    {message.href && item.type !== 'FOLLOW' ? <Link className="mt-2 inline-block text-sm font-bold text-main-accent hover:underline" href={message.href}>{labels.view}</Link> : null}
                  </div>
                  {!item.readAt ? (
                    <button className="shrink-0 rounded-full px-2 py-1 text-xs font-bold text-main-accent hover:bg-light-primary/10 disabled:opacity-50 dark:hover:bg-dark-primary/10" disabled={isBusy} onClick={() => void markRead(item)} type="button">
                      {isBusy ? '…' : labels.markRead}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          )
        })}

        {error ? <div className="flex flex-col items-center gap-3 border-b border-light-border px-4 py-6 text-sm dark:border-dark-border" role="status"><p>{error || labels.pageError}</p><button className="rounded-full border border-light-border px-4 py-2 font-bold dark:border-dark-border" onClick={() => void loadPage(nextCursor, Boolean(nextCursor))} type="button">{labels.retry}</button></div> : null}

        {hasMore && !authRequired ? (
          <div className="flex justify-center px-4 py-5">
            <button className="rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10" disabled={loadingMore} onClick={() => void loadPage(nextCursor, true)} type="button">
              {loadingMore ? labels.loadingMore : labels.loadMore}
            </button>
          </div>
        ) : null}
      </section>
    </TwitterCloneSecondaryPageLayout>
  )
}
