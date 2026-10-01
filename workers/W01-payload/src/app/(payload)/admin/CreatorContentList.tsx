'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import styles from './creator-center.module.css'

type ContentState = 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'DELETED' | 'RESTORED'
type ContentType = 'article' | 'post' | 'video'

type Item = {
  id: string
  contentType: ContentType
  state: ContentState
  version: number
  title: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt: string
}

type Page = {
  items: Item[]
  nextCursor: string | null
  hasMore: boolean
}

const labels: Record<ContentState, string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '审核中',
  REJECTED: '审核退回',
  APPROVED: '待发布',
  SCHEDULED: '定时发布',
  PUBLISHED: '已发布',
  UNPUBLISHED: '已下线',
  ARCHIVED: '已归档',
  DELETED: '已删除',
  RESTORED: '已恢复',
}

const typeLabels: Record<ContentType, string> = {
  article: '文章',
  post: '动态',
  video: '视频',
}

export default function CreatorContentList() {
  const [status, setStatus] = useState<string>('')
  const [type, setType] = useState<string>('')
  const [page, setPage] = useState<Page>({ items: [], nextCursor: null, hasMore: false })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)

  const load = useCallback(async (cursor: string | null = null) => {
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (cursor) params.set('cursor', cursor)
      if (status) params.set('status', status)
      if (type) params.set('type', type)

      const response = await fetch(`/api/creator/contents?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      })
      const data = await response.json().catch((): null => null)
      if (!response.ok || !data?.data) {
        throw new Error(data?.error?.message || '内容列表加载失败')
      }
      const next = data.data as Page
      setPage((current) =>
        cursor
          ? {
              items: [...current.items, ...(next.items ?? [])],
              nextCursor: next.nextCursor,
              hasMore: next.hasMore,
            }
          : next,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '内容列表加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [status, type])

  useEffect(() => {
    const timer = window.setTimeout((): void => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const handleContentMutation = () => {
      void load()
    }
    window.addEventListener('luckread:content-mutated', handleContentMutation)
    return () => window.removeEventListener('luckread:content-mutated', handleContentMutation)
  }, [load])

  async function transition(item: Item, to: 'PUBLISHED' | 'UNPUBLISHED') {
    const verb = to === 'UNPUBLISHED'
      ? '下线'
      : item.state === 'APPROVED'
        ? '发布'
        : '重新发布'
    if (!window.confirm(`确定要${verb}“${item.title}”吗？`)) return

    setActionId(item.id)
    setError('')
    try {
      const response = await fetch(`/api/creator/contents/${encodeURIComponent(item.id)}/state`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'If-Match': `W/"${item.version}"`,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ to }),
      })
      const data = await response.json().catch((): null => null)
      if (!response.ok) throw new Error(data?.error?.message || `${verb}失败`)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${verb}失败`)
    } finally {
      setActionId(null)
    }
  }

  return (
    <section className={styles.contentManageSection}>
      <div className={styles.contentManageHeading}>
        <div>
          <span className={styles.eyebrow}>CONTENT MANAGEMENT</span>
          <h2>我的内容</h2>
        </div>
        <Link className={styles.primaryButton} href="/publish">
          新建内容
        </Link>
      </div>

      <div className={styles.contentFilters} role="group" aria-label="内容筛选">
        {[
          ['', '全部'],
          ['DRAFT', '草稿'],
          ['PENDING_REVIEW', '审核中'],
          ['REJECTED', '审核退回'],
          ['APPROVED', '待发布'],
          ['SCHEDULED', '定时发布'],
          ['PUBLISHED', '已发布'],
          ['UNPUBLISHED', '已下线'],
        ].map(([value, label]) => (
          <button
            className={status === value ? styles.filterActive : styles.filterButton}
            key={value}
            onClick={() => setStatus(value)}
            type="button"
          >
            {label}
          </button>
        ))}
        <select
          aria-label="内容类型"
          className={styles.filterSelect}
          onChange={(event) => setType(event.target.value)}
          value={type}
        >
          <option value="">全部类型</option>
          <option value="article">文章</option>
          <option value="post">动态</option>
          <option value="video">视频</option>
        </select>
      </div>

      {loading ? <div className={styles.contentManageState}>正在加载内容…</div> : null}
      {!loading && error ? (
        <div className={styles.contentManageState}>
          <span>{error}</span>
          <button className={styles.secondaryButton} onClick={() => void load()} type="button">重试</button>
        </div>
      ) : null}
      {!loading && !error && page.items.length === 0 ? (
        <div className={styles.contentManageEmpty}>
          <strong>还没有符合条件的内容</strong>
          <span>发布第一篇内容后，这里会自动显示草稿、审核和已发布记录。</span>
          <Link className={styles.secondaryButton} href="/publish">开始创作</Link>
        </div>
      ) : null}

      {!loading && !error && page.items.length > 0 ? (
        <>
          <div className={styles.contentList}>
            {page.items.map((item) => (
              <article className={styles.contentListItem} key={item.id}>
                {(item.coverRef || item.mediaRefs?.length) ? (
                  <div className={styles.contentListThumb} aria-hidden="true">
                    {item.coverRef ? <img alt="" loading="lazy" src={item.coverRef} /> : <span>{item.mediaRefs?.length} 个媒体</span>}
                  </div>
                ) : null}
                <div className={styles.contentListMain}>
                  <div className={styles.contentMeta}>
                    <span>{typeLabels[item.contentType]}</span>
                    <span>{labels[item.state]}</span>
                    <span>v{item.version}</span>
                  </div>
                  <h3>{item.title}</h3>
                  {item.mediaRefs?.length ? (
                    <span className={styles.contentMediaHint}>媒体 {item.mediaRefs.length} 个</span>
                  ) : null}
                  <time dateTime={item.updatedAt}>
                    更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                  </time>
                </div>
                <div className={styles.contentListActions}>
                  {['DRAFT', 'REJECTED'].includes(item.state) ? (
                    <Link className={styles.secondaryButton} href={`/publish?draft=${encodeURIComponent(item.id)}`}>
                      继续编辑
                    </Link>
                  ) : null}
                  {item.state === 'APPROVED' ? (
                    <button
                      className={styles.primaryButton}
                      disabled={actionId !== null}
                      onClick={() => void transition(item, 'PUBLISHED')}
                      type="button"
                    >
                      {actionId === item.id ? '处理中…' : '立即发布'}
                    </button>
                  ) : null}
                  {item.state === 'PUBLISHED' ? (
                    <>
                      <Link className={styles.secondaryButton} href={`/content/${encodeURIComponent(item.id)}`}>
                        查看内容
                      </Link>
                      <button
                        className={styles.secondaryButton}
                        disabled={actionId !== null}
                        onClick={() => void transition(item, 'UNPUBLISHED')}
                        type="button"
                      >
                        {actionId === item.id ? '处理中…' : '下线'}
                      </button>
                    </>
                  ) : null}
                  {item.state === 'UNPUBLISHED' ? (
                    <button
                      className={styles.secondaryButton}
                      disabled={actionId !== null}
                      onClick={() => void transition(item, 'PUBLISHED')}
                      type="button"
                    >
                      {actionId === item.id ? '处理中…' : '重新发布'}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {page.hasMore && page.nextCursor ? (
            <button
              className={styles.secondaryButton}
              disabled={loadingMore}
              onClick={() => void load(page.nextCursor)}
              type="button"
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
