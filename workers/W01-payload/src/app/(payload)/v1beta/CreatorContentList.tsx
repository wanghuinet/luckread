'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import styles from './creator-center.module.css'
import ContentRevisionHistory from './ContentRevisionHistory'
import CreatorActionButton from './CreatorActionButton'
import { Pill } from '@payloadcms/ui/elements/Pill'

type ContentState = 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'DELETED' | 'RESTORED'
type ContentType = 'article' | 'post' | 'video'

type Item = {
  id: string
  slug?: string
  contentType: ContentType
  state: ContentState
  scheduledAt: string | null
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

export default function CreatorContentList({ loginPath = '/admin/login' }: { loginPath?: '/admin/login' | '/login' }) {
  const [status, setStatus] = useState<string>('')
  const [type, setType] = useState<string>('')
  const [localFilter, setLocalFilter] = useState('')
  const [page, setPage] = useState<Page>({ items: [], nextCursor: null, hasMore: false })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [actionId, setActionId] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const activeRequestRef = useRef<AbortController | null>(null)
  const [revisionTarget, setRevisionTarget] = useState<{ id: string; version: number } | null>(null)
  const visibleItems = useMemo(() => {
    const query = localFilter.trim().toLocaleLowerCase()
    if (!query) return page.items
    return page.items.filter((item) => item.title.toLocaleLowerCase().includes(query) || item.id.toLocaleLowerCase().includes(query))
  }, [localFilter, page.items])

  const load = useCallback(async (cursor: string | null = null) => {
    activeRequestRef.current?.abort()
    const controller = new AbortController()
    activeRequestRef.current = controller
    const requestId = ++requestIdRef.current
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
        signal: controller.signal,
      })
      const data = await response.json().catch((): null => null)
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data) {
        throw new Error(data?.error?.message || '内容列表加载失败')
      }
      if (requestId !== requestIdRef.current) return
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
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : '内容列表加载失败')
    } finally {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      setLoading(false)
      setLoadingMore(false)
      if (activeRequestRef.current === controller) activeRequestRef.current = null
    }
  }, [loginPath, status, type])

  useEffect(() => {
    const timer = window.setTimeout((): void => {
      void load()
    }, 0)
    return () => {
      requestIdRef.current += 1
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
      window.clearTimeout(timer)
    }
  }, [load])

  useEffect(() => {
    const handleContentMutation = () => {
      void load()
    }
    window.addEventListener('luckread:content-mutated', handleContentMutation)
    return () => window.removeEventListener('luckread:content-mutated', handleContentMutation)
  }, [load])

  async function requestTransition(itemId: string, to: 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'RESTORED' | 'DRAFT' | 'SCHEDULED', version: number, scheduledAt?: string) {
    const response = await fetch(`/api/creator/contents/${encodeURIComponent(itemId)}/state`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'If-Match': `W/"${version}"`,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ to, ...(scheduledAt ? { scheduledAt } : {}) }),
    })
    const data = await response.json().catch((): null => null)
    if (response.status === 401) {
      const returnTo = window.location.pathname + window.location.search + window.location.hash
      window.location.assign(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
      throw new Error('AUTH_REQUIRED')
    }
    if (!response.ok) throw new Error(data?.error?.message || '内容状态更新失败')
    return data as { version?: unknown }
  }

  function defaultScheduleInputValue(): string {
    const next = new Date(Date.now() + 60 * 60 * 1000)
    next.setSeconds(0, 0)
    const local = new Date(next.getTime() - next.getTimezoneOffset() * 60 * 1000)
    return local.toISOString().slice(0, 16)
  }

  async function schedulePublication(item: Item) {
    const value = window.prompt(
      '请输入定时发布时间（按当前设备本地时区解释，例如 2026-10-08T20:30）：',
      defaultScheduleInputValue(),
    )?.trim()
    if (!value) return

    const scheduledAt = new Date(value)
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      setError('定时发布时间必须是未来时间。')
      return
    }

    if (!window.confirm('确定在 ' + scheduledAt.toLocaleString('zh-CN', { hour12: false }) + ' 自动发布“' + item.title + '”吗？')) return

    setActionId(item.id)
    setError('')
    try {
      await requestTransition(item.id, 'SCHEDULED', item.version, scheduledAt.toISOString())
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '定时发布设置失败')
    } finally {
      setActionId(null)
    }
  }

  async function transition(item: Item, to: 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'RESTORED' | 'DRAFT') {
    const verb = to === 'UNPUBLISHED'
      ? '下线'
      : to === 'ARCHIVED'
        ? '归档'
        : to === 'RESTORED'
          ? '恢复'
          : to === 'DRAFT'
            ? '恢复为草稿'
            : item.state === 'APPROVED'
              ? '发布'
              : '重新发布'
    if (!window.confirm(`确定要${verb}“${item.title}”吗？`)) return

    setActionId(item.id)
    setError('')
    try {
      await requestTransition(item.id, to, item.version)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${verb}失败`)
    } finally {
      setActionId(null)
    }
  }

  async function moveToDraftForEdit(item: Item) {
    if (!window.confirm(`确定要把“${item.title}”转为草稿并进入编辑吗？`)) return

    setActionId(item.id)
    setError('')
    try {
      const result = await requestTransition(item.id, 'DRAFT', item.version)
      const nextVersion = typeof result.version === 'number' ? result.version : item.version + 1
      await load()
      window.location.assign(`/publish?draft=${encodeURIComponent(item.id)}&version=${nextVersion}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '转为草稿失败')
    } finally {
      setActionId(null)
    }
  }

  async function unpublishAndEdit(item: Item) {
    if (!window.confirm(`“${item.title}”将先下线，再转为草稿进入编辑。继续吗？`)) return

    setActionId(item.id)
    setError('')
    try {
      const unpublished = await requestTransition(item.id, 'UNPUBLISHED', item.version)
      const unpublishedVersion = typeof unpublished.version === 'number' ? unpublished.version : item.version + 1
      const draft = await requestTransition(item.id, 'DRAFT', unpublishedVersion)
      const draftVersion = typeof draft.version === 'number' ? draft.version : unpublishedVersion + 1
      await load()
      window.location.assign(`/publish?draft=${encodeURIComponent(item.id)}&version=${draftVersion}`)
    } catch (cause) {
      await load()
      setError(cause instanceof Error ? cause.message : '下线并进入编辑失败；若内容已经下线，可从内容列表转为草稿后继续编辑。')
    } finally {
      setActionId(null)
    }
  }

  async function sharePublishedContent(item: Item) {
    const sharePath = '/content/' + encodeURIComponent(item.slug || item.id)
    const shareUrl = window.location.origin + sharePath
    try {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: item.title, url: shareUrl })
          return
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === 'AbortError') return
        }
      }
      await navigator.clipboard.writeText(shareUrl)
      setError('公开链接已复制。')
      window.setTimeout(() => setError(''), 1800)
    } catch {
      setError('无法复制公开链接，请从地址栏复制当前页面地址。')
    }
  }

  async function deleteContent(item: Item) {
    if (!window.confirm('确定要删除“' + item.title + '”吗？删除后内容会进入已删除状态。')) return

    setActionId(item.id)
    setError('')
    try {
      const response = await fetch(`/api/creator/contents/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'If-Match': `W/"${item.version}"`,
          'Idempotency-Key': crypto.randomUUID(),
        },
      })
      const data = await response.json().catch((): null => null)
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) throw new Error(data?.error?.message || '删除失败')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败')
    } finally {
      setActionId(null)
    }
  }
  return (
    <section aria-busy={loading || actionId !== null} className={styles.contentManageSection}>
      <div className={styles.contentManageHeading}>
        <div>
          <span className={styles.eyebrow}>CONTENT MANAGEMENT</span>
          <h2>我的内容</h2>
        </div>
        <CreatorActionButton el="anchor" href="/publish" tone="primary">
          新建内容
        </CreatorActionButton>
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
          ['ARCHIVED', '已归档'],
          ['DELETED', '已删除'],
          ['RESTORED', '已恢复'],
        ].map(([value, label]) => (
          <CreatorActionButton
            tone={status === value ? 'primary' : 'secondary'}
            key={value}
            onClick={() => setStatus(value)}
            type="button"
          >
            {label}
          </CreatorActionButton>
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
        <input
          aria-label="筛选已加载内容"
          className={styles.filterSelect}
          onChange={(event) => setLocalFilter(event.target.value)}
          placeholder="筛选已加载内容（标题或 ID）"
          type="search"
          value={localFilter}
        />
      </div>

      {revisionTarget ? (
        <ContentRevisionHistory
          contentId={revisionTarget.id}
          currentVersion={revisionTarget.version}
          loginPath={loginPath}
          open
          onChanged={() => {
            setRevisionTarget(null)
            void load()
          }}
          onClose={() => setRevisionTarget(null)}
        />
      ) : null}

      {loading ? <div className={styles.contentManageState} role="status" aria-busy="true">正在加载内容…</div> : null}
      {!loading && error ? (
        <div className={styles.contentManageState} role="alert">
          <span>{error}</span>
          <CreatorActionButton  onClick={() => void load()} type="button">重试</CreatorActionButton>
        </div>
      ) : null}
      {!loading && !error && page.items.length === 0 ? (
        <div className={styles.contentManageEmpty}>
          <strong>还没有符合条件的内容</strong>
          <span>发布第一篇内容后，这里会自动显示草稿、审核和已发布记录。</span>
          <Link  href="/publish">开始创作</Link>
        </div>
      ) : null}
      {!loading && !error && page.items.length > 0 && visibleItems.length === 0 ? (
        <div className={styles.contentManageEmpty}>
          <strong>没有匹配的已加载内容</strong>
          <span>当前筛选只作用于已经加载的内容；可清空筛选或继续加载更多。</span>
        </div>
      ) : null}

      {!loading && !error && visibleItems.length > 0 ? (
        <>
          <div className={styles.contentList}>
            {visibleItems.map((item) => (
              <article className={styles.contentListItem} key={item.id}>
                {(item.coverRef || item.mediaRefs?.length) ? (
                  <div className={styles.contentListThumb} aria-hidden="true">
                    {item.coverRef ? <img alt="" loading="lazy" src={item.coverRef} /> : <span>{item.mediaRefs?.length} 个媒体</span>}
                  </div>
                ) : null}
                <div className={styles.contentListMain}>
                  <div className={styles.contentMeta}>
                    <Pill pillStyle="light-gray" size="small">{typeLabels[item.contentType]}</Pill>
                    <Pill
                      pillStyle={
                        item.state === 'PUBLISHED'
                          ? 'success'
                          : item.state === 'REJECTED' || item.state === 'DELETED'
                            ? 'error'
                            : item.state === 'PENDING_REVIEW'
                              ? 'warning'
                              : 'light-gray'
                      }
                      size="small"
                    >
                      {labels[item.state]}
                    </Pill>
                    {item.state === 'SCHEDULED' && item.scheduledAt ? (
                      <time dateTime={item.scheduledAt}>将于 {new Date(item.scheduledAt).toLocaleString('zh-CN', { hour12: false })} 发布</time>
                    ) : null}
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
                  <CreatorActionButton
                    
                    disabled={actionId !== null}
                    onClick={() => setRevisionTarget({ id: item.id, version: item.version })}
                    type="button"
                  >
                    版本历史
                  </CreatorActionButton>
                  {item.state === 'DRAFT' ? (
                    <Link  href={`/publish?draft=${encodeURIComponent(item.id)}`}>
                      {item.contentType === 'video' ? '编辑视频资料' : '继续编辑'}
                    </Link>
                  ) : null}
                  {item.state === 'REJECTED' ? (
                    <CreatorActionButton
                      extraButtonProps={{ 'aria-busy': actionId === item.id }}
                      
                      disabled={actionId !== null}
                      onClick={() => void moveToDraftForEdit(item)}
                      type="button"
                    >
                      {actionId === item.id ? '处理中…' : item.contentType === 'video' ? '编辑视频资料' : '继续编辑'}
                    </CreatorActionButton>
                  ) : null}
                  {item.state === 'APPROVED' ? (
                    <>
                      <CreatorActionButton
                        extraButtonProps={{ 'aria-busy': actionId === item.id }}
                        tone="primary"
                        disabled={actionId !== null}
                        onClick={() => void transition(item, 'PUBLISHED')}
                        type="button"
                      >
                        {actionId === item.id ? '处理中…' : '立即发布'}
                      </CreatorActionButton>
                      <CreatorActionButton
                        extraButtonProps={{ 'aria-busy': actionId === item.id }}
                        
                        disabled={actionId !== null}
                        onClick={() => void schedulePublication(item)}
                        type="button"
                      >
                        {actionId === item.id ? '处理中…' : '定时发布'}
                      </CreatorActionButton>
                    </>
                  ) : null}
                  {item.state === 'SCHEDULED' ? (
                    <CreatorActionButton
                      extraButtonProps={{ 'aria-busy': actionId === item.id }}
                      
                      disabled={actionId !== null}
                      onClick={() => void transition(item, 'DRAFT')}
                      type="button"
                    >
                      {actionId === item.id ? '处理中…' : '取消定时并转草稿'}
                    </CreatorActionButton>
                  ) : null}
                  {item.state === 'PUBLISHED' ? (
                    <>
                      <Link  href={`/content/${encodeURIComponent(item.slug || item.id)}`}>
                        查看内容
                      </Link>
                      <CreatorActionButton
                        
                        disabled={actionId !== null}
                        onClick={() => void sharePublishedContent(item)}
                        type="button"
                      >
                        分享
                      </CreatorActionButton>
                      <CreatorActionButton
                        extraButtonProps={{ 'aria-busy': actionId === item.id }}
                        
                        disabled={actionId !== null}
                        onClick={() => void unpublishAndEdit(item)}
                        type="button"
                      >
                        {actionId === item.id ? '处理中…' : item.contentType === 'video' ? '下线并编辑视频资料' : '下线并编辑'}
                      </CreatorActionButton>
                      <CreatorActionButton
                        extraButtonProps={{ 'aria-busy': actionId === item.id }}
                        
                        disabled={actionId !== null}
                        onClick={() => void transition(item, 'UNPUBLISHED')}
                        type="button"
                      >
                        {actionId === item.id ? '处理中…' : '下线'}
                      </CreatorActionButton>
                      <CreatorActionButton
                        extraButtonProps={{ 'aria-busy': actionId === item.id }}
                        
                        disabled={actionId !== null}
                        onClick={() => void transition(item, 'ARCHIVED')}
                        type="button"
                      >
                        {actionId === item.id ? '处理中…' : '归档'}
                      </CreatorActionButton>
                    </>
                  ) : null}
                  {item.state === 'UNPUBLISHED' ? (
                    <>
                      <CreatorActionButton
                        extraButtonProps={{ 'aria-busy': actionId === item.id }}
                        
                        disabled={actionId !== null}
                        onClick={() => void moveToDraftForEdit(item)}
                        type="button"
                      >
                        {actionId === item.id ? '处理中…' : item.contentType === 'video' ? '转为草稿编辑视频资料' : '转为草稿编辑'}
                      </CreatorActionButton>
                      <CreatorActionButton
                        
                        disabled={actionId !== null}
                        onClick={() => void transition(item, 'PUBLISHED')}
                        type="button"
                      >
                        {actionId === item.id ? '处理中…' : '重新发布'}
                      </CreatorActionButton>
                    </>
                  ) : null}
                  {item.state === 'ARCHIVED' ? (
                    <CreatorActionButton
                      extraButtonProps={{ 'aria-busy': actionId === item.id }}
                      
                      disabled={actionId !== null}
                      onClick={() => void transition(item, 'DRAFT')}
                      type="button"
                    >
                      {actionId === item.id ? '处理中…' : '恢复为草稿'}
                    </CreatorActionButton>
                  ) : null}
                  {item.state === 'DELETED' ? (
                    <CreatorActionButton
                      extraButtonProps={{ 'aria-busy': actionId === item.id }}
                      
                      disabled={actionId !== null}
                      onClick={() => void transition(item, 'RESTORED')}
                      type="button"
                    >
                      {actionId === item.id ? '处理中…' : '恢复'}
                    </CreatorActionButton>
                  ) : null}
                  {item.state === 'RESTORED' ? (
                    <CreatorActionButton
                      extraButtonProps={{ 'aria-busy': actionId === item.id }}
                      
                      disabled={actionId !== null}
                      onClick={() => void transition(item, 'DRAFT')}
                      type="button"
                    >
                      {actionId === item.id ? '处理中…' : '恢复为草稿'}
                    </CreatorActionButton>
                  ) : null}
                  {['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'].includes(item.state) ? (
                    <CreatorActionButton
                      extraButtonProps={{ 'aria-busy': actionId === item.id }}
                      tone="error"
                      disabled={actionId !== null}
                      onClick={() => void deleteContent(item)}
                      type="button"
                    >
                      {actionId === item.id ? '处理中…' : '删除'}
                    </CreatorActionButton>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {page.hasMore && page.nextCursor ? (
            <CreatorActionButton
              extraButtonProps={{ 'aria-busy': loadingMore }}
              
              disabled={loadingMore}
              onClick={() => void load(page.nextCursor)}
              type="button"
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </CreatorActionButton>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
