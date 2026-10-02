'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type SessionItem = {
  sessionId: string
  deviceId: string | null
  createdAt: string
  expiresAt: string
  lastSeenAt: string | null
}

type SessionResponse = {
  items: SessionItem[]
  nextCursor: string | null
  currentSessionId: string
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function SessionsPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [currentSessionId, setCurrentSessionId] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [revokingId, setRevokingId] = useState('')
  const [error, setError] = useState('')

  async function load(cursor?: string) {
    const params = new URLSearchParams({ limit: '20' })
    if (cursor) params.set('cursor', cursor)

    const response = await fetch('/api/v1/auth/sessions?' + params.toString(), {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })

    if (response.status === 401) {
      const returnTo = window.location.pathname + window.location.search + window.location.hash
      router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
      return null
    }

    const data = await response.json().catch((): null => null) as SessionResponse | { error?: { message?: string } } | null
    if (!response.ok || !data || !('currentSessionId' in data) || !Array.isArray(data.items)) {
      throw new Error(data && 'error' in data ? data.error?.message || '会话列表加载失败' : '会话列表加载失败')
    }

    return data
  }

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
        setError(cause instanceof Error ? cause.message : '会话列表加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [router])

  async function loadMore() {
    if (loadingMore || !nextCursor) return
    setLoadingMore(true)
    setError('')

    try {
      const data = await load(nextCursor)
      if (!data) return
      setSessions((current) => [...current, ...data.items])
      setNextCursor(data.nextCursor)
      setCurrentSessionId(data.currentSessionId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更多会话加载失败')
    } finally {
      setLoadingMore(false)
    }
  }

  async function revoke(sessionId: string) {
    if (sessionId === currentSessionId || revokingId) return

    setRevokingId(sessionId)
    setError('')

    try {
      const response = await fetch('/api/v1/auth/sessions/' + encodeURIComponent(sessionId), {
        method: 'DELETE',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'session-revoke-' + crypto.randomUUID(),
        },
      })

      if (response.status === 401) {
        router.replace('/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search))
        return
      }
      if (!response.ok) {
        const data = await response.json().catch((): null => null) as { error?: { message?: string } } | null
        throw new Error(data?.error?.message || '退出该设备失败')
      }

      setSessions((current) => current.filter((item) => item.sessionId !== sessionId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '退出该设备失败')
    } finally {
      setRevokingId('')
    }
  }

  return (
    <main style={{ maxWidth: 820, margin: '48px auto', padding: '0 20px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'baseline' }}>
        <div>
          <p style={{ margin: 0, fontSize: 13, letterSpacing: 1.5, color: '#666' }}>ACCOUNT SECURITY</p>
          <h1 style={{ margin: '8px 0 4px' }}>登录设备</h1>
          <p style={{ margin: 0, color: '#666' }}>查看当前账号的有效登录会话，并退出其他设备。</p>
        </div>
        <Link href="/me/profile">返回个人资料</Link>
      </header>

      {loading ? <p role="status">正在加载登录设备…</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {!loading && sessions.length === 0 && !error ? (
        <p style={{ marginTop: 28, color: '#666' }}>当前没有可显示的登录设备。</p>
      ) : null}

      {!loading && sessions.length > 0 ? (
        <section aria-label="登录设备列表" style={{ marginTop: 28, display: 'grid', gap: 12 }}>
          {sessions.map((session) => {
            const isCurrent = session.sessionId === currentSessionId
            return (
              <article
                key={session.sessionId}
                style={{
                  padding: 18,
                  border: '1px solid #dfe7f0',
                  borderRadius: 14,
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{isCurrent ? '当前设备' : '已登录设备'}</strong>
                    <p style={{ margin: '6px 0 0', color: '#617086', fontSize: 12 }}>
                      {session.deviceId || '未提供设备标识'}
                    </p>
                  </div>
                  {isCurrent ? (
                    <span style={{ color: '#067647', fontSize: 12, fontWeight: 750 }}>正在使用</span>
                  ) : (
                    <button
                      disabled={revokingId === session.sessionId}
                      onClick={() => void revoke(session.sessionId)}
                      type="button"
                    >
                      {revokingId === session.sessionId ? '退出中…' : '退出设备'}
                    </button>
                  )}
                </div>
                <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, margin: '16px 0 0' }}>
                  <div>
                    <dt style={{ color: '#8a98ab', fontSize: 11 }}>登录时间</dt>
                    <dd style={{ margin: '5px 0 0', fontSize: 12 }}>{formatDate(session.createdAt)}</dd>
                  </div>
                  <div>
                    <dt style={{ color: '#8a98ab', fontSize: 11 }}>最近访问</dt>
                    <dd style={{ margin: '5px 0 0', fontSize: 12 }}>{session.lastSeenAt ? formatDate(session.lastSeenAt) : '—'}</dd>
                  </div>
                  <div>
                    <dt style={{ color: '#8a98ab', fontSize: 11 }}>过期时间</dt>
                    <dd style={{ margin: '5px 0 0', fontSize: 12 }}>{formatDate(session.expiresAt)}</dd>
                  </div>
                </dl>
              </article>
            )
          })}

          {nextCursor ? (
            <button disabled={loadingMore} onClick={() => void loadMore()} type="button">
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          ) : null}
        </section>
      ) : null}
    </main>
  )
}
