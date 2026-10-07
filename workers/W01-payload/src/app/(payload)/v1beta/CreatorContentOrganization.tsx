'use client'

import { FormEvent, Fragment, useCallback, useEffect, useState } from 'react'

import CreatorContentOrganizationMembers from './CreatorContentOrganizationMembers'
import styles from './creator-center.module.css'

type OrganizationState =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'REJECTED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'UNPUBLISHED'
  | 'ARCHIVED'
  | 'DELETED'
  | 'RESTORED'

type OrganizationItem = {
  id: string
  state: OrganizationState
  version: number
  etag: string
  title: string
  description: string
  coverRef?: string | null
  updatedAt: string
}

type OrganizationPage = {
  items: OrganizationItem[]
  nextCursor: string | null
  hasMore: boolean
}

type Kind = 'series' | 'collections'

const kindMeta: Record<Kind, { label: string; eyebrow: string; singular: string; path: string }> = {
  series: { label: '系列', eyebrow: 'SERIES', singular: '系列', path: '/api/v1/series' },
  collections: { label: '合集', eyebrow: 'COLLECTION', singular: '合集', path: '/api/v1/collections' },
}

const emptyForm = {
  title: '',
  description: '',
}

function redirectToLogin(loginPath: '/admin/login' | '/login') {
  const returnTo = window.location.pathname + window.location.search + window.location.hash
  window.location.assign(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
}

async function readPage(kind: Kind, signal: AbortSignal, loginPath: '/admin/login' | '/login') {
  const response = await fetch(kindMeta[kind].path + '?limit=20', {
    credentials: 'include',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal,
  })
  const data = await response.json().catch((): null => null) as { data?: OrganizationPage } | null
  if (response.status === 401) {
    redirectToLogin(loginPath)
    throw new Error('AUTH_REQUIRED')
  }
  if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
    throw new Error('ORGANIZATION_LOAD_FAILED')
  }
  return data.data
}

export default function CreatorContentOrganization({
  loginPath = '/login',
}: {
  loginPath?: '/admin/login' | '/login'
}) {
  const [kind, setKind] = useState<Kind>('series')
  const [pages, setPages] = useState<Record<Kind, OrganizationPage>>({
    series: { items: [], nextCursor: null, hasMore: false },
    collections: { items: [], nextCursor: null, hasMore: false },
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    void Promise.all([
      readPage('series', controller.signal, loginPath),
      readPage('collections', controller.signal, loginPath),
    ])
      .then(([series, collections]) => {
        if (cancelled) return
        setPages({ series, collections })
        setError('')
      })
      .catch((cause: unknown) => {
        if (cancelled || controller.signal.aborted) return
        setError(cause instanceof Error && cause.message === 'AUTH_REQUIRED' ? '' : '系列与合集暂时无法加载。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [loginPath, reloadKey])

  function openCreate(nextKind: Kind) {
    setKind(nextKind)
    setForm(emptyForm)
    setFormOpen(true)
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.title.trim() || saving) return

    setSaving(true)
    setError('')
    try {
      const response = await fetch(kindMeta[kind].path, {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'content-organization:' + crypto.randomUUID(),
        },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
        }),
      })
      const data = await response.json().catch((): null => null) as { error?: { message?: string } } | null
      if (response.status === 401) {
        redirectToLogin(loginPath)
        return
      }
      if (!response.ok) throw new Error(data?.error?.message || '创建失败')
      setFormOpen(false)
      setForm(emptyForm)
      setReloadKey((value) => value + 1)
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return
      setError(cause instanceof Error ? cause.message : '创建失败')
    } finally {
      setSaving(false)
    }
  }

  async function deleteOrganization(item: OrganizationItem) {
    if (actionId || !window.confirm('确定删除“' + item.title + '”吗？')) return

    setActionId(item.id)
    setError('')
    try {
      const response = await fetch(kindMeta[kind].path + '/' + encodeURIComponent(item.id), {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'If-Match': item.etag,
          'Idempotency-Key': 'content-organization-delete:' + crypto.randomUUID(),
        },
      })
      const data = await response.json().catch((): null => null) as { error?: { message?: string } } | null
      if (response.status === 401) {
        redirectToLogin(loginPath)
        return
      }
      if (!response.ok) throw new Error(data?.error?.message || '删除失败')
      setReloadKey((value) => value + 1)
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return
      setError(cause instanceof Error ? cause.message : '删除失败')
    } finally {
      setActionId(null)
    }
  }

  const activePage = pages[kind]
  const activeMeta = kindMeta[kind]
  const handleOrganizationChanged = useCallback((organizationId: string, etag: string, version: number) => {
    setPages((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        items: current[kind].items.map((item) =>
          item.id === organizationId ? { ...item, etag, version } : item,
        ),
      },
    }))
  }, [kind])

  return (
    <section className={styles.sectionBlock} id="content-organization">
      <div className={styles.sectionTitle}>
        <div>
          <span className={styles.eyebrow}>CONTENT ORGANIZATION</span>
          <h2>系列与合集</h2>
          <p>直接使用 W03 Content 的 Series / Collection 权威数据，不在 Creator Studio 复制另一套内容关系。</p>
        </div>
        <div className={styles.sectionActions}>
          <button className={styles.secondaryButton + ' btn'} onClick={() => openCreate('series')} type="button">新建系列</button>
          <button className={styles.secondaryButton + ' btn'} onClick={() => openCreate('collections')} type="button">新建合集</button>
          <button className={styles.secondaryButton + ' btn'} onClick={() => setReloadKey((value) => value + 1)} type="button">刷新</button>
        </div>
      </div>

      {formOpen ? (
        <form className={styles.audiencePanel} onSubmit={createOrganization}>
          <div className={styles.audienceListHeader}>
            <strong>新建{activeMeta.singular}</strong>
            <button className={styles.secondaryButton + ' btn'} onClick={() => setFormOpen(false)} type="button">取消</button>
          </div>
          <label className={styles.filterSelect}>
            <span>类型</span>
            <select onChange={(event) => setKind(event.target.value as Kind)} value={kind}>
              <option value="series">系列</option>
              <option value="collections">合集</option>
            </select>
          </label>
          <label className={styles.filterSelect}>
            <span>名称</span>
            <input
              maxLength={256}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder={'输入' + activeMeta.singular + '名称'}
              value={form.title}
            />
          </label>
          <label className={styles.filterSelect}>
            <span>简介</span>
            <textarea
              maxLength={2000}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="可选：写一句简介"
              rows={3}
              value={form.description}
            />
          </label>
          <button className={styles.primaryButton + ' btn'} disabled={!form.title.trim() || saving} type="submit">
            {saving ? '创建中…' : '创建'}
          </button>
        </form>
      ) : null}

      {error ? <div className={styles.audienceState} role="alert">{error}</div> : null}

      <div className={styles.audienceTabs} role="tablist" aria-label="内容组织类型">
        {(['series', 'collections'] as Kind[]).map((value) => (
          <button
            aria-selected={kind === value}
            className={kind === value ? styles.audienceTabActive : styles.audienceTab}
            key={value}
            onClick={() => { setKind(value); setSelectedOrganizationId(null) }}
            role="tab"
            type="button"
          >
            {kindMeta[value].label} <span>{pages[value].items.length}{pages[value].hasMore ? '+' : ''}</span>
          </button>
        ))}
      </div>

      {loading ? <p className={styles.audienceState} role="status">正在加载系列与合集…</p> : null}

      {!loading && activePage.items.length === 0 ? (
        <div className={styles.contentManageEmpty}>
          <strong>还没有{activeMeta.label}</strong>
          <span>创建后可继续进入成员与顺序管理。</span>
        </div>
      ) : null}

      {!loading && activePage.items.length > 0 ? (
        <div className={styles.audienceList}>
          {activePage.items.map((item) => (
            <Fragment key={item.id}>
              <article className={styles.contentListItem}>
              {item.coverRef ? (
                <div className={styles.contentListThumb} aria-hidden="true">
                  <img alt="" loading="lazy" src={item.coverRef} />
                </div>
              ) : null}
              <div className={styles.contentListMain}>
                <div className={styles.contentMeta}>
                  <span>{activeMeta.label}</span>
                  <span>{item.state}</span>
                  <span>v{item.version}</span>
                </div>
                <h3>{item.title}</h3>
                {item.description ? <p>{item.description}</p> : null}
                <time dateTime={item.updatedAt}>
                  更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                </time>
              </div>
              <div className={styles.contentListActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={actionId !== null}
                  onClick={() => setSelectedOrganizationId((current) => current === item.id ? null : item.id)}
                  type="button"
                >
                  {selectedOrganizationId === item.id ? '收起成员' : '成员管理'}
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={actionId !== null}
                  onClick={() => void deleteOrganization(item)}
                  type="button"
                >
                  {actionId === item.id ? '处理中…' : '删除'}
                </button>
              </div>
              </article>
              {selectedOrganizationId === item.id ? (
              <CreatorContentOrganizationMembers
                kind={kind}
                loginPath={loginPath}
                onChanged={handleOrganizationChanged}
                organization={item}
              />
            ) : null}
            </Fragment>
          ))}
        </div>
      ) : null}
    </section>
  )
}
