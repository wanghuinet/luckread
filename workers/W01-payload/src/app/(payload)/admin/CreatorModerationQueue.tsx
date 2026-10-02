'use client'

import { useState } from 'react'

import styles from './creator-center.module.css'

type ModerationItem = {
  caseId: string
  target?: { targetType?: string; targetId?: string }
  policyVersion: string
  status: string
  version: number
  createdAt: string
  updatedAt: string
}

type QueueResponse = {
  items?: ModerationItem[]
  nextCursor?: string | null
  hasMore?: boolean
  error?: { message?: string }
}

type DecisionResponse = {
  caseId?: string
  decisionId?: string
  outcome?: 'APPROVED' | 'REJECTED'
  version?: number
  error?: { message?: string }
}

export default function CreatorModerationQueue() {
  const [items, setItems] = useState<ModerationItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [decisionReason, setDecisionReason] = useState<Record<string, string>>({})

  async function loadQueue() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/v1/admin/moderation/queue?limit=20', {
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      const data = await response.json().catch((): null => null) as QueueResponse | null
      if (response.status === 403) {
        setLoaded(true)
        setItems([])
        setError('当前账号没有审核队列权限（需要 L6 及以上审核权限）。')
        return
      }
      if (response.status === 401) {
        setLoaded(true)
        setItems([])
        setError('登录已失效，请重新登录。')
        return
      }
      if (!response.ok || !Array.isArray(data?.items)) {
        throw new Error(data?.error?.message || '审核队列读取失败')
      }
      setItems(data.items)
      setLoaded(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '审核队列读取失败')
    } finally {
      setLoading(false)
    }
  }

  async function decide(item: ModerationItem, outcome: 'APPROVED' | 'REJECTED') {
    const reason = (decisionReason[item.caseId] || '').trim()
    const defaultReason = outcome === 'APPROVED' ? 'manual_review_approved' : 'manual_review_rejected'
    const reasonCode = reason || defaultReason
    if (reasonCode.length > 128) {
      setError('决定原因不能超过 128 个字符。')
      return
    }

    setActionId(item.caseId)
    setError('')
    setMessage('')
    try {
      const response = await fetch(
        '/api/v1/admin/moderation/cases/' + encodeURIComponent(item.caseId) + '/decision',
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'If-Match': 'W/"' + item.version + '"',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            decision: outcome,
            expectedVersion: item.version,
            policyVersion: item.policyVersion,
            reasonCode,
            severity: outcome === 'REJECTED' ? 'BLOCK' : 'INFO',
            scope: 'content',
            effectiveAt: new Date().toISOString(),
            expiresAt: null,
          }),
        },
      )
      const data = await response.json().catch((): null => null) as DecisionResponse | null
      if (!response.ok || data?.outcome !== outcome) {
        throw new Error(data?.error?.message || '审核决定提交失败')
      }
      setMessage(outcome === 'APPROVED' ? '内容已批准，已进入内容发布状态处理。' : '内容已退回。')
      await loadQueue()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '审核决定提交失败')
    } finally {
      setActionId(null)
    }
  }

  return (
    <section className={styles.moderationPanel} aria-label="平台审核">
      <div className={styles.moderationHeader}>
        <div>
          <span className={styles.eyebrow}>PLATFORM MODERATION</span>
          <h2>审核队列</h2>
          <p>L6 及以上审核员可在这里处理内容审核决定；内容状态仍由 W03 负责最终落库。</p>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={loading}
          onClick={() => void loadQueue()}
          type="button"
        >
          {loading ? '读取中…' : loaded ? '刷新队列' : '打开审核队列'}
        </button>
      </div>

      {message ? <p className={styles.moderationMessage} role="status">{message}</p> : null}
      {error ? <p className={styles.moderationError} role="alert">{error}</p> : null}

      {loaded && !error && items.length === 0 ? (
        <div className={styles.moderationEmpty}>
          <strong>当前没有待处理审核案件</strong>
          <span>审核队列只返回 OPEN、UNDER_REVIEW、ESCALATED、APPEALED 且目标类型为 content 的案件。</span>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className={styles.moderationList}>
          {items.map((item) => (
            <article className={styles.moderationItem} key={item.caseId}>
              <div className={styles.moderationItemMain}>
                <div className={styles.contentMeta}>
                  <span>{item.status}</span>
                  <span>v{item.version}</span>
                  <span>{item.policyVersion}</span>
                </div>
                <strong>{item.target?.targetId || item.caseId}</strong>
                <small>案件 {item.caseId}</small>
                <time dateTime={item.updatedAt}>
                  更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                </time>
              </div>

              <div className={styles.moderationDecision}>
                <input
                  aria-label={item.caseId + ' 决定原因'}
                  maxLength={128}
                  onChange={(event) => setDecisionReason((current) => ({ ...current, [item.caseId]: event.target.value }))}
                  placeholder="决定原因（可选）"
                  value={decisionReason[item.caseId] || ''}
                />
                <div>
                  <button
                    className={styles.primaryButton}
                    disabled={actionId !== null}
                    onClick={() => void decide(item, 'APPROVED')}
                    type="button"
                  >
                    {actionId === item.caseId ? '处理中…' : '批准'}
                  </button>
                  <button
                    className={styles.dangerButton}
                    disabled={actionId !== null}
                    onClick={() => void decide(item, 'REJECTED')}
                    type="button"
                  >
                    {actionId === item.caseId ? '处理中…' : '退回'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
