'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'

import './subscriptions.css'

type Subscription = {
  subscriptionId: string
  planId: string
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED'
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

const statusLabel: Record<Subscription['status'], string> = {
  PENDING: '待处理',
  ACTIVE: '有效',
  PAST_DUE: '逾期',
  PAUSED: '已暂停',
  CANCELED: '已取消',
  EXPIRED: '已到期',
}

const formatDate = (value: string) => {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('zh-CN') : '—'
}

export default function MySubscriptionsPage() {
  const [items, setItems] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

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
      if (!response.ok || !data?.data?.docs) {
        throw new Error(getApiErrorMessage(data, '订阅读取失败'))
      }
      setItems((current) => append ? [...current, ...data.data!.docs!] : data.data!.docs!)
      setPageNumber(data.data.page ?? page)
      setHasNextPage(data.data.hasNextPage === true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '订阅读取失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function transition(item: Subscription, operation: 'cancel' | 'pause' | 'resume') {
    if (operation === 'cancel' && !window.confirm('确定取消这个订阅吗？')) return
    setBusyId(item.subscriptionId)
    setError('')
    setMessage('')
    try {
      const { response, data } = await fetchJson<ListResponse & { data?: Subscription }> (
        '/api/v1/memberships/subscriptions/' + encodeURIComponent(item.subscriptionId) + '/' + operation,
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'If-Match': item.etag,
            'Idempotency-Key': operation + ':' + item.subscriptionId + ':' + item.etag,
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data?.subscriptionId) {
        throw new Error(getApiErrorMessage(data, '订阅状态更新失败'))
      }
      setItems((current) => current.map((currentItem) =>
        currentItem.subscriptionId === item.subscriptionId ? data.data! : currentItem,
      ))
      setMessage(operation === 'cancel' ? '订阅已取消。' : operation === 'pause' ? '订阅已暂停。' : '订阅已恢复。')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '订阅状态更新失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="my-subscriptions">
      <header className="my-subscriptions-header">
        <div>
          <p>LUCKREAD · MEMBERSHIP</p>
          <h1>我的订阅</h1>
          <span>查看当前账号的订阅状态与周期。权益和支付状态仍由各自权威域负责；方案变更将在正式方案目录接入后开放。</span>
        </div>
        <div className="my-subscriptions-actions">
          <Link href="/content">发现内容</Link>
          <Link href="/">返回首页</Link>
          <button disabled={loading || loadingMore} onClick={() => void load()} type="button">{loading ? '刷新中…' : '刷新'}</button>
        </div>
      </header>

      {message ? <p className="subscription-message" role="status">{message}</p> : null}
      {error ? <p className="subscription-error" role="alert">{error}</p> : null}

      {loading && items.length === 0 ? (
        <section className="subscription-empty">正在读取订阅…</section>
      ) : items.length === 0 ? (
        <section className="subscription-empty">
          <strong>还没有订阅记录</strong>
          <span>订阅记录会在会员流程建立后显示在这里。</span>
          <Link href="/content">去发现内容</Link>
        </section>
      ) : (
        <section className="subscription-list" aria-label="订阅列表">
          {items.map((item) => {
            const busy = busyId === item.subscriptionId
            return (
              <article className="subscription-card" key={item.subscriptionId}>
                <div className="subscription-card-top">
                  <div>
                    <span className="subscription-plan">{item.planId}</span>
                    <h2>{item.creatorId ? '创作者订阅' : '会员订阅'}</h2>
                    {item.creatorId ? (
                      <Link href={'/users/' + encodeURIComponent(item.creatorId)} className="subscription-creator-link">
                        查看创作者主页
                      </Link>
                    ) : null}
                  </div>
                  <span className={'subscription-status subscription-status-' + item.status.toLowerCase()}>
                    {statusLabel[item.status]}
                  </span>
                </div>

                <div className="subscription-meta">
                  <div><small>订阅 ID</small><strong>{item.subscriptionId}</strong></div>
                  <div><small>当前周期</small><strong>{formatDate(item.currentPeriodStart)} — {formatDate(item.currentPeriodEnd)}</strong></div>
                  {item.cancelAt ? <div><small>取消时间</small><strong>{formatDate(item.cancelAt)}</strong></div> : null}
                </div>

                <div className="subscription-actions">
                  {['ACTIVE', 'PAST_DUE'].includes(item.status) ? (
                    <button disabled={busy} onClick={() => void transition(item, 'pause')} type="button">{busy ? '处理中…' : '暂停订阅'}</button>
                  ) : null}
                  {item.status === 'PAUSED' ? (
                    <button disabled={busy} onClick={() => void transition(item, 'resume')} type="button">{busy ? '处理中…' : '恢复订阅'}</button>
                  ) : null}
                  {['ACTIVE', 'PAST_DUE', 'PAUSED'].includes(item.status) ? (
                    <button className="danger" disabled={busy} onClick={() => void transition(item, 'cancel')} type="button">{busy ? '处理中…' : '取消订阅'}</button>
                  ) : null}
                </div>
              </article>
            )
          })}
          {hasNextPage ? (
            <div className="subscription-pagination">
              <button
                disabled={loadingMore}
                onClick={() => void load(pageNumber + 1, true)}
                type="button"
              >
                {loadingMore ? '加载中…' : '加载更多订阅'}
              </button>
            </div>
          ) : null}
        </section>
      )}

      <p className="subscription-note">当前页面只反映 Subscription 事实，不把订阅状态直接当作 Entitlement 或支付完成。</p>
    </main>
  )
}
