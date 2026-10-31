'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { usePublicLocale } from '../../i18n/PublicLanguageToggle'
import type { PublicLocale } from '../../i18n/public-locale'

type Subscription = {
  subscriptionId: string
  planId: string
  status: 'PENDING' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED'
  trial?: {
    source: 'WEB' | 'APP_STORE' | 'PLAY_STORE'
    status: 'TRIALING' | 'CANCELED' | 'PAYMENT_FAILED' | 'CONVERTED' | 'EXPIRED'
    trialEndsAt: string
  } | null
  creatorId?: string | null
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAt?: string | null
  etag: string
}

type ListResponse = {
  data?: {
    docs?: Subscription[]
    hasNextPage?: boolean
    page?: number
    limit?: number
  }
  error?: { code?: string; message?: string }
}

const copy = (locale: PublicLocale) => locale === 'en'
  ? {
      eyebrow: 'LUCKREAD · MEMBERSHIP',
      description: 'Review subscription status and billing periods. Subscription records do not prove payment completion or access entitlement. Pause, resume, and cancellation are temporarily unavailable until verified payment-provider synchronization is admitted.',
      discover: 'Explore content',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Loading subscriptions…',
      emptyTitle: 'No subscriptions yet',
      emptyBody: 'Your subscription records will appear here when available.',
      plan: 'Plan',
      creator: 'Creator subscription',
      membership: 'Membership subscription',
      viewCreator: 'View creator profile',
      id: 'Subscription ID',
      period: 'Current period',
      cancelAt: 'Cancellation date',
      trialEnds: 'Trial ends',
      trialCanceled: 'Trial cancellation is scheduled. Access remains available through the trial end date.',
      trialPaymentFailed: 'The first trial-ending payment failed. You can cancel now to stop further retries while keeping access through the trial end date.',
      manageStoreTrial: 'Manage trial renewal in the App Store or Google Play. LuckRead cannot cancel store billing for you.',
      cancelTrial: 'Cancel trial and stop renewal',
      cancelTrialConfirm: 'Cancel the trial conversion? Access remains available until the trial end date.',
      cancelingTrial: 'Canceling trial…',
      mutationsUnavailable: 'Subscription changes are temporarily unavailable while verified payment-provider synchronization is being admitted. Your status and billing-period records remain available.',
      loadMore: 'Load more subscriptions',
      loadingMore: 'Loading more…',
      loadError: 'Could not load subscriptions.',
      updateError: 'Could not update subscription.',
      sessionExpired: 'Your session has expired. Sign in again.',
      status: {
        PENDING: 'Pending',
        TRIALING: 'Trial',
        ACTIVE: 'Active',
        PAST_DUE: 'Past due',
        PAUSED: 'Paused',
        CANCELED: 'Canceled',
        EXPIRED: 'Expired',
      },
    }
  : locale === 'tw'
    ? {
        eyebrow: 'LUCKREAD · 會員訂閱',
        description: '查看訂閱狀態與週期。訂閱記錄本身不代表付款完成或已取得內容權益；暫停、恢復及取消操作將在付款服務商同步驗證通過後開放。',
        discover: '探索內容',
        refresh: '重新整理',
        refreshing: '正在重新整理…',
        loading: '正在讀取訂閱…',
        emptyTitle: '目前沒有訂閱記錄',
        emptyBody: '建立訂閱後，相關記錄會顯示在這裡。',
        plan: '方案',
        creator: '創作者訂閱',
        membership: '會員訂閱',
        viewCreator: '查看創作者主页',
        id: '訂閱 ID',
        period: '目前週期',
        cancelAt: '取消時間',
        trialEnds: '試用結束',
        trialCanceled: '試用已設定取消；試用期結束前仍可使用會員內容。',
        trialPaymentFailed: '試用結束時的首次扣款失敗。現在取消可停止後續重試，試用期結束前仍可使用會員內容。',
        manageStoreTrial: '請在 App Store 或 Google Play 管理試用續訂；LuckRead 無法代替商店取消帳單。',
        cancelTrial: '取消試用並停止續訂',
        cancelTrialConfirm: '要取消試用轉付費嗎？試用期結束前仍可使用會員內容。',
        cancelingTrial: '正在取消試用…',
        mutationsUnavailable: '付款服務商同步驗證尚未通過，暫時無法變更訂閱；目前仍可查看狀態與週期記錄。',
        loadMore: '載入更多訂閱',
        loadingMore: '載入中…',
        loadError: '無法讀取訂閱。',
        updateError: '無法更新訂閱狀態。',
        sessionExpired: '登入已失效，請重新登入。',
        status: {
          PENDING: '待處理',
          TRIALING: '試用中',
          ACTIVE: '有效',
          PAST_DUE: '逾期',
          PAUSED: '已暫停',
          CANCELED: '已取消',
          EXPIRED: '已到期',
        },
      }
    : {
        eyebrow: 'LUCKREAD · 会员订阅',
        description: '查看订阅状态与周期。订阅记录不代表付款完成或内容权益；暂停、恢复与取消操作将在付款服务商同步验证通过后开放。',
        discover: '发现内容',
        refresh: '刷新',
        refreshing: '刷新中…',
        loading: '正在读取订阅…',
        emptyTitle: '还没有订阅记录',
        emptyBody: '建立订阅后，相关记录会显示在这里。',
        plan: '方案',
        creator: '创作者订阅',
        membership: '会员订阅',
        viewCreator: '查看创作者主页',
        id: '订阅 ID',
        period: '当前周期',
        cancelAt: '取消时间',
        trialEnds: '试用结束',
        trialCanceled: '试用已设置取消；试用期结束前仍可使用会员内容。',
        trialPaymentFailed: '试用结束时的首次扣款失败。现在取消可停止后续重试，试用期结束前仍可使用会员内容。',
        manageStoreTrial: '请在 App Store 或 Google Play 管理试用续订；LuckRead 无法代替商店取消账单。',
        cancelTrial: '取消试用并停止续订',
        cancelTrialConfirm: '要取消试用转付费吗？试用期结束前仍可使用会员内容。',
        cancelingTrial: '正在取消试用…',
        mutationsUnavailable: '付款服务商同步验证尚未通过，暂时无法变更订阅；目前仍可查看状态与周期记录。',
        loadMore: '加载更多订阅',
        loadingMore: '加载中…',
        loadError: '订阅读取失败。',
        updateError: '订阅状态更新失败。',
        sessionExpired: '登录已失效，请重新登录。',
        status: {
          PENDING: '待处理',
          TRIALING: '试用中',
          ACTIVE: '有效',
          PAST_DUE: '逾期',
          PAUSED: '已暂停',
          CANCELED: '已取消',
          EXPIRED: '已到期',
        },
      }

const formatDate = (value: string, locale: PublicLocale) => {
  const time = Date.parse(value)
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(dateLocale) : '—'
}

const statusClass = (status: Subscription['status']) => {
  if (status === 'TRIALING') return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
  if (status === 'ACTIVE') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
  if (status === 'PAST_DUE') return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
  if (status === 'PAUSED') return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
  return 'bg-light-line-reply text-light-secondary dark:bg-dark-line-reply dark:text-dark-secondary'
}

export default function MySubscriptionsPage() {
  const locale = usePublicLocale()
  const labels = copy(locale)
  const [items, setItems] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cancelingTrialId, setCancelingTrialId] = useState<string | null>(null)
  const [trialActionError, setTrialActionError] = useState('')

  async function load(page = 1, append = false) {
    if (append) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<ListResponse>('/api/v1/memberships/subscriptions?limit=20&page=' + String(page), {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !Array.isArray(data?.data?.docs)) {
        throw new Error(getApiErrorMessage(data, labels.loadError))
      }
      setItems((current) => append ? [...current, ...(data.data?.docs ?? [])] : (data.data?.docs ?? []))
      setPageNumber(data.data?.page ?? page)
      setHasNextPage(data.data?.hasNextPage === true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  async function cancelTrial(item: Subscription) {
    if (!item.trial || item.trial.source !== 'WEB' ||
        !['TRIALING', 'PAYMENT_FAILED'].includes(item.trial.status)) return
    if (!window.confirm(labels.cancelTrialConfirm)) return
    setCancelingTrialId(item.subscriptionId)
    setTrialActionError('')
    try {
      const { response, data } = await fetchJson<{
        data?: { subscription?: { subscriptionId?: string }; trial?: { status?: string } }
        error?: { code?: string; message?: string }
      }>('/api/v1/memberships/subscriptions/' + encodeURIComponent(item.subscriptionId) + '/cancel-trial', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'If-Match': item.etag,
        },
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || data?.data?.subscription?.subscriptionId !== item.subscriptionId ||
          data.data.trial?.status !== 'CANCELED') {
        throw new Error(getApiErrorMessage(data, labels.updateError))
      }
      await load(pageNumber, false)
    } catch (caught) {
      setTrialActionError(caught instanceof Error ? caught.message : labels.updateError)
    } finally {
      setCancelingTrialId(null)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <section className="flex flex-col" aria-busy={loading || loadingMore}>
      <header className="flex items-start justify-between gap-4 border-b border-light-border px-4 py-4 dark:border-dark-border">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{labels.eyebrow}</p>
          <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.description}</p>
        </div>
        <button
          className="shrink-0 rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
          disabled={loading || loadingMore}
          onClick={() => void load()}
          type="button"
        >
          {loading ? labels.refreshing : labels.refresh}
        </button>
      </header>

      {error ? <p className="border-b border-light-border px-4 py-3 text-sm text-rose-700 dark:border-dark-border dark:text-rose-300" role="alert">{error}</p> : null}
      {trialActionError ? <p className="border-b border-light-border px-4 py-3 text-sm text-rose-700 dark:border-dark-border dark:text-rose-300" role="alert">{trialActionError}</p> : null}

      {loading && items.length === 0 ? (
        <section className="px-4 py-6 text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.loading}</section>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <section className="flex flex-col items-start gap-3 px-6 py-14">
          <strong className="text-xl font-bold">{labels.emptyTitle}</strong>
          <span className="text-sm text-light-secondary dark:text-dark-secondary">{labels.emptyBody}</span>
          <Link className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white hover:brightness-90" href="/content">{labels.discover}</Link>
        </section>
      ) : null}

      {items.map((item) => {
        return (
          <article className="border-b border-light-border px-4 py-4 dark:border-dark-border" key={item.subscriptionId}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-light-secondary dark:text-dark-secondary">{labels.plan}: {item.planId}</p>
                <h2 className="mt-1 text-base font-bold">{item.creatorId ? labels.creator : labels.membership}</h2>
                {item.creatorId ? (
                  <Link className="mt-2 inline-block text-sm font-medium text-main-accent hover:underline" href={'/users/' + encodeURIComponent(item.creatorId)}>
                    {labels.viewCreator}
                  </Link>
                ) : null}
              </div>
              <span className={'shrink-0 rounded-full px-3 py-1 text-xs font-bold ' + statusClass(item.status)}>
                {labels.status[item.status]}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-light-border pt-4 dark:border-dark-border sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs text-light-secondary dark:text-dark-secondary">{labels.id}</dt>
                <dd className="mt-1 break-all text-sm font-medium">{item.subscriptionId}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-light-secondary dark:text-dark-secondary">{labels.period}</dt>
                <dd className="mt-1 text-sm font-medium">{formatDate(item.currentPeriodStart, locale)} — {formatDate(item.currentPeriodEnd, locale)}</dd>
              </div>
              {item.cancelAt ? (
                <div className="min-w-0">
                  <dt className="text-xs text-light-secondary dark:text-dark-secondary">{labels.cancelAt}</dt>
                  <dd className="mt-1 text-sm font-medium">{formatDate(item.cancelAt, locale)}</dd>
                </div>
              ) : null}
            </dl>

            {item.trial ? (
              <section className="mt-4 rounded-xl border border-light-border px-4 py-3 dark:border-dark-border">
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-light-secondary dark:text-dark-secondary">{labels.trialEnds}</dt>
                    <dd className="mt-1 text-sm font-medium">{formatDate(item.trial.trialEndsAt, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-light-secondary dark:text-dark-secondary">{locale === 'en' ? 'Trial source' : locale === 'tw' ? '試用來源' : '试用来源'}</dt>
                    <dd className="mt-1 text-sm font-medium">
                      {item.trial.source === 'WEB' ? 'LuckRead' : item.trial.source === 'APP_STORE' ? 'App Store' : 'Google Play'}
                    </dd>
                  </div>
                </dl>
                {item.trial.source === 'WEB' && item.trial.status === 'CANCELED' ? (
                  <p className="mt-3 text-xs leading-5 text-light-secondary dark:text-dark-secondary">{labels.trialCanceled}</p>
                ) : null}
                {item.trial.source === 'WEB' && item.trial.status === 'PAYMENT_FAILED' ? (
                  <p className="mt-3 text-xs leading-5 text-light-secondary dark:text-dark-secondary">{labels.trialPaymentFailed}</p>
                ) : null}
                {item.trial.source !== 'WEB' && ['TRIALING', 'CANCELED'].includes(item.trial.status) ? (
                  <p className="mt-3 text-xs leading-5 text-light-secondary dark:text-dark-secondary">{labels.manageStoreTrial}</p>
                ) : null}
                {item.trial.source === 'WEB' &&
                  ['TRIALING', 'PAYMENT_FAILED'].includes(item.trial.status) &&
                  ['TRIALING', 'PAST_DUE'].includes(item.status) &&
                  !item.cancelAt ? (
                    <button
                      className="mt-3 rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
                      disabled={cancelingTrialId !== null || loading}
                      onClick={() => void cancelTrial(item)}
                      type="button"
                    >
                      {cancelingTrialId === item.subscriptionId ? labels.cancelingTrial : labels.cancelTrial}
                    </button>
                  ) : null}
              </section>
            ) : null}

            {['ACTIVE', 'PAST_DUE', 'PAUSED'].includes(item.status) && !item.trial ? (
              <p className="mt-4 rounded-xl border border-light-border px-4 py-3 text-xs leading-5 text-light-secondary dark:border-dark-border dark:text-dark-secondary">
                {labels.mutationsUnavailable}
              </p>
            ) : null}
          </article>
        )
      })}

      {hasNextPage ? (
        <div className="flex justify-center px-4 py-5">
          <button
            className="rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
            disabled={loadingMore}
            onClick={() => void load(pageNumber + 1, true)}
            type="button"
          >
            {loadingMore ? labels.loadingMore : labels.loadMore}
          </button>
        </div>
      ) : null}

      <p className="px-4 py-4 text-xs leading-5 text-light-secondary dark:text-dark-secondary">
        {locale === 'en'
          ? 'This page reflects Subscription facts only; it does not treat subscription status as Entitlement or proof of payment.'
          : locale === 'tw'
            ? '此頁面僅呈現訂閱事實，不會把訂閱狀態直接視為內容權益或付款完成。'
            : '当前页面只反映 Subscription 事实，不把订阅状态直接当作 Entitlement 或支付完成。'}
      </p>
    </section>
  )
}
