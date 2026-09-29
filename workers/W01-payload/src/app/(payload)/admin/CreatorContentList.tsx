'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type ContentState =
  | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED' | 'APPROVED' | 'SCHEDULED'
  | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'DELETED' | 'RESTORED'
type ContentType = 'article' | 'post' | 'video'

type ContentItem = {
  id: string
  contentType: ContentType
  state: ContentState
  version: number
  revision: number
  etag: string
  title: string
  bodyRef: string
  mediaRefs: string[]
  coverRef: string | null
  createdAt: string
  updatedAt: string
}

type ListResponse = {
  data?: { items?: ContentItem[]; nextCursor?: string | null; hasMore?: boolean }
  error?: { message?: string }
}

const ACCESS_KEY = 'luckread.accessToken'
const REFRESH_KEY = 'luckread.refreshToken'
const DEVICE_KEY = 'luckread.deviceId'

const tabs = [
  { value: 'ALL', label: '全部' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'PENDING_REVIEW', label: '审核中' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'REJECTED', label: '被驳回' },
  { value: 'ARCHIVED', label: '归档' },
  { value: 'DELETED', label: '回收站' },
] as const

const stateLabel: Record<ContentState, string> = {
  DRAFT: '草稿', PENDING_REVIEW: '审核中', REJECTED: '已驳回', APPROVED: '待发布',
  SCHEDULED: '定时', PUBLISHED: '已发布', UNPUBLISHED: '已下架', ARCHIVED: '已归档',
  DELETED: '已删除', RESTORED: '已恢复',
}
const typeLabel: Record<ContentType, string> = { article: '文章', post: '动态', video: '视频' }

function getDeviceId() {
  const existing = sessionStorage.getItem(DEVICE_KEY)
  if (existing) return existing
  const value = crypto.randomUUID()
  sessionStorage.setItem(DEVICE_KEY, value)
  return value
}

async function refreshAccessToken() {
  const refreshToken = sessionStorage.getItem(REFRESH_KEY)
  if (!refreshToken) return null
  const response = await fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ refreshToken, deviceId: getDeviceId() }),
  })
  const data = await response.json().catch((): null => null)
  if (!response.ok || !data?.accessToken) return null
  sessionStorage.setItem(ACCESS_KEY, data.accessToken)
  if (data.refreshToken) sessionStorage.setItem(REFRESH_KEY, data.refreshToken)
  return data.accessToken as string
}

async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  let token = sessionStorage.getItem(ACCESS_KEY)
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', 'Bearer ' + token)
  let response = await fetch(input, { ...init, headers, credentials: 'include' })
  if (response.status === 401 && token) {
    token = await refreshAccessToken()
    if (token) {
      headers.set('Authorization', 'Bearer ' + token)
      response = await fetch(input, { ...init, headers, credentials: 'include' })
    }
  }
  return response
}

const actionFor = (item: ContentItem): { to: ContentState; label: string } | null => {
  switch (item.state) {
    case 'DRAFT': return { to: 'PENDING_REVIEW', label: '提交审核' }
    case 'REJECTED': return { to: 'DRAFT', label: '返回草稿' }
    case 'APPROVED': return { to: 'PUBLISHED', label: '发布' }
    case 'PUBLISHED': return { to: 'UNPUBLISHED', label: '下架' }
    case 'UNPUBLISHED': return { to: 'PUBLISHED', label: '重新发布' }
    case 'ARCHIVED': return { to: 'DRAFT', label: '恢复草稿' }
    case 'DELETED': return { to: 'RESTORED', label: '恢复' }
    default: return null
  }
}

export default function CreatorContentList() {
  const [status, setStatus] = useState<(typeof tabs)[number]['value']>('ALL')
  const [items, setItems] = useState<ContentItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const router = useRouter()

  const load = useCallback(async (cursor: string | null, append: boolean) => {
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({ state: status, limit: '20' })
      if (cursor) query.set('cursor', cursor)
      const response = await authorizedFetch('/api/creator/contents?' + query.toString())
      const data = await response.json().catch((): ListResponse => ({}))
      if (!response.ok) {
        if (response.status === 401) throw new Error('AUTH_REQUIRED')
        throw new Error(data?.error?.message || 'CONTENT_LIST_FAILED')
      }
      const page = data.data
      const pageItems = Array.isArray(page?.items) ? page.items : []
      setItems(current => append ? [...current, ...pageItems] : pageItems)
      setNextCursor(page?.nextCursor ?? null)
      setHasMore(Boolean(page?.hasMore))
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : ''
      setError(code === 'AUTH_REQUIRED' ? '登录状态需要更新，请重新登录。' : '内容列表加载失败，请稍后重试。')
      if (code === 'AUTH_REQUIRED' && window.location.pathname.startsWith('/admin/')) {
        router.replace(`/login?returnTo=${encodeURIComponent(window.location.pathname)}`)
      }
    } finally {
      setLoading(false)
    }
  }, [router, status])

  useEffect(() => { void load(null, false) }, [load])

  const summary = useMemo(() => {
    if (loading && !items.length) return '正在加载…'
    if (!items.length) return '当前筛选下还没有内容。'
    return `共显示 ${items.length}${hasMore ? '+' : ''} 条`
  }, [hasMore, items.length, loading])

  async function transition(item: ContentItem) {
    const action = actionFor(item)
    if (!action) return
    setWorkingId(item.id)
    setError('')
    setNotice('')
    try {
      const response = await authorizedFetch(`/api/creator/contents/${encodeURIComponent(item.id)}/state`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'If-Match': item.etag,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ to: action.to }),
      })
      const data = await response.json().catch((): { error?: { message?: string } } => ({}))
      if (!response.ok) throw new Error(data?.error?.message || 'CONTENT_STATE_FAILED')
      setNotice(`“${item.title}”已${action.label}。`)
      await load(null, false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '状态更新失败，请稍后重试。')
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <div className="lr-content-manager">
      <div className="lr-content-tabs" role="tablist" aria-label="我的内容筛选">
        {tabs.map(tab => (
          <button
            aria-selected={status === tab.value}
            className={status === tab.value ? 'active' : ''}
            key={tab.value}
            onClick={() => setStatus(tab.value)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {notice ? <div className="lr-success" role="status">{notice}</div> : null}
      {error ? <div className="lr-error" role="alert">{error}</div> : null}
      <div className="lr-content-summary">{summary}</div>

      {loading && !items.length ? (
        <div className="lr-content-empty">正在读取你的内容…</div>
      ) : items.length ? (
        <div className="lr-content-list">
          {items.map(item => {
            const action = actionFor(item)
            return (
              <article className="lr-content-item" key={item.id}>
                <div className="lr-content-main">
                  <div className="lr-content-meta">
                    <span>{typeLabel[item.contentType]}</span>
                    <span>{stateLabel[item.state]}</span>
                    <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString('zh-CN')}</time>
                  </div>
                  <h3>{item.title}</h3>
                  <p>版本 {item.version} · 修订 {item.revision}</p>
                </div>
                <div className="lr-content-actions">
                  {action ? (
                    <button
                      className="lr-content-action"
                      disabled={workingId === item.id}
                      onClick={() => void transition(item)}
                      type="button"
                    >
                      {workingId === item.id ? '处理中…' : action.label}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="lr-content-empty">
          <strong>还没有内容</strong>
          <span>先使用上面的发布器创建第一篇内容。</span>
        </div>
      )}

      {hasMore && nextCursor ? (
        <button className="lr-content-more" disabled={loading} onClick={() => void load(nextCursor, true)} type="button">
          {loading ? '正在加载…' : '加载更多'}
        </button>
      ) : null}
    </div>
  )
}
