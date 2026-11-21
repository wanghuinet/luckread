'use client'

import { useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'

import styles from './creator-center.module.css'

type Revision = {
  id: string
  revision: number
  contentVersion: number
  actorUserId: string
  sourceRevision: number | null
  operation: 'CREATE' | 'UPDATE' | 'ROLLBACK'
  state: string
  title: string
  createdAt: string
  reason: string | null
}

type Props = {
  contentId: string
  currentVersion: number
  loginPath: '/admin/login' | '/login'
  open: boolean
  onClose: () => void
  onChanged: () => void
}

export default function ContentRevisionHistory({
  contentId,
  currentVersion,
  loginPath,
  open,
  onClose,
  onChanged,
}: Props) {
  const [items, setItems] = useState<Revision[]>([])
  const [loading, setLoading] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const { response, data } = await fetchJson<{ data?: { items?: Revision[] }; error?: { message?: string } }>(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/revisions?limit=50',
        { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store' },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !Array.isArray(data?.data?.items)) {
        throw new Error(getApiErrorMessage(data, '版本历史加载失败'))
      }
      setItems(data.data.items as Revision[])
      setLoaded(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '版本历史加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function rollback(revision: Revision) {
    if (revision.contentVersion === currentVersion) {
      setError('当前版本无需恢复。')
      return
    }
    // W03 validates the current authoritative content state and ETag.
    // The historical snapshot state is metadata, not a rollback permission source.
    if (!window.confirm('确定恢复到版本 v' + revision.contentVersion + ' 吗？系统会创建一个新的版本，不会删除历史记录。')) return

    setActionId(revision.id)
    setError('')
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/revisions/' + encodeURIComponent(revision.id) + '/rollback',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'If-Match': 'W/"' + currentVersion + '"',
            'Idempotency-Key': 'content-rollback:' + contentId + ':' + revision.id + ':' + crypto.randomUUID(),
          },
          body: JSON.stringify({ reason: 'Creator Center revision restore' }),
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) throw new Error(getApiErrorMessage(data, '版本恢复失败'))
      await load()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '版本恢复失败')
    } finally {
      setActionId(null)
    }
  }

  if (!open) return null

  return (
    <aside aria-label="版本历史" className={styles.contentManageState}>
      <div className={styles.contentManageHeading}>
        <div>
          <span className={styles.eyebrow}>REVISION HISTORY</span>
          <h3>版本历史</h3>
        </div>
        <button className={styles.secondaryButton} onClick={onClose} type="button">关闭</button>
      </div>

      {!loaded && !loading ? (
        <button className={styles.secondaryButton} onClick={() => void load()} type="button">加载版本历史</button>
      ) : null}
      {loading ? <div role="status">正在加载版本历史…</div> : null}
      {error ? <div role="alert">{error}</div> : null}

      {loaded && !loading && items.length === 0 ? <div>暂无历史版本。</div> : null}
      {loaded && !loading && items.length > 0 ? (
        <div className={styles.contentList}>
          {items.map((revision) => (
            <article className={styles.contentListItem} key={revision.id}>
              <div className={styles.contentListMain}>
                <div className={styles.contentMeta}>
                  <span>v{revision.contentVersion}</span>
                  <span>修订 {revision.revision}</span>
                  <span>{revision.operation === 'ROLLBACK' ? '回滚产生' : revision.operation === 'UPDATE' ? '编辑保存' : '初始版本'}</span>
                </div>
                <h4>{revision.title}</h4>
                <time dateTime={revision.createdAt}>
                  {new Date(revision.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </time>
                {revision.reason ? <span>{revision.reason}</span> : null}
              </div>
              <div className={styles.contentListActions}>
                {revision.contentVersion === currentVersion ? (
                  <span>当前版本</span>
                ) : (
                  <button
                    className={styles.secondaryButton}
                    disabled={actionId !== null}
                    onClick={() => void rollback(revision)}
                    type="button"
                  >
                    {actionId === revision.id ? '恢复中…' : '恢复到此版本'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  )
}
